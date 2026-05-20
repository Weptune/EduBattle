const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const crypto = require('crypto');
const storage = require('./storage');

const app = express();

const path = require('path');
const fs = require('fs');
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}
app.use('/uploads', express.static(UPLOADS_DIR));

function normalizeOrigin(origin) {
  return origin ? origin.replace(/\/+$/, '') : origin;
}

const allowedOrigins = process.env.CLIENT_ORIGIN
  ? process.env.CLIENT_ORIGIN
      .split(',')
      .map(origin => normalizeOrigin(origin.trim()))
      .filter(Boolean)
  : ['*'];

const allowAllOrigins = allowedOrigins.includes('*');

const corsOptions = {
  origin(origin, callback) {
    if (allowAllOrigins || !origin || allowedOrigins.includes(normalizeOrigin(origin))) {
      callback(null, true);
      return;
    }

    callback(new Error(`Origin ${origin} is not allowed by CORS`));
  },
  methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
};

app.use(cors(corsOptions));
app.use(express.json({ limit: '6mb' }));
const server = http.createServer(app);
const io = new Server(server, {
  cors: corsOptions
});

const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || '0.0.0.0';
const INITIAL_HAND_SIZE = 5;
const INITIAL_DISCARD_MS = 10000;
const DRAFT_PICK_MS = 15000;
const BASE_MATCHMAKING_GAP = 250;
const MATCHMAKING_EXPANSION_PER_5S = 75;
// Basic Game State
let players = {};
let queue = [];
let matches = {};

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.username,
    elo: user.elo,
    avatarUrl: user.avatarUrl,
    bannerUrl: user.bannerUrl,
    bio: user.bio || '',
    wins: user.wins || 0,
    losses: user.losses || 0,
    gamesPlayed: user.gamesPlayed || 0,
    bestElo: user.bestElo || user.elo,
    fieldElos: user.fieldElos || {},
    createdAt: user.createdAt
  };
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}

function verifyPassword(password, user) {
  const { hash } = hashPassword(password, user.passwordSalt);
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(user.passwordHash, 'hex'));
}

async function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  await storage.createSession(token, userId);
  return token;
}

async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const user = await storage.getUserByToken(token);

  if (!user) {
    res.status(401).json({ error: 'You need to be signed in.' });
    return;
  }

  req.user = user;
  req.authToken = token;
  next();
}

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    players: Object.keys(players).length,
    queued: queue.length,
    matches: Object.keys(matches).length
  });
});

app.post('/auth/signup', async (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');

  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
    res.status(400).json({ error: 'Username must be 3-20 characters: letters, numbers, or underscore.' });
    return;
  }

  if (password.length < 6) {
    res.status(400).json({ error: 'Password must be at least 6 characters.' });
    return;
  }

  const existingUser = await storage.getUserByUsername(username);
  if (existingUser) {
    res.status(409).json({ error: 'That username is already taken.' });
    return;
  }

  const { salt, hash } = hashPassword(password);
  const user = {
    id: crypto.randomUUID(),
    username,
    displayName: username,
    passwordSalt: salt,
    passwordHash: hash,
    elo: 1200,
    bestElo: 1200,
    wins: 0,
    losses: 0,
    gamesPlayed: 0,
    avatarUrl: `https://api.dicebear.com/9.x/shapes/svg?seed=${encodeURIComponent(username)}`,
    bannerUrl: `https://images.unsplash.com/photo-1519681393784-d120267933ba?auto=format&fit=crop&w=1400&q=80`,
    bio: 'New challenger in the MIT arena.',
  };

  const createdUser = await storage.createUser(user);

  res.status(201).json({ token: await createSession(createdUser.id), user: publicUser(createdUser) });
});

app.post('/auth/login', async (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  const user = await storage.getUserByUsername(username);

  if (!user || !verifyPassword(password, user)) {
    res.status(401).json({ error: 'Invalid username or password.' });
    return;
  }

  res.json({ token: await createSession(user.id), user: publicUser(user) });
});

