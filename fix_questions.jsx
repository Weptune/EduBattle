import { useState, useRef, useCallback } from "react";

const SYSTEM_PROMPT = `You are fixing a quiz question bank. The problem: many questions have one correct answer that is long and detailed, while the wrong answers are obviously short filler options (e.g. "To make it look good", "To steer the vehicle", "Digesting food in the dark"). This makes the correct answer immediately obvious by length alone.

Your job: rewrite flagged questions so ALL four options are similar in length, plausible-sounding, and use appropriate subject terminology. A student who doesn't know the answer should not be able to guess it by option length.

Rules:
- Keep the question prompt the same (minor rephrasing allowed for clarity)
- Keep the correct answer factually accurate, but trim it if it's excessively long
- Make all wrong answers sound plausible and similar in length/style to the correct answer — no joke answers, no obviously absurd fillers
- Vary which index (0, 1, 2, or 3) holds the correct answer across questions — don't always use index 1
- Each option should be readable in under 5 seconds
- Return ONLY a valid JSON array of question objects. No markdown, no code fences, no explanation.

Each object must have exactly: prompt (string), options (array of 4 strings), answer (0-indexed int pointing to the correct option), difficulty (number), timeLimit (number).`;

function isBadQuestion(q) {
  const correct = q.options[q.answer];
  const wrong = q.options.filter((_, i) => i !== q.answer);
  const avgWrong = wrong.reduce((a, s) => a + s.length, 0) / wrong.length;
  const ratio = correct.length / (avgWrong || 1);
  return ratio > 2.0 || (correct.length > 70 && avgWrong < 35);
}

async function fixCategory(categoryName, questions) {
  const flaggedIndices = [];
  questions.forEach((q, i) => { if (isBadQuestion(q)) flaggedIndices.push(i); });
  if (flaggedIndices.length === 0) return questions;

  const flaggedQs = flaggedIndices.map(i => questions[i]);

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4000,
      system: SYSTEM_PROMPT,
      messages: [{
        role: "user",
        content: `Category: "${categoryName}"\nFix these ${flaggedQs.length} questions. Return a JSON array.\n\n${JSON.stringify(flaggedQs, null, 2)}`
      }]
    })
  });

  const data = await response.json();
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));

  const text = data.content.map(c => c.text || "").join("");
  const clean = text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
  
  // Find JSON array in response
  const arrStart = clean.indexOf('[');
  const arrEnd = clean.lastIndexOf(']');
  if (arrStart === -1 || arrEnd === -1) throw new Error("No JSON array found in response");
  
  const fixed = JSON.parse(clean.slice(arrStart, arrEnd + 1));

  const result = [...questions];
  flaggedIndices.forEach((origIdx, fi) => {
    if (fixed[fi]) {
      result[origIdx] = {
        ...fixed[fi],
        difficulty: questions[origIdx].difficulty,
        timeLimit: questions[origIdx].timeLimit,
      };
    }
  });
  return result;
}

