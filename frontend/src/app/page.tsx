"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";
import { AnimatePresence, motion } from "framer-motion";
import {
  Camera,
  Crown,
  Flame,
  LogOut,
  Medal,
  Shield,
  Skull,
  Sparkles,
  Swords,
  Trophy,
  Zap,
} from "lucide-react";

type GameState = "menu" | "queue" | "versus_intro" | "initial_discard" | "drafting" | "battle" | "results";
type Screen = "auth" | "play" | "profile" | "leaderboard";

type Account = {
  id: string;
  username: string;
  elo: number;
  avatarUrl: string;
  bannerUrl: string;
  bio: string;
  wins: number;
  losses: number;
  gamesPlayed: number;
  bestElo: number;
  createdAt: string;
};

type MatchData = {
  draftTurn?: string;
  currentRound?: number;
  domain?: string;
};

type RoundData = {
  round: number;
  question: {
    prompt: string;
    options: string[];
    timeLimit: number;
  };
};

type RoundResult = {
  answers: Record<string, { answer: number; timeTaken: number }>;
  correctAnswer: number;
  hpData: Record<string, number>;
  damageDealt: Record<string, number>;
};

type WinnerInfo = {
  winner: string;
  elo: number;
  eloDelta: number;
};

type FighterProfile = {
  id?: string;
  name: string;
  username?: string;
  elo: number;
  hp: number;
  avatarUrl?: string;
  bannerUrl?: string;
};

type LeaderboardEntry = {
  rank: number;
  user: Account;
};

type MatchRecord = {
  id: string;
  winner_id?: string | null;
  loser_id?: string | null;
  winnerId?: string | null;
  loserId?: string | null;
  player_one_name?: string;
  player_two_name?: string;
  playerOneName?: string;
  playerTwoName?: string;
  player_one_delta?: number;
  player_two_delta?: number;
  playerOneDelta?: number;
  playerTwoDelta?: number;
  rounds: number;
  finished_at?: string;
  finishedAt?: string;
  domain?: string;
};

const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL || "http://localhost:3001";

const getImageUrl = (url?: string) => {
  if (!url) return "";
  if (url.startsWith("/") && !url.startsWith("//")) {
    const baseUrl = SOCKET_URL.replace(/\/+$/, "");
    const cleanUrl = "/" + url.replace(/^\/+/, "");
    return `${baseUrl}${cleanUrl}`;
  }
  return url;
};