app.get('/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

app.patch('/me', requireAuth, async (req, res) => {
  const requestedUsername = String(req.body.username || req.user.username).trim();

  if (!/^[a-zA-Z0-9_]{3,20}$/.test(requestedUsername)) {
    res.status(400).json({ error: 'Username must be 3-20 characters: letters, numbers, or underscore.' });
    return;
  }

  const existingUser = await storage.getUserByUsername(requestedUsername);
  if (existingUser && existingUser.id !== req.user.id) {
    res.status(409).json({ error: 'That username is already taken.' });
    return;
  }

  const updated = await storage.updateUserWith(req.user.id, user => ({
    ...user,
    username: requestedUsername,
    displayName: requestedUsername,
    bio: String(req.body.bio || user.bio || '').trim().slice(0, 140),
    avatarUrl: String(req.body.avatarUrl || user.avatarUrl).trim(),
    bannerUrl: String(req.body.bannerUrl || user.bannerUrl).trim()
  }));

  res.json({ user: publicUser(updated) });
});

function uploadToCloudinary(base64Image) {
  return new Promise((resolve, reject) => {
    const https = require('https');
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    const apiKey = process.env.CLOUDINARY_API_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET;

    if (!cloudName || !apiKey || !apiSecret) {
      return reject(new Error('Cloudinary credentials missing.'));
    }

    const timestamp = Math.round(new Date().getTime() / 1000);
    const folder = 'synapse';
    const signatureStr = `folder=${folder}&timestamp=${timestamp}${apiSecret}`;
    const signature = crypto.createHash('sha1').update(signatureStr).digest('hex');

    const postData = JSON.stringify({
      file: base64Image,
      api_key: apiKey,
      timestamp: timestamp,
      signature: signature,
      folder: folder
    });

    const options = {
      hostname: 'api.cloudinary.com',
      port: 443,
      path: `/v1_1/${cloudName}/image/upload`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          if (res.statusCode >= 200 && res.statusCode < 300 && parsed.secure_url) {
            resolve(parsed.secure_url);
          } else {
            reject(new Error(parsed.error ? parsed.error.message : 'Unknown Cloudinary error'));
          }
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', (e) => reject(e));
    req.write(postData);
    req.end();
  });
}

app.post('/upload', requireAuth, async (req, res) => {
  const { image } = req.body;
  if (!image) {
    res.status(400).json({ error: 'No image data provided.' });
    return;
  }

  // If Cloudinary keys are configured, use Cloudinary
  if (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET) {
    try {
      const url = await uploadToCloudinary(image);
      res.json({ url });
      return;
    } catch (error) {
      console.error('Cloudinary upload failed, trying local fallback:', error);
    }
  }

  try {
    const matches = image.match(/^data:image\/([A-Za-z+]+);base64,(.+)$/);
    if (!matches || matches.length !== 3) {
      res.status(400).json({ error: 'Invalid base64 image data format.' });
      return;
    }

    const ext = matches[1] === 'jpeg' ? 'jpg' : matches[1].replace('xml+svg', 'svg');
    const data = matches[2];
    const buffer = Buffer.from(data, 'base64');
    
    const filename = `${crypto.randomUUID()}.${ext}`;
    const filepath = path.join(UPLOADS_DIR, filename);
    
    fs.writeFileSync(filepath, buffer);
    
    const imageUrl = `/uploads/${filename}`;
    res.json({ url: imageUrl });
  } catch (error) {
    console.error('Local upload failed:', error);
    res.status(500).json({ error: 'Failed to save upload.' });
  }
});

app.post('/auth/logout', requireAuth, async (req, res) => {
  await storage.deleteSession(req.authToken);
  res.json({ ok: true });
});

app.get('/leaderboard', async (req, res) => {
  const users = await storage.listUsers();
  res.json({
    leaderboard: users.slice(0, 50).map((user, index) => ({
      rank: index + 1,
      user: publicUser(user)
    }))
  });
});

app.get('/me/matches', requireAuth, async (req, res) => {
  const matches = await storage.listRecentMatches(req.user.id, 20);
  res.json({ matches });
});

const SUBJECT_CATEGORIES = require('./subjects');
const QUESTIONS = require('./questions');
const ALL_SUBJECTS = Object.values(SUBJECT_CATEGORIES).flat();
const RANKED_SUBJECTS = ALL_SUBJECTS.filter(subject => QUESTIONS[subject]?.length);

function normalizeDomain(domain) {
  if (!domain || domain === 'all') return 'all';
  return SUBJECT_CATEGORIES[domain] ? domain : 'all';
}

function getSubjectPool(domain = 'all') {
  const normalizedDomain = normalizeDomain(domain);
  const source = normalizedDomain === 'all' ? ALL_SUBJECTS : SUBJECT_CATEGORIES[normalizedDomain];
  const rankedPool = source.filter(subject => QUESTIONS[subject]?.length);
  return rankedPool.length > 0 ? rankedPool : source;
}

function shuffleQuestionOptions(question) {
  const correctText = question.options[question.answer];
  const options = [...question.options];
  for (let i = options.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [options[i], options[j]] = [options[j], options[i]];
  }
  return {
    ...question,
    options,
    answer: options.indexOf(correctText)
  };
}

function getRandomSubjects(count, pool = RANKED_SUBJECTS, exclude = []) {
  let available = pool.filter(s => !exclude.includes(s));
  let result = [];
  for (let i = 0; i < count; i++) {
    if (available.length === 0) available = pool.filter(s => !result.includes(s));
    if (available.length === 0) available = [...pool];
    const idx = Math.floor(Math.random() * available.length);
    result.push(available[idx]);
    available.splice(idx, 1);
  }
  return result;
}

async function createPlayer(socket, data = {}) {
  const user = await storage.getUserByToken(data.authToken);
  if (!user) return null;

  const domain = normalizeDomain(data.domain);
  const fieldElos = user.fieldElos || {};
  let elo = user.elo || 1200;
  if (domain && domain !== 'all') {
    elo = fieldElos[domain] || 1200;
  }

  return {
    id: socket.id,
    userId: user.id,
    name: user.username,
    username: user.username,
    elo: elo,
    avatarUrl: user.avatarUrl,
    bannerUrl: user.bannerUrl,
    hp: 100,
    socketId: socket.id,
    domain: domain,
    queuedAt: Date.now()
  };
}

function publicPlayer(player) {
  return {
    id: player.id,
    name: player.name,
    username: player.username,
    elo: player.elo,
    avatarUrl: player.avatarUrl,
    bannerUrl: player.bannerUrl,
    hp: player.hp,
    isBot: Boolean(player.isBot)
  };
}

function publicMatch(match) {
  return {
    id: match.id,
    p1: publicPlayer(match.p1),
    p2: publicPlayer(match.p2),
    state: match.state,
    domain: match.domain,
    subjects: match.subjects,
    draftTurn: match.draftTurn,
    selectedSubject: match.selectedSubject,
    currentRound: match.currentRound
  };
}

function emitToPlayer(player, event, payload) {
  if (!player.isBot) io.to(player.socketId).emit(event, payload);
}

function removeFromQueue(playerId) {
  queue = queue.filter(p => p.id !== playerId);
}

function findRankedOpponent(player) {
  let bestIndex = -1;
  let bestDiff = Infinity;
  const now = Date.now();

  queue.forEach((candidate, index) => {
    if (candidate.domain !== player.domain) return;

    const waitSeconds = Math.max(
      (now - candidate.queuedAt) / 1000,
      (now - player.queuedAt) / 1000
    );
    const allowedGap = BASE_MATCHMAKING_GAP + Math.floor(waitSeconds / 5) * MATCHMAKING_EXPANSION_PER_5S;
    const diff = Math.abs(candidate.elo - player.elo);

    if (diff <= allowedGap && diff < bestDiff) {
      bestDiff = diff;
      bestIndex = index;
    }
  });

  return bestIndex;
}

function createMatch(p1, p2, domain = 'all') {
  const normalizedDomain = normalizeDomain(domain);
  const subjectPool = getSubjectPool(normalizedDomain);
  const matchId = `match_${p1.id}_${p2.id}`;
  
  const match = {
    id: matchId,
    p1,
    p2,
    state: 'initial_discard',
    domain: normalizedDomain,
    subjects: SUBJECT_CATEGORIES,
    subjectPool,
    usedSubjects: [],
    draftTurn: Math.random() > 0.5 ? p2.id : p1.id,
    selectedSubject: null,
    currentRound: 0,
    questions: [],
  };

  matches[matchId] = match;
  p1.matchId = matchId;
  p2.matchId = matchId;
  p1.eloBeforeMatch = p1.elo;
  p2.eloBeforeMatch = p2.elo;
  p1.hand = getRandomSubjects(INITIAL_HAND_SIZE, subjectPool);
  p2.hand = getRandomSubjects(INITIAL_HAND_SIZE, subjectPool);
  p1.hasDiscarded = Boolean(p1.isBot);
  p2.hasDiscarded = Boolean(p2.isBot);

  return match;
}

function emitMatchFound(match) {
  emitToPlayer(match.p1, 'match_found', {
    match: publicMatch(match),
    opponent: publicPlayer(match.p2),
    hand: match.p1.hand
  });
  emitToPlayer(match.p2, 'match_found', {
    match: publicMatch(match),
    opponent: publicPlayer(match.p1),
    hand: match.p2.hand
  });
}

io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  socket.on('join_queue', async (data) => {
    removeFromQueue(socket.id);
    const player = await createPlayer(socket, data);
    if (!player) {
      socket.emit('auth_required');
      return;
    }
    players[socket.id] = player;
    
    const opponentIndex = findRankedOpponent(player);
    if (opponentIndex !== -1) {
      const [opponent] = queue.splice(opponentIndex, 1);
      const match = createMatch(opponent, player, player.domain);
      emitMatchFound(match);
      startDiscardTimer(match.id);
    } else {
      queue.push(player);
      socket.emit('waiting_in_queue');
    }
  });

  function handleAnswer(playerId, answerIndex) {
    const player = players[playerId];
    if (!player || !player.matchId) return;
    const match = matches[player.matchId];
    if (!match || match.state !== 'battle') return;

    const roundData = match.roundState;
    if (!roundData || roundData.answers[playerId]) return;
    
    const timeTaken = Date.now() - roundData.startTime;
    roundData.answers[playerId] = {
      answer: answerIndex,
      timeTaken
    };

    if (Object.keys(roundData.answers).length === 2) {
      resolveRound(match);
    }
  }

  socket.on('join_bot_queue', async (data) => {
    removeFromQueue(socket.id);
    const player = await createPlayer(socket, data);
    if (!player) {
      socket.emit('auth_required');
      return;
    }
    players[socket.id] = player;
    
    const bot = {
      id: 'bot_' + Date.now(),
      name: 'AlphaZero (Bot)',
      username: 'bot',
      elo: 3000,
      avatarUrl: 'https://api.dicebear.com/9.x/bottts/svg?seed=AlphaZero',
      bannerUrl: 'https://images.unsplash.com/photo-1511512578047-dfb367046420?auto=format&fit=crop&w=1400&q=80',
      hp: 100,
      socketId: 'bot_socket',
      isBot: true,
      domain: player.domain
    };
    players[bot.id] = bot;

    const match = createMatch(bot, player, player.domain);
    emitMatchFound(match);
    startDiscardTimer(match.id);
  });

  socket.on('discard_action', (data) => {
    const player = players[socket.id];
    if (player && player.matchId && matches[player.matchId]) {
      const match = matches[player.matchId];
      if (match.state === 'initial_discard' && !player.hasDiscarded) {
        if (data.subject && player.hand.includes(data.subject)) {
          player.hand = player.hand.filter(s => s !== data.subject);
          player.hand.push(getRandomSubjects(1, match.subjectPool, player.hand)[0]);
        }
        player.hasDiscarded = true;
        socket.emit('hand_updated', { hand: player.hand });
        checkDiscardPhase(match);
      }
    }
  });

  socket.on('skip_discard', () => {
    const player = players[socket.id];
    if (player && player.matchId && matches[player.matchId]) {
      const match = matches[player.matchId];
      if (match.state === 'initial_discard' && !player.hasDiscarded) {
        player.hasDiscarded = true;
        checkDiscardPhase(match);
      }
    }
  });

  socket.on('draft_action', (data) => {
    const player = players[socket.id];
    if (player && player.matchId && matches[player.matchId]) {
      processDraft(matches[player.matchId], socket.id, data.subject);
    }
  });

  socket.on('submit_answer', (data) => {
    handleAnswer(socket.id, data.answerIndex);
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    const player = players[socket.id];
    if (player) {
      queue = queue.filter(p => p.id !== socket.id);
      if (player.matchId && matches[player.matchId]) {
        const match = matches[player.matchId];
        const oppId = match.p1.id === socket.id ? match.p2.socketId : match.p1.socketId;
        io.to(oppId).emit('opponent_disconnected');
        delete matches[player.matchId];
      }
      delete players[socket.id];
    }
  });
});