export default function App() {
  const [file, setFile] = useState(null);
  const [questions, setQuestions] = useState(null);
  const [categories, setCategories] = useState([]);
  const [status, setStatus] = useState("idle"); // idle | running | done | error
  const [progress, setProgress] = useState({ current: 0, total: 0, catName: "" });
  const [fixedData, setFixedData] = useState(null);
  const [error, setError] = useState("");
  const [stats, setStats] = useState({ total: 0, fixed: 0 });
  const abortRef = useRef(false);

  const handleFile = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    setFile(f);
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const text = ev.target.result;
        // Extract the object from the JS file
        const match = text.match(/const QUESTIONS\s*=\s*(\{[\s\S]*\});?\s*(?:module\.exports|export)/);
        if (!match) throw new Error("Could not find QUESTIONS object in file");
        const obj = eval("(" + match[1] + ")");
        setQuestions(obj);
        const cats = Object.keys(obj);
        setCategories(cats);
        let totalBad = 0;
        for (const cat of cats) {
          for (const q of obj[cat]) {
            if (isBadQuestion(q)) totalBad++;
          }
        }
        setStats({ total: cats.reduce((a,c) => a + obj[c].length, 0), fixed: totalBad });
        setStatus("loaded");
        setError("");
      } catch (err) {
        setError("Failed to parse file: " + err.message);
      }
    };
    reader.readAsText(f);
  };

  const handleRun = useCallback(async () => {
    if (!questions) return;
    abortRef.current = false;
    setStatus("running");
    setError("");

    const cats = Object.keys(questions);
    const result = {};
    
    for (let i = 0; i < cats.length; i++) {
      if (abortRef.current) break;
      const cat = cats[i];
      setProgress({ current: i + 1, total: cats.length, catName: cat });
      
      try {
        result[cat] = await fixCategory(cat, questions[cat]);
      } catch (err) {
        console.error("Error in", cat, err);
        result[cat] = questions[cat]; // keep originals on error
      }
      
      // Small delay to avoid rate limits
      await new Promise(r => setTimeout(r, 300));
    }

    const output = `const QUESTIONS = ${JSON.stringify(result, null, 2)};\n\nmodule.exports = QUESTIONS;\n`;
    setFixedData(output);
    setStatus("done");
  }, [questions]);

  const handleDownload = () => {
    const blob = new Blob([fixedData], { type: "text/javascript" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "questions_fixed.js";
    a.click();
    URL.revokeObjectURL(url);
  };

  const pct = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;

  return (
    <div style={{
      fontFamily: "'IBM Plex Mono', 'Courier New', monospace",
      background: "#0f0f0f",
      minHeight: "100vh",
      color: "#e0e0e0",
      padding: "40px 32px",
      boxSizing: "border-box"
    }}>
      <div style={{ maxWidth: 700, margin: "0 auto" }}>
        
        {/* Header */}
        <div style={{ marginBottom: 40 }}>
          <div style={{ fontSize: 11, letterSpacing: 4, color: "#666", textTransform: "uppercase", marginBottom: 8 }}>
            Quiz Question Fixer
          </div>
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 700, color: "#fff", letterSpacing: -1 }}>
            Balance Your Answer Options
          </h1>
          <p style={{ margin: "12px 0 0", color: "#888", fontSize: 14, lineHeight: 1.6 }}>
            Detects questions where the correct answer is obviously longer than the wrong ones, 
            and rewrites all options to be similar in length and plausibility.
          </p>
        </div>

        {/* Step 1: Upload */}
        <div style={{
          background: "#1a1a1a",
          border: "1px solid #2a2a2a",
          borderRadius: 8,
          padding: "24px",
          marginBottom: 16
        }}>
          <div style={{ fontSize: 11, color: "#555", letterSpacing: 3, textTransform: "uppercase", marginBottom: 16 }}>
            01 — Upload File
          </div>
          
          <label style={{
            display: "block",
            border: "2px dashed #333",
            borderRadius: 6,
            padding: "32px 24px",
            textAlign: "center",
            cursor: "pointer",
            transition: "border-color 0.2s",
          }}
          onMouseEnter={e => e.currentTarget.style.borderColor = "#555"}
          onMouseLeave={e => e.currentTarget.style.borderColor = "#333"}
          >
            <input type="file" accept=".js" onChange={handleFile} style={{ display: "none" }} />
            {file ? (
              <div>
                <div style={{ fontSize: 20, marginBottom: 6 }}>📄</div>
                <div style={{ color: "#aaa", fontSize: 14 }}>{file.name}</div>
              </div>
            ) : (
              <div>
                <div style={{ fontSize: 20, marginBottom: 6 }}>📂</div>
                <div style={{ color: "#666", fontSize: 14 }}>Click to select your <code style={{ color: "#aaa" }}>questions.js</code> file</div>
              </div>
            )}
          </label>

          {error && (
            <div style={{ marginTop: 12, color: "#ff6b6b", fontSize: 13, padding: "8px 12px", background: "#1f0f0f", borderRadius: 4, border: "1px solid #3a1a1a" }}>
              ⚠ {error}
            </div>
          )}
        </div>

        {/* Stats after load */}
        {status === "loaded" || status === "running" || status === "done" ? (
          <div style={{
            background: "#1a1a1a",
            border: "1px solid #2a2a2a",
            borderRadius: 8,
            padding: "20px 24px",
            marginBottom: 16,
            display: "flex",
            gap: 32
          }}>
            <div>
              <div style={{ fontSize: 28, fontWeight: 700, color: "#fff" }}>{categories.length}</div>
              <div style={{ fontSize: 11, color: "#555", letterSpacing: 2, textTransform: "uppercase" }}>Categories</div>
            </div>
            <div>
              <div style={{ fontSize: 28, fontWeight: 700, color: "#fff" }}>{stats.total}</div>
              <div style={{ fontSize: 11, color: "#555", letterSpacing: 2, textTransform: "uppercase" }}>Total Questions</div>
            </div>
            <div>
              <div style={{ fontSize: 28, fontWeight: 700, color: "#f0a500" }}>{stats.fixed}</div>
              <div style={{ fontSize: 11, color: "#555", letterSpacing: 2, textTransform: "uppercase" }}>Flagged for Fix</div>
            </div>
          </div>
        ) : null}

        {/* Step 2: Run */}
        {(status === "loaded" || status === "running" || status === "done") && (
          <div style={{
            background: "#1a1a1a",
            border: "1px solid #2a2a2a",
            borderRadius: 8,
            padding: "24px",
            marginBottom: 16
          }}>
            <div style={{ fontSize: 11, color: "#555", letterSpacing: 3, textTransform: "uppercase", marginBottom: 16 }}>
              02 — Process
            </div>

            {status === "loaded" && (
              <>
                <p style={{ margin: "0 0 16px", color: "#888", fontSize: 13, lineHeight: 1.6 }}>
                  Will process all {categories.length} categories, fixing ~{stats.fixed} questions. 
                  This uses the Claude API and takes a few minutes.
                </p>
                <button onClick={handleRun} style={{
                  background: "#f0a500",
                  color: "#000",
                  border: "none",
                  borderRadius: 6,
                  padding: "12px 28px",
                  fontSize: 14,
                  fontWeight: 700,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  letterSpacing: 1
                }}>
                  START FIXING →
                </button>
              </>
            )}

            {status === "running" && (
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8, fontSize: 13, color: "#888" }}>
                  <span style={{ color: "#aaa", maxWidth: 400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {progress.catName}
                  </span>
                  <span>{progress.current} / {progress.total}</span>
                </div>
                <div style={{ background: "#0f0f0f", borderRadius: 4, height: 6, overflow: "hidden" }}>
                  <div style={{
                    height: "100%",
                    width: pct + "%",
                    background: "linear-gradient(90deg, #f0a500, #ff6b00)",
                    borderRadius: 4,
                    transition: "width 0.3s ease"
                  }} />
                </div>
                <div style={{ marginTop: 8, fontSize: 12, color: "#555" }}>{pct}% complete</div>
                <button onClick={() => { abortRef.current = true; setStatus("loaded"); }} style={{
                  marginTop: 16,
                  background: "transparent",
                  color: "#555",
                  border: "1px solid #333",
                  borderRadius: 4,
                  padding: "6px 14px",
                  fontSize: 12,
                  cursor: "pointer",
                  fontFamily: "inherit"
                }}>
                  Stop
                </button>
              </div>
            )}

            {status === "done" && (
              <div>
                <div style={{ color: "#4caf50", fontSize: 14, marginBottom: 16 }}>
                  ✓ All {categories.length} categories processed.
                </div>
                <button onClick={handleDownload} style={{
                  background: "#4caf50",
                  color: "#000",
                  border: "none",
                  borderRadius: 6,
                  padding: "12px 28px",
                  fontSize: 14,
                  fontWeight: 700,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  letterSpacing: 1
                }}>
                  ↓ DOWNLOAD questions_fixed.js
                </button>
              </div>
            )}
          </div>
        )}

        {/* How it works */}
        {status === "idle" && (
          <div style={{
            background: "#111",
            border: "1px solid #1f1f1f",
            borderRadius: 8,
            padding: "20px 24px",
            marginTop: 8
          }}>
            <div style={{ fontSize: 11, color: "#444", letterSpacing: 3, textTransform: "uppercase", marginBottom: 14 }}>
              How it detects problems
            </div>
            <div style={{ fontSize: 13, color: "#666", lineHeight: 1.8 }}>
              Flags any question where the correct answer is more than 2× longer than the average wrong answer,
              or where the correct answer exceeds 70 chars while wrong answers average under 35.
              <br /><br />
              The fix: Claude rewrites all four options to be comparable in length and plausibility,
              and shuffles which index holds the correct answer.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