async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  let response: Response;

  const baseUrl = SOCKET_URL.replace(/\/+$/, "");
  const cleanPath = "/" + path.replace(/^\/+/, "");

  try {
    response = await fetch(`${baseUrl}${cleanPath}`, options);
  } catch {
    throw new Error(`Cannot reach backend at ${baseUrl}. Make sure the updated backend server is running.`);
  }

  const text = await response.text();
  let data: { error?: string } = {};

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Backend returned a non-JSON response for ${path}. You may be talking to an old server process.`);
  }

  if (!response.ok) {
    throw new Error(data.error || `Request failed with status ${response.status}.`);
  }

  return data as T;
}

function playSound(type: "select" | "hit" | "damage" | "victory" | "confirm" | "queue" | "intro" | "error") {
  try {
    const AudioCtor: typeof globalThis.AudioContext | undefined =
      window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof globalThis.AudioContext }).webkitAudioContext;
    if (!AudioCtor) return;
    const ctx = new AudioCtor();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    const now = ctx.currentTime;
    const settings = {
      select: [800, 1200, 0.1, "sine"],
      hit: [400, 800, 0.15, "square"],
      damage: [150, 40, 0.3, "sawtooth"],
      victory: [440, 659, 1, "triangle"],
      confirm: [520, 980, 0.12, "triangle"],
      queue: [300, 620, 0.18, "sine"],
      intro: [220, 760, 0.35, "triangle"],
      error: [180, 90, 0.22, "sawtooth"],
    } as const;
    const [start, end, duration, wave] = settings[type];

    osc.type = wave;
    osc.frequency.setValueAtTime(start, now);
    osc.frequency.exponentialRampToValueAtTime(end, now + duration);
    gain.gain.setValueAtTime(type === "damage" || type === "error" ? 0.3 : 0.14, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + duration);
    osc.start(now);
    osc.stop(now + duration);
  } catch {
    // Audio is cosmetic; ignore browser autoplay restrictions.
  }
}

const FIELDS = [
  { id: "all", name: "All Subjects" },
  { id: "Common / First Year", name: "Common / First Year" },
  { id: "Computer Science / AI / IT / Data", name: "Computer Science & AI" },
  { id: "Electronics / Electrical / Embedded", name: "Electrical & Electronics" },
  { id: "Mechanical / Automobile / Aerospace", name: "Mechanical & Aerospace" },
  { id: "Civil / Chemical / Biotech / Biomedical", name: "Civil & Chemical & Biotech" },
];

export default function Home() {
  const socketRef = useRef<Socket | null>(null);
  const [socketId, setSocketId] = useState<string | undefined>();
  const [selectedField, setSelectedField] = useState<string>("all");
  const [queueMode, setQueueMode] = useState<"global" | "field">("global");
  const [screen, setScreen] = useState<Screen>("auth");
  const [authMode, setAuthMode] = useState<"login" | "signup">("signup");
  const [token, setToken] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return localStorage.getItem("synapse_token");
  });
  const [account, setAccount] = useState<Account | null>(null);
  const [authForm, setAuthForm] = useState({ username: "", password: "" });
  const [profileForm, setProfileForm] = useState({ username: "", bio: "", avatarUrl: "", bannerUrl: "" });
  const [status, setStatus] = useState("");
  const [isAuthBusy, setIsAuthBusy] = useState(false);
  const [isProfileBusy, setIsProfileBusy] = useState(false);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [recentMatches, setRecentMatches] = useState<MatchRecord[]>([]);
  const [isMetaLoading, setIsMetaLoading] = useState(false);

  const [gameState, setGameState] = useState<GameState>("menu");
  const [player, setPlayer] = useState<FighterProfile>({ name: "Player", elo: 1200, hp: 100 });
  const [opponent, setOpponent] = useState<FighterProfile>({ id: "", name: "?", username: "", elo: 1200, hp: 100 });
  const [hand, setHand] = useState<string[]>([]);
  const [matchData, setMatchData] = useState<MatchData | null>(null);
  const [roundData, setRoundData] = useState<RoundData | null>(null);
  const [selectedSubject, setSelectedSubject] = useState<string | null>(null);
  const [roundResult, setRoundResult] = useState<RoundResult | null>(null);
  const [winnerInfo, setWinnerInfo] = useState<WinnerInfo | null>(null);
  const [timeLeft, setTimeLeft] = useState<number>(15);
  const [myAnswer, setMyAnswer] = useState<number | null>(null);
  const [isShaking, setIsShaking] = useState(false);
  const [lockedSubject, setLockedSubject] = useState<string | null>(null);
  const versusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const winRate = useMemo(() => {
    if (!account?.gamesPlayed) return 0;
    return Math.round((account.wins / account.gamesPlayed) * 100);
  }, [account]);

  const refreshPlayerMeta = useCallback(async (activeToken = token) => {
    if (!activeToken) return;

    setIsMetaLoading(true);
    try {
      const [leaderboardData, matchData] = await Promise.all([
        apiRequest<{ leaderboard: LeaderboardEntry[] }>("/leaderboard"),
        apiRequest<{ matches: MatchRecord[] }>("/me/matches", { headers: { Authorization: `Bearer ${activeToken}` } }),
      ]);
      setLeaderboard(leaderboardData.leaderboard);
      setRecentMatches(matchData.matches);
    } catch {
      // Meta panels are non-critical; auth/profile errors are shown elsewhere.
    } finally {
      setIsMetaLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (!token) return;

    apiRequest<{ user: Account }>("/me", { headers: { Authorization: `Bearer ${token}` } })
      .then(data => {
        setAccount(data.user);
        setPlayer({ name: data.user.username, username: data.user.username, elo: data.user.elo, hp: 100, avatarUrl: data.user.avatarUrl, bannerUrl: data.user.bannerUrl });
        setProfileForm({
          username: data.user.username,
          bio: data.user.bio,
          avatarUrl: data.user.avatarUrl,
          bannerUrl: data.user.bannerUrl,
        });
        setScreen("play");
        refreshPlayerMeta(token);
      })
      .catch(() => {
        localStorage.removeItem("synapse_token");
        setToken(null);
        setAccount(null);
        setScreen("auth");
      });
  }, [token, refreshPlayerMeta]);

  useEffect(() => {
    const activeSocket = io(SOCKET_URL, { autoConnect: true });
    socketRef.current = activeSocket;

    activeSocket.on("connect", () => setSocketId(activeSocket.id));
    activeSocket.on("disconnect", () => setSocketId(undefined));

    activeSocket.on("auth_required", () => {
      setStatus("Sign in before entering a match.");
      setScreen("auth");
      setGameState("menu");
    });

    activeSocket.on("waiting_in_queue", () => setGameState("queue"));

    activeSocket.on("match_found", data => {
      setOpponent(data.opponent);
      setMatchData(data.match);
      setHand(data.hand || []);
      setPlayer(p => ({ ...p, hp: 100 }));
      setLockedSubject(null);
      setGameState("versus_intro");
      playSound("intro");

      if (versusTimerRef.current) clearTimeout(versusTimerRef.current);
      versusTimerRef.current = setTimeout(() => {
        setGameState("initial_discard");
      }, 2600);
    });

    activeSocket.on("hand_updated", data => setHand(data.hand));

    activeSocket.on("discard_phase_end", data => {
      setMatchData(data.match);
      setLockedSubject(null);
      setGameState("drafting");
    });

    activeSocket.on("draft_complete", data => setSelectedSubject(data.subject));

    activeSocket.on("round_start", data => {
      setRoundData(data);
      setRoundResult(null);
      setMyAnswer(null);
      setLockedSubject(null);
      setTimeLeft(data.question.timeLimit || 15);
      setGameState("battle");
    });

    activeSocket.on("round_result", data => {
      const myId = activeSocket.id;
      if (!myId) return;

      setRoundResult(data);
      setPlayer(p => ({ ...p, hp: data.hpData[myId] }));
      setOpponent(o => {
        const oppId = Object.keys(data.hpData).find(id => id !== myId);
        return { ...o, hp: oppId ? data.hpData[oppId] : o.hp };
      });

      if (data.damageDealt[myId] > 0) {
        setIsShaking(true);
        setTimeout(() => setIsShaking(false), 400);
        playSound("damage");
      } else {
        playSound("hit");
      }
    });

    activeSocket.on("match_end", data => {
      setWinnerInfo(data);
      setGameState("results");
      setAccount(current => current ? { ...current, elo: data.elo, bestElo: Math.max(current.bestElo, data.elo) } : current);
      refreshPlayerMeta();
      if (data.winner === activeSocket.id) playSound("victory");
      else playSound("damage");
    });

    activeSocket.on("back_to_draft", data => {
      setMatchData(prev => ({
        ...prev,
        draftTurn: data.draftTurn,
        currentRound: data.round,
      }));
      setSelectedSubject(null);
      setLockedSubject(null);
      setGameState("drafting");
    });

    return () => {
      activeSocket.disconnect();
      socketRef.current = null;
      if (versusTimerRef.current) clearTimeout(versusTimerRef.current);
    };
  }, [refreshPlayerMeta]);

  useEffect(() => {
    if (gameState !== "battle" || roundResult) return;

    const timer = setInterval(() => {
      setTimeLeft(t => Math.max(0, t - 0.1));
    }, 100);

    return () => clearInterval(timer);
  }, [gameState, roundResult, roundData]);

  const authenticate = async () => {
    setStatus("");
    setIsAuthBusy(true);

    try {
      const username = authForm.username.trim();
      if (!username || !authForm.password) {
        setStatus("Enter a username and password.");
        return;
      }

      const endpoint = authMode === "signup" ? "signup" : "login";
      const data = await apiRequest<{ token: string; user: Account }>(`/auth/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password: authForm.password }),
      });

      localStorage.setItem("synapse_token", data.token);
      setToken(data.token);
      setAccount(data.user);
      setPlayer({ name: data.user.username, username: data.user.username, elo: data.user.elo, hp: 100, avatarUrl: data.user.avatarUrl, bannerUrl: data.user.bannerUrl });
      setProfileForm({
        username: data.user.username,
        bio: data.user.bio,
        avatarUrl: data.user.avatarUrl,
        bannerUrl: data.user.bannerUrl,
      });
      setScreen("play");
      refreshPlayerMeta(data.token);
      playSound("confirm");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Account request failed.");
      playSound("error");
    } finally {
      setIsAuthBusy(false);
    }
  };

  const saveProfile = async () => {
    if (!token) return;
    setStatus("");
    setIsProfileBusy(true);

    try {
      let avatarUrl = profileForm.avatarUrl;
      let bannerUrl = profileForm.bannerUrl;

      if (avatarUrl && avatarUrl.startsWith("data:image/")) {
        const uploadRes = await apiRequest<{ url: string }>("/upload", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ image: avatarUrl }),
        });
        avatarUrl = uploadRes.url;
      }

      if (bannerUrl && bannerUrl.startsWith("data:image/")) {
        const uploadRes = await apiRequest<{ url: string }>("/upload", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ image: bannerUrl }),
        });
        bannerUrl = uploadRes.url;
      }

      const data = await apiRequest<{ user: Account }>("/me", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ 
          ...profileForm, 
          username: profileForm.username.trim(),
          avatarUrl,
          bannerUrl
        }),
      });

      setAccount(data.user);
      setPlayer(p => ({ ...p, name: data.user.username, username: data.user.username, elo: data.user.elo, avatarUrl: data.user.avatarUrl, bannerUrl: data.user.bannerUrl }));
      setStatus("Profile saved.");
      playSound("confirm");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Profile update failed.");
      playSound("error");
    } finally {
      setIsProfileBusy(false);
    }
  };

  const logout = async () => {
    if (token) {
      apiRequest("/auth/logout", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => undefined);
    }
    localStorage.removeItem("synapse_token");
    setToken(null);
    setAccount(null);
    setLeaderboard([]);
    setRecentMatches([]);
    setScreen("auth");
    setGameState("menu");
    playSound("select");
  };

  const joinQueue = (bot = false) => {
    if (!socketRef.current || !token || !account) {
      setScreen("auth");
      setStatus("Create an account or sign in before playing.");
      playSound("error");
      return;
    }

    const domain = queueMode === "global" ? "all" : (selectedField === "all" ? "Common / First Year" : selectedField);

    playSound(bot ? "confirm" : "queue");
    socketRef.current.emit(bot ? "join_bot_queue" : "join_queue", { authToken: token, domain });
  };

  const pickSubject = (subject: string) => {
    if (matchData?.draftTurn === socketId && !lockedSubject) {
      playSound("select");
      setLockedSubject(subject);
      socketRef.current?.emit("draft_action", { subject });
    }
  };

  const submitAnswer = (answerIndex: number) => {
    if (!roundResult && myAnswer === null) {
      playSound("select");
      setMyAnswer(answerIndex);
      socketRef.current?.emit("submit_answer", { answerIndex });
    }
  };

  const setProfileImage = (field: "avatarUrl" | "bannerUrl", file?: File) => {
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setStatus("Choose an image file.");
      playSound("error");
      return;
    }

    const maxSize = field === "avatarUrl" ? 1_200_000 : 2_500_000;
    if (file.size > maxSize) {
      setStatus(field === "avatarUrl" ? "Avatar must be under 1.2 MB." : "Banner must be under 2.5 MB.");
      playSound("error");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") return;
      setProfileForm(current => ({ ...current, [field]: reader.result as string }));
      setStatus(field === "avatarUrl" ? "Avatar ready. Save profile to keep it." : "Banner ready. Save profile to keep it.");
      playSound("confirm");
    };
    reader.onerror = () => {
      setStatus("Could not read that image.");
      playSound("error");
    };
    reader.readAsDataURL(file);
  };

  return (
    <main className="min-h-screen overflow-x-hidden bg-[#070912] text-slate-50">
      <div className="fixed inset-0 pointer-events-none bg-[radial-gradient(circle_at_20%_10%,rgba(20,184,166,0.18),transparent_28%),radial-gradient(circle_at_80%_0%,rgba(217,119,6,0.16),transparent_30%),linear-gradient(180deg,#070912_0%,#111827_100%)]" />

      <nav className="relative z-20 mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-5">
        <button onClick={() => setScreen(account ? "play" : "auth")} className="flex items-center gap-3 text-left">
          <div className="grid h-10 w-10 place-items-center rounded-lg bg-teal-400 text-slate-950 shadow-[0_0_24px_rgba(45,212,191,0.35)]">
            <Swords size={22} />
          </div>
          <div>
            <p className="text-lg font-black uppercase tracking-wide text-teal-400">Synapse.gg</p>
            <p className="text-xs font-mono text-slate-400">Collegiate Trivia Arena</p>
          </div>
        </button>

        {account ? (
          <div className="flex items-center gap-2">
            <button onClick={() => { playSound("select"); setScreen("play"); }} className="rounded-lg px-4 py-2 text-sm font-bold text-slate-300 hover:bg-white/10">Play</button>
            <button onClick={() => { playSound("select"); setScreen("profile"); }} className="rounded-lg px-4 py-2 text-sm font-bold text-slate-300 hover:bg-white/10">Profile</button>
            <button onClick={() => { playSound("select"); refreshPlayerMeta(); setScreen("leaderboard"); }} className="rounded-lg px-4 py-2 text-sm font-bold text-slate-300 hover:bg-white/10">Ranks</button>
            <button onClick={logout} className="grid h-10 w-10 place-items-center rounded-lg border border-white/10 bg-white/5 text-slate-300 hover:bg-white/10" title="Log out">
              <LogOut size={18} />
            </button>
          </div>
        ) : null}
      </nav>

      <div className="relative z-10 mx-auto w-full max-w-6xl px-4 pb-10">
        <AnimatePresence mode="wait">
          {!account || screen === "auth" ? renderAuth() : screen === "profile" ? renderProfile() : screen === "leaderboard" ? renderLeaderboard() : renderGame()}
        </AnimatePresence>
      </div>
    </main>
  );

  function renderAuth() {
    return (
      <motion.section
        key="auth"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -16 }}
        className="grid min-h-[calc(100vh-96px)] items-center gap-8 lg:grid-cols-[1.1fr_0.9fr]"
      >
        <div className="max-w-2xl">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-teal-300/20 bg-teal-300/10 px-4 py-2 text-sm font-bold text-teal-200">
            <Shield size={16} /> Account required
          </div>
          <h1 className="text-5xl font-black uppercase leading-none tracking-normal md:text-7xl">
            Build your ranked identity.
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-8 text-slate-300">
            Your Elo, wins, losses, profile banner, and battle record now live on your account. No account, no queue.
          </p>

          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            <Stat icon={<Medal size={20} />} label="Starting Elo" value="1200" />
            <Stat icon={<Flame size={20} />} label="Tracked" value="W/L" />
            <Stat icon={<Crown size={20} />} label="Profile" value="Live" />
          </div>
        </div>

        <div className="rounded-lg border border-white/10 bg-white/[0.06] p-6 shadow-2xl backdrop-blur">
          <div className="mb-6 grid grid-cols-2 rounded-lg bg-black/30 p-1">
            {(["signup", "login"] as const).map(mode => (
              <button
                key={mode}
                onClick={() => {
                  setAuthMode(mode);
                  setStatus("");
                  playSound("select");
                }}
                className={`rounded-md py-3 text-sm font-black uppercase tracking-wider transition ${authMode === mode ? "bg-teal-300 text-slate-950" : "text-slate-400 hover:text-white"}`}
              >
                {mode === "signup" ? "Create" : "Login"}
              </button>
            ))}
          </div>

          <div className="space-y-4">
            <label className="block">
              <span className="mb-2 block text-xs font-bold uppercase tracking-widest text-slate-400">Username</span>
              <input value={authForm.username} onChange={event => setAuthForm({ ...authForm, username: event.target.value })} className="w-full rounded-lg border border-white/10 bg-black/40 px-4 py-3 outline-none focus:border-teal-300" />
            </label>
            <label className="block">
              <span className="mb-2 block text-xs font-bold uppercase tracking-widest text-slate-400">Password</span>
              <input type="password" value={authForm.password} onChange={event => setAuthForm({ ...authForm, password: event.target.value })} className="w-full rounded-lg border border-white/10 bg-black/40 px-4 py-3 outline-none focus:border-teal-300" />
            </label>
            {status ? <p className="rounded-lg border border-amber-300/20 bg-amber-300/10 p-3 text-sm text-amber-100">{status}</p> : null}
            <button onClick={authenticate} disabled={isAuthBusy} className="w-full rounded-lg bg-teal-300 py-4 font-black uppercase tracking-widest text-slate-950 hover:bg-teal-200 disabled:cursor-not-allowed disabled:opacity-60">
              {isAuthBusy ? "Working..." : authMode === "signup" ? "Create Account" : "Enter Arena"}
            </button>
          </div>
        </div>
      </motion.section>
    );
  }

  function renderProfile() {
    if (!account) return null;

    return (
      <motion.section key="profile" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -16 }} className="space-y-6">
        <div className="overflow-hidden rounded-lg border border-white/10 bg-white/[0.06]">
          <div className="h-56 bg-cover bg-center" style={{ backgroundImage: `url(${getImageUrl(account.bannerUrl)})` }} />
          <div className="flex flex-col gap-6 px-6 pb-6 md:flex-row md:items-end md:justify-between">
            <div className="-mt-16 flex flex-col gap-4 md:flex-row md:items-end">
              <img src={getImageUrl(account.avatarUrl)} alt={`${account.username} avatar`} className="h-32 w-32 rounded-lg border-4 border-[#070912] bg-slate-800 object-cover" />
              <div className="pb-1">
                <p className="font-mono text-sm text-teal-300">@{account.username}</p>
                <h1 className="text-4xl font-black uppercase tracking-normal">{account.username}</h1>
                <p className="mt-2 max-w-xl text-slate-300">{account.bio}</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat icon={<Zap size={18} />} label="Elo" value={String(account.elo)} />
              <Stat icon={<Trophy size={18} />} label="Best" value={String(account.bestElo)} />
              <Stat icon={<Swords size={18} />} label="Games" value={String(account.gamesPlayed)} />
              <Stat icon={<Flame size={18} />} label="Win Rate" value={`${winRate}%`} />
            </div>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="rounded-lg border border-white/10 bg-white/[0.06] p-5">
            <h2 className="mb-4 flex items-center gap-2 text-xl font-black uppercase"><Medal className="text-amber-300" /> Battle Record</h2>
            <div className="grid grid-cols-2 gap-3">
              <Stat icon={<Trophy size={18} />} label="Wins" value={String(account.wins)} />
              <Stat icon={<Skull size={18} />} label="Losses" value={String(account.losses)} />
            </div>
            <div className="mt-5 rounded-lg bg-black/30 p-4">
              <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Joined</p>
              <p className="mt-1 font-mono text-sm text-slate-200">{new Date(account.createdAt).toLocaleDateString()}</p>
            </div>
          </div>

          <div className="rounded-lg border border-white/10 bg-white/[0.06] p-5">
            <h2 className="mb-4 flex items-center gap-2 text-xl font-black uppercase"><Camera className="text-teal-300" /> Edit Profile</h2>
            <div className="grid gap-4">
              <input value={profileForm.username} onChange={event => setProfileForm({ ...profileForm, username: event.target.value })} placeholder="Username" className="rounded-lg border border-white/10 bg-black/40 px-4 py-3 outline-none focus:border-teal-300" />
              <input value={profileForm.bio} onChange={event => setProfileForm({ ...profileForm, bio: event.target.value })} placeholder="Bio" className="rounded-lg border border-white/10 bg-black/40 px-4 py-3 outline-none focus:border-teal-300" />
              <div className="grid gap-3 md:grid-cols-2">
                <label className="cursor-pointer rounded-lg border border-white/10 bg-black/30 p-4 transition hover:border-teal-300/60 hover:bg-teal-300/10">
                  <span className="mb-3 flex items-center gap-2 text-sm font-black uppercase tracking-widest text-teal-200"><Camera size={16} /> Avatar File</span>
                  <div className="flex items-center gap-4">
                    <img src={getImageUrl(profileForm.avatarUrl)} alt="" className="h-16 w-16 rounded-lg bg-slate-800 object-cover" />
                    <span className="text-sm text-slate-300">Choose from your PC</span>
                  </div>
                  <input type="file" accept="image/*" className="hidden" onChange={event => setProfileImage("avatarUrl", event.target.files?.[0])} />
                </label>
                <label className="cursor-pointer rounded-lg border border-white/10 bg-black/30 p-4 transition hover:border-teal-300/60 hover:bg-teal-300/10">
                  <span className="mb-3 flex items-center gap-2 text-sm font-black uppercase tracking-widest text-teal-200"><Camera size={16} /> Banner File</span>
                  <div className="h-16 rounded-lg bg-cover bg-center" style={{ backgroundImage: `url(${getImageUrl(profileForm.bannerUrl)})` }} />
                  <input type="file" accept="image/*" className="hidden" onChange={event => setProfileImage("bannerUrl", event.target.files?.[0])} />
                </label>
              </div>
              {status ? <p className="text-sm text-teal-200">{status}</p> : null}
              <button onClick={saveProfile} disabled={isProfileBusy} className="rounded-lg bg-teal-300 px-5 py-3 font-black uppercase tracking-widest text-slate-950 hover:bg-teal-200 disabled:cursor-not-allowed disabled:opacity-60">{isProfileBusy ? "Saving..." : "Save Profile"}</button>
            </div>
          </div>
        </div>
      </motion.section>
    );
  }

  function renderLeaderboard() {
    return (
      <motion.section key="leaderboard" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -16 }} className="grid gap-6 lg:grid-cols-[1fr_0.85fr]">
        <div className="rounded-lg border border-white/10 bg-white/[0.06] p-5">
          <div className="mb-5 flex items-center justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase tracking-widest text-teal-300">Global Ladder</p>
              <h1 className="text-3xl font-black uppercase tracking-normal">Leaderboard</h1>
            </div>
            <button onClick={() => refreshPlayerMeta()} className="rounded-lg border border-teal-300/30 px-4 py-2 text-sm font-black uppercase tracking-widest text-teal-200 hover:bg-teal-300/10">
              {isMetaLoading ? "Syncing" : "Refresh"}
            </button>
          </div>

          <div className="space-y-2">
            {leaderboard.length ? leaderboard.map(entry => (
              <div key={entry.user.id} className={`grid grid-cols-[auto_1fr_auto] items-center gap-4 rounded-lg border p-3 ${entry.user.id === account?.id ? "border-teal-300/50 bg-teal-300/10" : "border-white/10 bg-black/25"}`}>
                <div className="w-10 text-center font-mono text-lg font-black text-slate-300">#{entry.rank}</div>
                <div className="flex min-w-0 items-center gap-3">
                  <img src={getImageUrl(entry.user.avatarUrl)} alt="" className="h-11 w-11 rounded-lg object-cover" />
                  <div className="min-w-0">
                    <p className="truncate font-black uppercase">{entry.user.username}</p>
                    <p className="font-mono text-xs text-slate-500">{entry.user.wins}W / {entry.user.losses}L</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-mono text-xl font-black text-teal-200">{entry.user.elo}</p>
                  <p className="text-xs uppercase tracking-widest text-slate-500">Elo</p>
                </div>
              </div>
            )) : (
              <div className="rounded-lg border border-white/10 bg-black/25 p-8 text-center text-slate-400">No ranked players yet.</div>
            )}
          </div>
        </div>

        <div className="rounded-lg border border-white/10 bg-white/[0.06] p-5">
          <p className="text-xs font-black uppercase tracking-widest text-amber-300">Your Timeline</p>
          <h2 className="mb-5 text-2xl font-black uppercase tracking-normal">Recent Matches</h2>
          <div className="space-y-3">
            {recentMatches.length ? recentMatches.map(match => {
              const p1Name = match.player_one_name || match.playerOneName || "Player 1";
              const p2Name = match.player_two_name || match.playerTwoName || "Player 2";
              const p1Delta = match.player_one_delta ?? match.playerOneDelta ?? 0;
              const p2Delta = match.player_two_delta ?? match.playerTwoDelta ?? 0;
              const finished = match.finished_at || match.finishedAt;

              return (
                <div key={match.id} className="rounded-lg border border-white/10 bg-black/25 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="truncate font-black">{p1Name} <span className="text-slate-500">vs</span> {p2Name}</p>
                      <p className="text-[10px] font-bold text-teal-300 mt-1 uppercase tracking-widest">
                        🏟️ {match.domain && match.domain !== 'all' ? match.domain : 'All Subjects'}
                      </p>
                    </div>
                    <p className="font-mono text-xs text-slate-500">{finished ? new Date(finished).toLocaleDateString() : ""}</p>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
                    <p className="rounded bg-white/5 p-2 text-center font-mono">{match.rounds} rounds</p>
                    <p className={`rounded p-2 text-center font-mono ${p1Delta >= 0 ? "bg-green-400/10 text-green-300" : "bg-red-400/10 text-red-300"}`}>{p1Delta >= 0 ? "+" : ""}{p1Delta}</p>
                    <p className={`rounded p-2 text-center font-mono ${p2Delta >= 0 ? "bg-green-400/10 text-green-300" : "bg-red-400/10 text-red-300"}`}>{p2Delta >= 0 ? "+" : ""}{p2Delta}</p>
                  </div>
                </div>
              );
            }) : (
              <div className="rounded-lg border border-white/10 bg-black/25 p-8 text-center text-slate-400">Your matches will appear here after ranked games.</div>
            )}
          </div>
        </div>
      </motion.section>
    );
  }

  function renderGame() {
    return (
      <motion.section key="game" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -16 }} className="min-h-[calc(100vh-96px)]">
        <AnimatePresence mode="wait">
          {gameState === "menu" && (
            <motion.div key="menu" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="grid min-h-[calc(100vh-120px)] items-center gap-6 lg:grid-cols-[1.05fr_0.95fr]">
              <div className="space-y-5">
                <div className="overflow-hidden rounded-lg border border-white/10 bg-white/[0.06]">
                  <div className="h-32 bg-cover bg-center opacity-80" style={{ backgroundImage: `url(${getImageUrl(account?.bannerUrl)})` }} />
                  <div className="-mt-10 flex flex-col gap-5 p-5 sm:flex-row sm:items-end">
                    <div className="flex min-w-0 items-end gap-4">
                      <img src={getImageUrl(account?.avatarUrl)} alt="" className="h-24 w-24 rounded-lg border-4 border-[#070912] bg-white/10 object-cover" />
                      <div className="min-w-0 pb-1">
                        <p className="font-mono text-sm text-teal-300">@{account?.username}</p>
                        <h1 className="text-4xl font-black uppercase tracking-normal md:text-5xl whitespace-nowrap">{account?.username}</h1>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-4">
                  <Stat icon={<Zap size={20} />} label="Elo" value={String(account?.elo || player.elo)} />
                  <Stat icon={<Trophy size={20} />} label="Best" value={String(account?.bestElo || player.elo)} />
                  <Stat icon={<Swords size={20} />} label="Games" value={String(account?.gamesPlayed || 0)} />
                  <Stat icon={<Flame size={20} />} label="Win Rate" value={`${winRate}%`} />
                </div>
              </div>

              <div className="space-y-4">
                <div className="rounded-lg border border-teal-300/20 bg-teal-300/[0.08] p-5 shadow-[0_0_40px_rgba(45,212,191,0.08)]">
                  <p className="mb-2 flex items-center gap-2 text-sm font-black uppercase tracking-widest text-teal-200"><Sparkles size={18} /> Ready Check</p>
                  <h2 className="text-3xl font-black uppercase tracking-normal">Choose your queue</h2>
                  <p className="mt-2 text-slate-300">Ranked uses your account Elo. Bot matches are safe practice, but still update your current prototype rating.</p>
                  
                  <div className="mt-5 border-t border-white/10 pt-4">
                    <p className="mb-3 text-xs font-bold uppercase tracking-widest text-slate-400">Select Queue Type</p>
                    <div className="grid gap-2 grid-cols-2 mb-4 bg-black/40 p-1.5 rounded-lg border border-white/5">
                      <button
                        onClick={() => { playSound("select"); setQueueMode("global"); setSelectedField("all"); }}
                        className={`py-2.5 text-xs font-black uppercase tracking-wider rounded-md transition-all ${
                          queueMode === "global"
                            ? "bg-teal-300 text-slate-950 shadow-[0_0_15px_rgba(45,212,191,0.15)]"
                            : "text-slate-400 hover:text-white"
                        }`}
                      >
                        Main Queue
                      </button>
                      <button
                        onClick={() => { playSound("select"); setQueueMode("field"); if (selectedField === "all" || !selectedField) setSelectedField("Common / First Year"); }}
                        className={`py-2.5 text-xs font-black uppercase tracking-wider rounded-md transition-all ${
                          queueMode === "field"
                            ? "bg-teal-300 text-slate-950 shadow-[0_0_15px_rgba(45,212,191,0.15)]"
                            : "text-slate-400 hover:text-white"
                        }`}
                      >
                        Field-wise Queue
                      </button>
                    </div>

                    {queueMode === "global" ? (
                      <p className="text-xs text-slate-400 mb-4 leading-relaxed">Global Queue will search for active opponents across all subjects. All disciplines are included in this mode.</p>
                    ) : (
                      <div className="mb-4">
                        <p className="text-xs text-slate-400 mb-3 leading-relaxed">Choose which academic discipline to compete in:</p>
                        <div className="grid gap-2 grid-cols-1 sm:grid-cols-2">
                          {FIELDS.filter(f => f.id !== "all").map(field => {
                            const isSelected = selectedField === field.id;
                            return (
                              <button
                                key={field.id}
                                onClick={() => { playSound("select"); setSelectedField(field.id); }}
                                className={`p-3 rounded-lg border text-left font-bold text-xs uppercase tracking-wider transition-all truncate ${
                                  isSelected 
                                    ? "border-teal-300 bg-teal-300/10 text-teal-200 shadow-[0_0_15px_rgba(45,212,191,0.15)]" 
                                    : "border-white/10 bg-black/20 text-slate-300 hover:border-white/20 hover:bg-black/30"
                                }`}
                              >
                                {field.name}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <button onClick={() => joinQueue(false)} className="rounded-lg bg-teal-300 px-6 py-5 font-black uppercase tracking-widest text-slate-950 hover:bg-teal-200">Find Ranked Match</button>
                    <button onClick={() => joinQueue(true)} className="rounded-lg border border-white/15 bg-white/10 px-6 py-5 font-black uppercase tracking-widest text-white hover:bg-white/15">Play vs AI Bot</button>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {gameState === "queue" && (
            <motion.div key="queue" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="grid min-h-[calc(100vh-120px)] place-items-center text-center">
              <div>
                <div className="mx-auto mb-8 h-32 w-32 animate-spin rounded-full border-4 border-teal-300/20 border-t-teal-300" />
                <h2 className="text-4xl font-black uppercase tracking-widest text-teal-200">Searching</h2>
                <p className="mt-2 font-mono text-slate-400">Looking for a ranked opponent</p>
              </div>
            </motion.div>
          )}

          {gameState === "versus_intro" && (
            <motion.div key="versus" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="relative -mx-4 grid min-h-[calc(100vh-96px)] place-items-center overflow-hidden rounded-lg border border-white/10 bg-black">
              <motion.div initial={{ x: "-100%" }} animate={{ x: 0 }} transition={{ type: "spring", stiffness: 80, damping: 18 }} className="absolute left-0 top-0 h-1/2 w-full overflow-hidden md:h-full md:w-[52%]">
                <div className="absolute inset-0 bg-cover bg-center opacity-60" style={{ backgroundImage: `url(${getImageUrl(player.bannerUrl || account?.bannerUrl)})` }} />
                <div className="absolute inset-0 bg-gradient-to-r from-teal-500/55 via-slate-950/70 to-slate-950/90" />
                <VersusPlayer profile={{ ...player, avatarUrl: getImageUrl(player.avatarUrl || account?.avatarUrl), bannerUrl: getImageUrl(player.bannerUrl || account?.bannerUrl) }} side="left" />
              </motion.div>

              <motion.div initial={{ x: "100%" }} animate={{ x: 0 }} transition={{ type: "spring", stiffness: 80, damping: 18, delay: 0.1 }} className="absolute bottom-0 right-0 h-1/2 w-full overflow-hidden md:h-full md:w-[52%]">
                <div className="absolute inset-0 bg-cover bg-center opacity-60" style={{ backgroundImage: `url(${getImageUrl(opponent.bannerUrl)})` }} />
                <div className="absolute inset-0 bg-gradient-to-l from-red-500/55 via-slate-950/70 to-slate-950/90" />
                <VersusPlayer profile={{ ...opponent, avatarUrl: getImageUrl(opponent.avatarUrl), bannerUrl: getImageUrl(opponent.bannerUrl) }} side="right" />
              </motion.div>

              <div className="absolute top-8 left-1/2 -translate-x-1/2 z-30 rounded-full border border-teal-300/20 bg-teal-950/85 px-4 py-2 text-xs font-black uppercase tracking-widest text-teal-200 backdrop-blur shadow-[0_0_30px_rgba(45,212,191,0.2)]">
                🏟️ {matchData?.domain && matchData.domain !== 'all' ? `${matchData.domain} Arena` : 'All Subjects Arena'}
              </div>

              <motion.div initial={{ scale: 0.5, opacity: 0, rotate: -8 }} animate={{ scale: 1, opacity: 1, rotate: 0 }} transition={{ delay: 0.45, type: "spring", stiffness: 180, damping: 12 }} className="relative z-20 rounded-full bg-white px-6 py-3 text-5xl font-black italic text-slate-950 shadow-[0_0_60px_rgba(255,255,255,0.45)] md:px-8 md:py-4 md:text-7xl">
                VS
              </motion.div>
            </motion.div>
          )}

          {gameState === "initial_discard" && (
            <motion.div key="discard" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="mx-auto flex min-h-[calc(100vh-120px)] max-w-5xl flex-col items-center justify-center gap-8">
              <h2 className="text-center text-4xl font-black uppercase md:text-5xl">Initial Discard Phase</h2>
              <p className="text-center text-slate-300">{lockedSubject === "WAITING" ? "Waiting for opponent to decide..." : "Select up to 1 card to discard from your hand"}</p>
              <div className="grid w-full grid-cols-1 gap-4 md:grid-cols-5">
                {hand.map(sub => (
                  <button key={sub} onClick={() => { if (lockedSubject !== "WAITING") { playSound("select"); setLockedSubject(lockedSubject === sub ? null : sub); } }} disabled={lockedSubject === "WAITING"} className={`flex min-h-36 items-center justify-center rounded-lg border p-4 text-center font-bold transition ${lockedSubject === sub ? "border-red-300 bg-red-500/30 text-white" : "border-white/15 bg-white/[0.06] hover:bg-white/10"}`}>
                    {sub}
                  </button>
                ))}
              </div>
              {lockedSubject !== "WAITING" ? (
                <div className="flex gap-3">
                  <button onClick={() => { playSound("confirm"); socketRef.current?.emit("discard_action", { subject: lockedSubject }); setLockedSubject("WAITING"); }} disabled={!lockedSubject || !hand.includes(lockedSubject)} className="rounded-lg bg-red-500 px-6 py-3 font-black uppercase tracking-widest disabled:opacity-40">Discard</button>
                  <button onClick={() => { playSound("confirm"); socketRef.current?.emit("skip_discard"); setLockedSubject("WAITING"); }} className="rounded-lg border border-white/15 bg-white/10 px-6 py-3 font-black uppercase tracking-widest">Keep All</button>
                </div>
              ) : null}
            </motion.div>
          )}

          {gameState === "drafting" && (
            <motion.div key="drafting" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="mx-auto flex min-h-[calc(100vh-120px)] max-w-5xl flex-col justify-center gap-7">
              <DuelHeader />
              <div className="flex items-end justify-between gap-4">
                <div>
                  <h2 className="text-4xl font-black uppercase">Play a Card</h2>
                  <p className="mt-2 font-mono text-teal-200">{matchData?.draftTurn === socketId ? "YOUR TURN" : "OPPONENT IS PLAYING"}</p>
                </div>
              </div>
              <div className="grid max-h-[54vh] grid-cols-2 gap-4 overflow-y-auto p-1 md:grid-cols-5">
                {matchData?.draftTurn === socketId ? hand.map((sub, index) => (
                  <button key={index + sub} onClick={() => pickSubject(sub)} disabled={lockedSubject !== null} className={`flex min-h-36 flex-col justify-center rounded-lg border p-4 text-center font-bold transition ${lockedSubject === sub ? "border-teal-200 bg-teal-300 text-slate-950" : "border-white/15 bg-white/[0.06] hover:border-teal-300/60 hover:bg-teal-300/10"}`}>
                    {sub}
                  </button>
                )) : [1, 2, 3, 4, 5].map(i => <div key={i} className="grid min-h-36 place-items-center rounded-lg border border-white/10 bg-white/[0.04] text-4xl font-black text-slate-600">?</div>)}
              </div>
            </motion.div>
          )}

          {gameState === "battle" && (
            <motion.div key="battle" initial={{ opacity: 0, scale: 1.02 }} animate={isShaking ? { x: [-10, 10, -10, 10, 0] } : { opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="mx-auto flex min-h-[calc(100vh-120px)] max-w-5xl flex-col justify-center gap-8">
              <DuelHeader />
              <div className="h-2 overflow-hidden rounded-full bg-black/50">
                <motion.div initial={{ width: "100%" }} animate={{ width: `${(timeLeft / (roundData?.question?.timeLimit || 15)) * 100}%` }} transition={{ duration: 0.1, ease: "linear" }} className={`h-full ${timeLeft < 5 ? "bg-red-400" : "bg-teal-300"}`} />
              </div>
              <div className="text-center">
                <p className="mb-5 inline-flex rounded-full border border-amber-300/20 bg-amber-300/10 px-4 py-2 text-xs font-black uppercase tracking-widest text-amber-100">{selectedSubject}</p>
                <h2 className="mx-auto max-w-3xl text-3xl font-black leading-tight md:text-5xl">{roundData?.question.prompt}</h2>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                {roundData?.question.options.map((opt: string, i: number) => {
                  const myAns = socketId && roundResult ? roundResult.answers[socketId]?.answer : null;
                  const oppId = roundResult ? opponent?.id || Object.keys(roundResult.answers).find(id => id !== socketId) : null;
                  const oppAns = oppId && roundResult ? roundResult.answers[oppId]?.answer : null;
                  let buttonClass = "border-white/10 bg-white/[0.06] hover:border-white/30";
                  if (roundResult?.correctAnswer === i) buttonClass = "border-green-400 bg-green-500/20 text-green-200";
                  else if (myAns === i) buttonClass = "border-red-400 bg-red-500/20 text-red-200";
                  else if (oppAns === i) buttonClass = "border-amber-400 bg-amber-500/10 text-amber-100";
                  else if (myAnswer === i) buttonClass = "border-teal-300 bg-teal-300/15 text-teal-100";

                  return (
                    <button key={i} onClick={() => submitAnswer(i)} disabled={!!roundResult || myAnswer !== null} className={`rounded-lg border-2 p-5 text-left text-lg font-bold transition ${buttonClass}`}>
                      <span className="mb-3 block text-xs font-black uppercase tracking-widest opacity-60">Option {i + 1}</span>
                      {opt}
                    </button>
                  );
                })}
              </div>

              <AnimatePresence>
                {roundResult && socketId ? (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.82, y: 20 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    className="pointer-events-none fixed inset-0 z-50 grid place-items-center bg-black/20 backdrop-blur-[2px]"
                  >
                    <div className="max-w-xl rounded-lg border border-white/15 bg-slate-950/95 p-8 text-center shadow-[0_0_70px_rgba(0,0,0,0.8)]">
                      {roundResult.damageDealt[socketId] > 0 ? (
                        <div className="text-red-300">
                          <Skull size={64} className="mx-auto mb-4" />
                          <p className="text-5xl font-black uppercase">-{roundResult.damageDealt[socketId]} HP</p>
                          <p className="mt-3 text-sm font-black uppercase tracking-widest text-red-200/80">
                            {roundResult.answers[socketId] ? "Wrong or slower answer" : "Time out"}
                          </p>
                        </div>
                      ) : opponent.id && roundResult.damageDealt[opponent.id] > 0 ? (
                        <div className="text-teal-200">
                          <Zap size={64} className="mx-auto mb-4" />
                          <p className="text-5xl font-black uppercase">Hit +{roundResult.damageDealt[opponent.id]}</p>
                          <p className="mt-3 text-sm font-black uppercase tracking-widest text-teal-100/80">You dealt damage</p>
                        </div>
                      ) : (
                        <div className="text-amber-200">
                          <Shield size={64} className="mx-auto mb-4" />
                          <p className="text-5xl font-black uppercase">Trade</p>
                          <p className="mt-3 text-sm font-black uppercase tracking-widest text-amber-100/80">Both players took damage</p>
                        </div>
                      )}
                    </div>
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </motion.div>
          )}

          {gameState === "results" && (
            <motion.div key="results" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="grid min-h-[calc(100vh-120px)] place-items-center text-center">
              <div>
                {winnerInfo?.winner === socketId ? <Trophy size={96} className="mx-auto mb-6 text-amber-300" /> : <Skull size={96} className="mx-auto mb-6 text-red-400" />}
                <h2 className="text-6xl font-black uppercase">{winnerInfo?.winner === socketId ? "Victory" : "Defeat"}</h2>
                <div className="mx-auto my-8 w-80 rounded-lg border border-white/10 bg-white/[0.06] p-6">
                  <p className="text-xs font-bold uppercase tracking-widest text-slate-400">New Rating</p>
                  <p className="mt-2 font-mono text-5xl font-black text-teal-200">{winnerInfo?.elo}</p>
                  <p className={`mt-2 font-bold ${(winnerInfo?.eloDelta ?? 0) >= 0 ? "text-green-300" : "text-red-300"}`}>{(winnerInfo?.eloDelta ?? 0) >= 0 ? "+" : ""}{winnerInfo?.eloDelta ?? 0} Elo</p>
                </div>
                <button onClick={() => { playSound("select"); setGameState("menu"); }} className="rounded-lg bg-teal-300 px-8 py-4 font-black uppercase tracking-widest text-slate-950">Return to Menu</button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.section>
    );
  }

  function DuelHeader() {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex justify-center">
          <span className="text-[10px] font-black uppercase tracking-widest text-teal-200 bg-teal-950/80 px-3 py-1 rounded-full border border-teal-500/20 shadow-[0_0_15px_rgba(45,212,191,0.1)]">
            🏟️ {matchData?.domain && matchData.domain !== 'all' ? `${matchData.domain} Arena` : 'All Subjects Arena'}
          </span>
        </div>
        <div className="grid gap-4 rounded-lg border border-white/10 bg-white/[0.06] p-4 md:grid-cols-[1fr_auto_1fr] md:items-center">
          <Fighter name={player.name} elo={player.elo} hp={player.hp} tone="teal" />
          <p className="text-center text-3xl font-black text-slate-500">VS</p>
          <Fighter name={opponent.name} elo={opponent.elo} hp={opponent.hp} tone="red" alignRight />
        </div>
      </div>
    );
  }
}

function Fighter({ name, elo, hp, tone, alignRight = false }: { name: string; elo: number; hp: number; tone: "teal" | "red"; alignRight?: boolean }) {
  const color = tone === "teal" ? "from-teal-300 to-blue-400" : "from-red-400 to-amber-300";

  return (
    <div className={alignRight ? "text-right" : ""}>
      <div className="mb-2 flex justify-between gap-3">
        <span className="font-black">{name}</span>
        <span className="font-mono text-sm text-slate-300">{elo} Elo</span>
      </div>
      <div className="h-3 overflow-hidden rounded-full bg-black/50">
        <div className={`h-full bg-gradient-to-r ${color}`} style={{ width: `${Math.max(0, hp)}%` }} />
      </div>
      <p className="mt-1 font-mono text-xs text-slate-400">{hp} HP</p>
    </div>
  );
}

function VersusPlayer({ profile, side }: { profile: FighterProfile; side: "left" | "right" }) {
  const align = side === "left" ? "items-start text-left md:pl-16 md:pr-28" : "items-end text-right md:pl-28 md:pr-16";

  return (
    <div className={`absolute z-10 flex h-full w-full flex-col justify-center gap-4 p-8 ${align}`}>
      <motion.img
        initial={{ scale: 0.75, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ delay: 0.35 }}
        src={getImageUrl(profile.avatarUrl)}
        alt=""
        className="h-20 w-20 rounded-full border-4 border-white/80 bg-slate-900 object-cover shadow-2xl md:h-24 md:w-24"
      />
      <motion.div initial={{ y: 18, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.5 }} className="max-w-[min(28rem,78vw)] md:max-w-[22rem]">
        <p className="break-words text-3xl font-black uppercase leading-none tracking-normal text-white drop-shadow-lg md:text-4xl">{profile.name}</p>
        <p className="mt-1 font-mono text-lg text-white/80">Rating: {profile.elo.toLocaleString()}</p>
      </motion.div>
    </div>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-black/25 p-4">
      <div className="mb-3 text-teal-200">{icon}</div>
      <p className="text-xs font-bold uppercase tracking-widest text-slate-500">{label}</p>
      <p className="mt-1 font-mono text-2xl font-black text-white">{value}</p>
    </div>
  );
}