function processDraft(match, playerId, subject) {
  if (match.draftTurn !== playerId) return; 
  if (match.state !== 'drafting') return;
  
  const player = match.p1.id === playerId ? match.p1 : match.p2;
  if (!player.hand.includes(subject)) return;

  if (match.draftTimer) clearTimeout(match.draftTimer);
  
  // Replace card
  player.hand = player.hand.filter(s => s !== subject);
  player.hand.push(getRandomSubjects(1, match.subjectPool, [...player.hand, subject])[0]);
  match.usedSubjects.push(subject);
  emitToPlayer(player, 'hand_updated', { hand: player.hand });

  match.selectedSubject = subject;
  match.state = 'battle';
  
  let pool = QUESTIONS[match.selectedSubject];
  if (!pool || pool.length === 0) {
    pool = [];
    for (let i = 0; i < 10; i++) {
      const difficulty = 1000 + (i * 100);
      const isHard = i >= 6;
      pool.push({
        prompt: isHard 
          ? `Advanced Scenario: Applying principles of ${match.selectedSubject} in a complex system requires which of the following?`
          : `Core Foundation: Which of these best describes the primary focus of ${match.selectedSubject}?`,
        options: [
          isHard ? `Multi-variable optimization specific to ${match.selectedSubject}` : `Fundamental theory of ${match.selectedSubject}`,
          `Unrelated concept from a different engineering branch`,
          `Common misconception often taught incorrectly`,
          `Outdated theory no longer used in modern applications`
        ],
        answer: 0,
        difficulty: difficulty,
        timeLimit: 30
      });
    }
  }
  
  const avgElo = (match.p1.elo + match.p2.elo) / 2;
  
  const sortedPool = [...pool].sort((a, b) => Math.abs(a.difficulty - avgElo) - Math.abs(b.difficulty - avgElo));
  const candidates = sortedPool.slice(0, 3); // pick from the top 3 closest difficulty questions
  const randomQuestion = shuffleQuestionOptions(
    candidates[Math.floor(Math.random() * candidates.length)]
  );

  match.questions[match.currentRound] = randomQuestion;

  emitToPlayer(match.p1, 'draft_complete', { subject: match.selectedSubject });
  emitToPlayer(match.p2, 'draft_complete', { subject: match.selectedSubject });
  
  setTimeout(() => startNextRound(match), 2000);
}

