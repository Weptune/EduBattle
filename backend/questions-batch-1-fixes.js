// ============================================
// BATCH 1: Answer Balance Fixes (Lines 1-100)
// ============================================
// These fixes address AI-generated questions where correct answers were
// too detailed/long compared to obviously-wrong filler options.

// BEFORE: "What is a 'buffer solution'?"
// ISSUE: Correct answer 1 long sentence vs other options single short words
// AFTER: Reworded to balance answer lengths
{ prompt: "Which solution resists pH changes when small amounts of acid or base are added?", options: ["Acidic solution","Basic solution","Buffer solution","Neutral solution"], answer: 2, difficulty: 1400, timeLimit: 20 },

// BEFORE: "What does the Schrödinger wave equation describe?"
// ISSUE: Correct answer very specific vs others are vague generic terms
{ prompt: "In quantum mechanics, what does the Schrödinger wave equation describe?", options: ["Particle position precisely","Speed of subatomic particles","The quantum state of a system over time","Energy of light waves"], answer: 2, difficulty: 1600, timeLimit: 20 },

// BEFORE: "What are 'phonons' in solid-state physics?"
// ISSUE: Same pattern - long detailed correct answer
{ prompt: "What best describes a phonon in solid-state physics?", options: ["A light particle","An electron movement","A quantum of vibrational energy in a lattice","A thermal wave"], answer: 2, difficulty: 1700, timeLimit: 20 },

// BEFORE: "In an Operational Amplifier (Op-Amp), what is the 'Virtual Ground' concept?"
// ISSUE: Correct answer is super long technical explanation
{ prompt: "In an inverting op-amp configuration, what is created at the inverting input due to feedback?", options: ["A positive voltage source","A blocking capacitor","A virtual ground condition","An amplified signal"], answer: 2, difficulty: 1800, timeLimit: 20 },

// BEFORE: "Which type of engine burns fuel outside the cylinders?"
// ISSUE: Correct option included parenthetical explanation making it obvious
{ prompt: "Which engine type burns fuel in an external chamber?", options: ["Petrol engine","Diesel engine","Steam engine","Turbine engine"], answer: 2, difficulty: 1200, timeLimit: 20 },

// BEFORE: "What is the function of a clutch in a transmission system?"
// ISSUE: Correct answer long multi-clause vs short distractors
{ prompt: "What primary role does a clutch play in a vehicle?", options: ["Increases torque output","Smoothly engages/disengages engine power","Manages oil pressure","Cools transmission fluid"], answer: 1, difficulty: 1500, timeLimit: 20 },

// BEFORE: "What is the 'swept volume' of a cylinder?"
// ISSUE: Correct answer is long technical definition
{ prompt: "In engine specifications, swept volume measures:", options: ["Fuel tank capacity","Piston displacement distance","Cylinder bore diameter","Total engine weight"], answer: 1, difficulty: 1500, timeLimit: 20 },

// BEFORE: "What are enzymes?"
// ISSUE: Correct answer has parenthetical detail others lack
{ prompt: "What is the primary function of enzymes in cells?", options: ["Store genetic material","Speed up chemical reactions","Transport oxygen","Provide structural support"], answer: 1, difficulty: 1200, timeLimit: 20 },

// BEFORE: "What is 'biomimicry' in engineering?"
// ISSUE: Very long correct answer vs short distractors
{ prompt: "What approach does biomimicry use for engineering?", options: ["Using synthetic materials only","Emulating nature's patterns","Creating artificial systems","Ignoring biological systems"], answer: 1, difficulty: 1500, timeLimit: 20 },

// BEFORE: "What is a 'biosensor'?"
// ISSUE: Extremely detailed correct answer
{ prompt: "A biosensor primarily consists of:", options: ["A simple lens system","A biological element and a transducer","A microscope slide","An optical detector"], answer: 1, difficulty: 1600, timeLimit: 20 },

// BEFORE: "In biomechanics, what does 'Wolff's Law' state?"
// ISSUE: Long correct answer vs single-word distractors
{ prompt: "According to Wolff's Law, how does bone respond to stress?", options: ["It hardens permanently","It weakens steadily","It adapts to applied forces","It remains unchanged"], answer: 2, difficulty: 1500, timeLimit: 20 },

// BEFORE: "What is the primary goal of Data Visualization?"
// ISSUE: Long technical correct answer vs vague distractors
{ prompt: "What is the main purpose of data visualization?", options: ["Hide sensitive data","Reveal patterns and trends","Encrypt information","Simplify code"], answer: 1, difficulty: 1300, timeLimit: 20 },

// BEFORE: "What is a 'Heatmap'?"
// ISSUE: Detailed correct answer vs generic wrong options
{ prompt: "A heatmap is best used for:", options: ["Weather forecasting","Representing data density with colors","Navigation mapping","Traffic monitoring"], answer: 1, difficulty: 1500, timeLimit: 20 },

// BEFORE: "In water treatment, what is 'coagulation'?"
// ISSUE: Long process description as answer
{ prompt: "In water treatment, coagulation serves to:", options: ["Remove salt content","Clump fine particles together","Sterilize the water","Adjust pH levels"], answer: 1, difficulty: 1400, timeLimit: 20 },

// BEFORE: "What is an 'alloy'?"
// ISSUE: Technical definition too detailed vs short wrong answers
{ prompt: "An alloy is composed of:", options: ["Pure copper","One metal only","A mixture including at least one metal","Carbon compounds"], answer: 2, difficulty: 1400, timeLimit: 20 },

// BEFORE: "What defines a 'nanomaterial'?"
// ISSUE: Precise technical definition correct answer
{ prompt: "Nanomaterials are defined by having:", options: ["Very low density","At least one dimension in nanoscale (1-100nm)","Extreme hardness","Magnetic properties"], answer: 1, difficulty: 1500, timeLimit: 20 },

// BEFORE: "What is the 'Octane Number' a measure of?"
// ISSUE: Detailed correct answer vs short wrong ones
{ prompt: "The octane number of gasoline measures:", options: ["Fuel density","Energy output","Resistance to knocking","Viscosity level"], answer: 2, difficulty: 1500, timeLimit: 20 },

// BEFORE: "What does 'sustainable development' mean?"
// ISSUE: Long definition as correct answer
{ prompt: "Sustainable development aims to:", options: ["Maximize profit","Meet present needs without harming future generations","Ignore environmental impact","Speed up consumption"], answer: 1, difficulty: 1400, timeLimit: 20 },

// BEFORE: "What is Biomagnification?"
// ISSUE: Very detailed correct answer
{ prompt: "Biomagnification refers to:", options: ["Enlarging microscope images","Increasing toxic concentration up food chains","Making organisms larger","Strengthening magnetic fields"], answer: 1, difficulty: 1500, timeLimit: 20 },

// BEFORE: "What does a 'Heatmap'?"
// ISSUE: Structured correctly already, included for completeness
{ prompt: "What is a Heatmap used to show?", options: ["Weather patterns","Data density through colors","Geographic terrain","Elevation maps"], answer: 1, difficulty: 1500, timeLimit: 20 },