function startNextRound(match) {
  if (match.p1.hp <= 0 || match.p2.hp <= 0) {
    endMatch(match);
    return;
  }
  
  const question = match.questions[match.currentRound];
  match.roundState = {
    startTime: Date.now(),
    answers: {},
    question: question
  };

  const payload = {
    round: match.currentRound + 1,
    question: {
      prompt: question.prompt,
      options: question.options,
      timeLimit: question.timeLimit
    }
  };

  emitToPlayer(match.p1, 'round_start', payload);
  emitToPlayer(match.p2, 'round_start', payload);

  // Set timer to auto-resolve if no answers
  match.roundTimer = setTimeout(() => {
    resolveRound(match);
  }, question.timeLimit * 1000 + 2000); 

  if (match.p1.isBot || match.p2.isBot) {
    const botId = match.p1.isBot ? match.p1.id : match.p2.id;
    const delay = 1500 + Math.random() * 3000;
    setTimeout(() => {
      if (matches[match.id] && match.roundState && Object.keys(match.roundState.answers).length < 2) {
         const isCorrect = Math.random() > 0.48;
         const ansIndex = isCorrect ? question.answer : Math.floor(Math.random() * question.options.length);
         // Find handleAnswer equivalent here, wait, I defined handleAnswer inside io.on('connection') closure
         // This is a bug if I call it from startNextRound.
         // Let's inline bot answering logic.
         match.roundState.answers[botId] = { answer: ansIndex, timeTaken: delay };
         if (Object.keys(match.roundState.answers).length === 2) {
           resolveRound(match);
         }
      }
    }, delay);
  }
}

function resolveRound(match) {
  if (match.roundTimer) clearTimeout(match.roundTimer);
  
  const question = match.roundState.question;
  const answers = match.roundState.answers;
  
  let p1Damage = 0;
  let p2Damage = 0;
  const ans1 = answers[match.p1.id];
  const ans2 = answers[match.p2.id];
  const p1Correct = Boolean(ans1 && ans1.answer === question.answer);
  const p2Correct = Boolean(ans2 && ans2.answer === question.answer);
  
  if (p1Correct && !p2Correct) {
    p2Damage = 25;
  } else if (!p1Correct && p2Correct) {
    p1Damage = 25;
  } else if (p1Correct && p2Correct) {
    // Both correct: Speed battle
    const diff = Math.abs(ans1.timeTaken - ans2.timeTaken);
    const speedDamage = Math.min(20, Math.max(1, Math.ceil(diff / 250)));
    if (ans1.timeTaken < ans2.timeTaken) {
      p2Damage = speedDamage;
    } else if (ans2.timeTaken < ans1.timeTaken) {
      p1Damage = speedDamage;
    }
  } else if (!p1Correct && !p2Correct) {
    p1Damage = 25;
    p2Damage = 25;
  }

  p1Damage = Math.min(25, p1Damage);
  p2Damage = Math.min(25, p2Damage);

  match.p1.hp = Math.max(0, match.p1.hp - p1Damage);
  match.p2.hp = Math.max(0, match.p2.hp - p2Damage);

  const resultPayload = {
    answers,
    correctAnswer: question.answer,
    hpData: {
      [match.p1.id]: match.p1.hp,
      [match.p2.id]: match.p2.hp
    },
    damageDealt: { [match.p1.id]: p1Damage, [match.p2.id]: p2Damage }
  };

  emitToPlayer(match.p1, 'round_result', resultPayload);
  emitToPlayer(match.p2, 'round_result', resultPayload);

  if (match.p1.hp === 0 || match.p2.hp === 0) {
    setTimeout(() => endMatch(match), 3000);
  } else {
    match.currentRound++;
    match.draftTurn = match.draftTurn === match.p1.id ? match.p2.id : match.p1.id;
    match.state = 'drafting';
    
    setTimeout(() => {
      emitToPlayer(match.p1, 'back_to_draft', { draftTurn: match.draftTurn, round: match.currentRound + 1 });
      emitToPlayer(match.p2, 'back_to_draft', { draftTurn: match.draftTurn, round: match.currentRound + 1 });
      
      startDraftTimer(match.id);
      
      const botId = match.p1.isBot ? match.p1.id : match.p2.isBot ? match.p2.id : null;
      if (botId && match.draftTurn === botId) {
        setTimeout(() => {
          if (matches[match.id] && matches[match.id].state === 'drafting') {
            const botPlayer = match.p1.isBot ? match.p1 : match.p2;
            const randomSubject = botPlayer.hand[Math.floor(Math.random() * botPlayer.hand.length)];
            processDraft(matches[match.id], botId, randomSubject);
          }
        }, 1500);
      }
    }, 4000);
  }
}

async function endMatch(match) {
  match.state = 'finished';
  let winner = null;
  let loser = null;
  if (match.p1.hp > match.p2.hp) {
    winner = match.p1;
    loser = match.p2;
  } else if (match.p2.hp > match.p1.hp) {
    winner = match.p2;
    loser = match.p1;
  }

  const isBotMatch = Boolean(match.p1.isBot || match.p2.isBot);

  // Robust ELO calculation
  if (winner && loser) {
    let winnerDelta = 0;
    let loserDelta = 0;

    if (!isBotMatch) {
      // Dynamic K-Factor: new/lower-ranked players swing faster
      let K_winner = winner.elo < 1300 ? 50 : (winner.elo > 1800 ? 16 : 32);
      let K_loser = loser.elo < 1300 ? 50 : (loser.elo > 1800 ? 16 : 32);

      const expectedWinner = 1 / (1 + Math.pow(10, (loser.elo - winner.elo) / 400));
      const expectedLoser = 1 / (1 + Math.pow(10, (winner.elo - loser.elo) / 400));

      // Margin of Victory Multiplier (up to 1.5x for a flawless 100HP win)
      const marginMultiplier = 1 + (winner.hp / 100) * 0.5;

      winnerDelta = Math.round(K_winner * marginMultiplier * (1 - expectedWinner));
      loserDelta = Math.round(K_loser * marginMultiplier * (0 - expectedLoser));

      winner.elo = winner.elo + winnerDelta;
      loser.elo = Math.max(0, loser.elo + loserDelta);
    }
    
    winner.eloDelta = winnerDelta;
    loser.eloDelta = loserDelta;

    if (!winner.isBot && winner.userId) {
      await storage.updateUserWith(winner.userId, user => {
        const nextUser = {
          ...user,
          wins: (user.wins || 0) + 1,
          gamesPlayed: (user.gamesPlayed || 0) + 1
        };
        if (!isBotMatch) {
          const domain = match.domain;
          if (domain && domain !== 'all') {
            const elos = user.fieldElos || {};
            elos[domain] = winner.elo;
            nextUser.fieldElos = elos;
          } else {
            nextUser.elo = winner.elo;
            nextUser.bestElo = Math.max(user.bestElo || user.elo || 1200, winner.elo);
          }
        }
        return nextUser;
      });
    }

    if (!loser.isBot && loser.userId) {
      await storage.updateUserWith(loser.userId, user => {
        const nextUser = {
          ...user,
          losses: (user.losses || 0) + 1,
          gamesPlayed: (user.gamesPlayed || 0) + 1
        };
        if (!isBotMatch) {
          const domain = match.domain;
          if (domain && domain !== 'all') {
            const elos = user.fieldElos || {};
            elos[domain] = loser.elo;
            nextUser.fieldElos = elos;
          } else {
            nextUser.elo = loser.elo;
          }
        }
        return nextUser;
      });
    }

    await storage.recordMatch({
      id: match.id,
      winnerId: winner.isBot ? null : winner.userId,
      loserId: loser.isBot ? null : loser.userId,
      playerOneId: match.p1.isBot ? null : match.p1.userId,
      playerTwoId: match.p2.isBot ? null : match.p2.userId,
      playerOneName: match.p1.name,
      playerTwoName: match.p2.name,
      playerOneEloBefore: match.p1.eloBeforeMatch || match.p1.elo,
      playerTwoEloBefore: match.p2.eloBeforeMatch || match.p2.elo,
      playerOneEloAfter: match.p1.elo,
      playerTwoEloAfter: match.p2.elo,
      playerOneDelta: match.p1.eloDelta || 0,
      playerTwoDelta: match.p2.eloDelta || 0,
      rounds: match.currentRound + 1,
      finishedAt: new Date().toISOString(),
      domain: match.domain || 'all'
    });
  }

  emitToPlayer(match.p1, 'match_end', { winner: winner ? winner.id : 'draw', elo: match.p1.elo, eloDelta: match.p1.eloDelta || 0 });
  emitToPlayer(match.p2, 'match_end', { winner: winner ? winner.id : 'draw', elo: match.p2.elo, eloDelta: match.p2.eloDelta || 0 });

  delete matches[match.id];
}

function startDraftTimer(matchId) {
  const match = matches[matchId];
  if (!match) return;
  if (match.draftTimer) clearTimeout(match.draftTimer);
  
  match.draftTimer = setTimeout(() => {
    if (matches[matchId] && matches[matchId].state === 'drafting') {
      const player = match.p1.id === match.draftTurn ? match.p1 : match.p2;
      const randomSubject = player.hand[Math.floor(Math.random() * player.hand.length)];
      processDraft(matches[matchId], match.draftTurn, randomSubject);
    }
  }, DRAFT_PICK_MS);
}

function startDiscardTimer(matchId) {
  const match = matches[matchId];
  if (!match) return;
  if (match.draftTimer) clearTimeout(match.draftTimer);
  
  match.draftTimer = setTimeout(() => {
    if (matches[matchId] && matches[matchId].state === 'initial_discard') {
      match.p1.hasDiscarded = true;
      match.p2.hasDiscarded = true;
      checkDiscardPhase(matches[matchId]);
    }
  }, INITIAL_DISCARD_MS);
}

function checkDiscardPhase(match) {
  if (match.p1.hasDiscarded && match.p2.hasDiscarded && match.state === 'initial_discard') {
    if (match.draftTimer) clearTimeout(match.draftTimer);
    match.state = 'drafting';
    emitToPlayer(match.p1, 'discard_phase_end', { match: publicMatch(match) });
    emitToPlayer(match.p2, 'discard_phase_end', { match: publicMatch(match) });
    startDraftTimer(match.id);
    
    const botId = match.p1.isBot ? match.p1.id : match.p2.isBot ? match.p2.id : null;
    if (botId && match.draftTurn === botId) {
      setTimeout(() => {
        if (matches[match.id] && matches[match.id].state === 'drafting') {
          const botPlayer = match.p1.isBot ? match.p1 : match.p2;
          const randomSubject = botPlayer.hand[Math.floor(Math.random() * botPlayer.hand.length)];
          processDraft(matches[match.id], botId, randomSubject);
        }
      }, 1500);
    }
  }
}

storage.init()
  .then(() => {
    server.listen(PORT, HOST, () => {
      console.log(`Server listening on ${HOST}:${PORT}`);
    });
  })
  .catch(error => {
    console.error('Failed to initialize storage:', error);
    process.exit(1);
  });
