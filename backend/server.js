require('dotenv').config();
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

app.get('/assets/:assetId', async (req, res) => {
  try {
    const asset = await storage.getUserAsset(req.params.assetId);
    if (!asset) {
      res.status(404).end();
      return;
    }

    const buffer = Buffer.from(asset.dataBase64, 'base64');
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    res.type(asset.mimeType).send(buffer);
  } catch (error) {
    console.error('Failed to serve asset:', error);
    res.status(500).end();
  }
});

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
const INITIAL_DISCARD_MS = 13000; // 10s discard phase + 3s versus intro buffer to prevent early timing skips
const DRAFT_PICK_MS = 15000;
const BASE_MATCHMAKING_GAP = 250;
const MATCHMAKING_EXPANSION_PER_5S = 75;
const PVP_SPEED_DIVISOR = 250;
const BOT_SPEED_HUMAN_ADVANTAGE_DIVISOR = 175;
const BOT_SPEED_BOT_ADVANTAGE_DIVISOR = 400;
// Basic Game State
let players = {};
let queue = [];
let matches = {};
const userSockets = new Map();
const activeChallenges = new Map();

async function notifyFriendsStatusChange(userId, isOnline) {
  try {
    const friendships = await storage.getFriendships(userId);
    const acceptedFriends = friendships.filter(f => f.status === 'accepted').map(f => f.friend.id);
    for (const friendId of acceptedFriends) {
      const friendSocketId = userSockets.get(friendId);
      if (friendSocketId) {
        io.to(friendSocketId).emit('friend_status_change', {
          friendId: userId,
          isOnline: isOnline
        });
      }
    }
  } catch (err) {
    console.error('Failed to notify friends status change:', err);
  }
}

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
    botWins: user.botWins || 0,
    botLosses: user.botLosses || 0,
    botGamesPlayed: user.botGamesPlayed || 0,
    bestElo: user.bestElo || user.elo,
    fieldElos: user.fieldElos || {},
    fieldStats: user.fieldStats || {},
    xp: user.xp || 0,
    level: user.level || 1,
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
    bio: 'hi',
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
    const matches = image.match(/^data:image\/([A-Za-z0-9+.-]+);base64,(.+)$/);
    if (!matches || matches.length !== 3) {
      res.status(400).json({ error: 'Invalid base64 image data format.' });
      return;
    }

    const subtype = matches[1] === 'jpeg' ? 'jpeg' : matches[1].replace('xml+svg', 'svg');
    const mimeType = `image/${subtype}`;
    const data = matches[2];

    const assetId = await storage.saveUserAsset(req.user.id, mimeType, data);
    res.json({ url: `/assets/${assetId}` });
  } catch (error) {
    console.error('Database upload failed:', error);
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
  const matches = await storage.listRecentMatches(req.user.id, 100);
  res.json({ matches });
});

app.get('/friends', requireAuth, async (req, res) => {
  try {
    const list = await storage.getFriendships(req.user.id);
    const friends = list.filter(f => f.status === 'accepted');
    const incomingRequests = list.filter(f => f.status === 'pending' && f.isIncomingRequest);
    const outgoingRequests = list.filter(f => f.status === 'pending' && f.isOutgoingRequest);
    res.json({ friends, incomingRequests, outgoingRequests });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/chat/messages', requireAuth, async (req, res) => {
  try {
    const messages = await storage.listArenaChatMessages(100);
    res.json({ messages });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/chat/dms/:friendId', requireAuth, async (req, res) => {
  try {
    const friendId = req.params.friendId;
    const messages = await storage.listDirectMessages(req.user.id, friendId, 50);
    await storage.markDMsAsRead(friendId, req.user.id);
    res.json({ messages });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/friends/request', requireAuth, async (req, res) => {
  try {
    const friendUsername = String(req.body.friendUsername || '').trim();
    if (!friendUsername) return res.status(400).json({ error: 'Username is required.' });

    const targetUser = await storage.getUserByUsername(friendUsername);
    if (!targetUser) return res.status(404).json({ error: 'User not found.' });

    await storage.createFriendRequest(req.user.id, targetUser.id);

    const targetSocketId = userSockets.get(targetUser.id);
    if (targetSocketId) {
      io.to(targetSocketId).emit('friend_request_received', { requester: publicUser(req.user) });
    }

    res.json({ ok: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/friends/accept', requireAuth, async (req, res) => {
  try {
    const { friendId } = req.body;
    if (!friendId) return res.status(400).json({ error: 'Friend ID is required.' });

    await storage.acceptFriendRequest(req.user.id, friendId);

    const friendSocketId = userSockets.get(friendId);
    if (friendSocketId) {
      io.to(friendSocketId).emit('friend_request_accepted', { friendId: req.user.id });
    }

    res.json({ ok: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/friends/remove', requireAuth, async (req, res) => {
  try {
    const { friendId } = req.body;
    if (!friendId) return res.status(400).json({ error: 'Friend ID is required.' });

    await storage.removeFriendship(req.user.id, friendId);

    const friendSocketId = userSockets.get(friendId);
    if (friendSocketId) {
      io.to(friendSocketId).emit('friend_request_received');
    }

    res.json({ ok: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/users/by-username/:username', requireAuth, async (req, res) => {
  try {
    const user = await storage.getUserByUsername(req.params.username);
    if (!user) return res.status(404).json({ error: 'User not found.' });
    const matches = await storage.listRecentMatches(user.id, 10);
    res.json({ user: publicUser(user), matches });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/users/:id', requireAuth, async (req, res) => {
  try {
    const user = await storage.getUserById(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found.' });
    const matches = await storage.listRecentMatches(user.id, 10);
    res.json({ user: publicUser(user), matches });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
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

function getQuestionKey(question) {
  return question.prompt;
}

function buildFallbackQuestionPool(subject) {
  const pool = [];
  for (let i = 0; i < 10; i++) {
    const difficulty = 1000 + (i * 100);
    const isHard = i >= 6;
    pool.push({
      prompt: isHard
        ? `Advanced Scenario ${i + 1}: Applying principles of ${subject} in a complex system requires which of the following?`
        : `Core Foundation ${i + 1}: Which of these best describes the primary focus of ${subject}?`,
      options: [
        isHard ? `Multi-variable optimization specific to ${subject}` : `Fundamental theory of ${subject}`,
        'Unrelated concept from a different engineering branch',
        'Common misconception often taught incorrectly',
        'Outdated theory no longer used in modern applications'
      ],
      answer: 0,
      difficulty,
      timeLimit: 30
    });
  }
  return pool;
}

function getQuestionPoolForSubject(subject) {
  const pool = QUESTIONS[subject];
  return pool && pool.length > 0 ? pool : buildFallbackQuestionPool(subject);
}

function pickQuestionForMatch(match, subject) {
  if (!match.usedQuestionKeys) {
    match.usedQuestionKeys = new Set();
  }

  const pool = getQuestionPoolForSubject(subject);
  let available = pool.filter(question => !match.usedQuestionKeys.has(getQuestionKey(question)));

  // Only reuse questions after every question for this subject has been played once.
  if (available.length === 0) {
    available = [...pool];
  }

  const avgElo = (match.p1.elo + match.p2.elo) / 2;
  const sortedPool = [...available].sort(
    (a, b) => Math.abs(a.difficulty - avgElo) - Math.abs(b.difficulty - avgElo)
  );

  const candidateCount = Math.min(
    sortedPool.length,
    Math.max(5, Math.ceil(sortedPool.length * 0.2))
  );
  const candidates = sortedPool.slice(0, candidateCount);
  const picked = shuffleQuestionOptions(
    candidates[Math.floor(Math.random() * candidates.length)]
  );

  match.usedQuestionKeys.add(getQuestionKey(picked));
  return picked;
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
    queuedAt: Date.now(),
    level: user.level || 1
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
    level: player.level || 1,
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
    usedQuestionKeys: new Set(),
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

  socket.on('register_socket', async (data) => {
    if (!data || !data.authToken) return;
    const user = await storage.getUserByToken(data.authToken);
    if (user) {
      userSockets.set(user.id, socket.id);
      socket.userId = user.id;
      console.log(`Registered socket ${socket.id} to user ${user.username}`);
      await notifyFriendsStatusChange(user.id, true);

      const friendships = await storage.getFriendships(user.id);
      const friends = friendships.filter(f => f.status === 'accepted');
      for (const f of friends) {
        const friendId = f.friend.id;
        if (userSockets.has(friendId)) {
          socket.emit('friend_status_change', { friendId, isOnline: true });
        }
      }
    }
  });

  socket.on('send_chat_message', async (data) => {
    if (!socket.userId || !data || !data.message) return;
    const user = await storage.getUserById(socket.userId);
    if (!user) return;

    const text = String(data.message).trim().slice(0, 300);
    if (!text) return;

    const chatMsg = {
      id: 'msg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
      userId: user.id,
      username: user.username,
      avatarUrl: user.avatarUrl,
      bannerUrl: user.bannerUrl,
      elo: user.elo,
      level: user.level || 1,
      message: text,
      timestamp: new Date().toISOString()
    };

    try {
      await storage.saveArenaChatMessage(chatMsg);
      io.emit('chat_message', chatMsg);
    } catch (err) {
      console.error('Failed to save chat message:', err);
      socket.emit('chat_error', { error: 'Message could not be saved.' });
    }
  });

  socket.on('send_direct_message', async (data) => {
    if (!socket.userId || !data || !data.recipientId || !data.message) return;
    const user = await storage.getUserById(socket.userId);
    if (!user) return;

    const text = String(data.message).trim().slice(0, 500);
    if (!text) return;

    const dm = {
      id: 'dm_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
      senderId: user.id,
      receiverId: data.recipientId,
      message: text,
      isRead: false,
      createdAt: new Date().toISOString(),
      sender: {
        id: user.id,
        username: user.username,
        avatarUrl: user.avatarUrl
      }
    };

    try {
      await storage.saveDirectMessage(dm);
      socket.emit('direct_message', dm);
      const recipientSocketId = userSockets.get(data.recipientId);
      if (recipientSocketId) {
        io.to(recipientSocketId).emit('direct_message', dm);
      }
    } catch (err) {
      console.error('Failed to save/send direct message:', err);
      socket.emit('chat_error', { error: 'Direct message could not be sent.' });
    }
  });

  socket.on('battle_reaction', (data) => {
    if (!socket.userId || !data || !data.reaction) return;
    const player = players[socket.id];
    if (!player || !player.matchId) return;
    const match = matches[player.matchId];
    if (!match) return;

    const isP1 = match.p1.id === player.id;
    const opponent = isP1 ? match.p2 : match.p1;

    // Broadcast back to sender to sync
    socket.emit('battle_reaction', {
      senderId: player.id,
      reaction: data.reaction
    });

    if (opponent) {
      if (opponent.isBot) {
        // Trigger a bot reaction back with 40% probability after a small delay
        if (Math.random() < 0.4) {
          setTimeout(() => {
            const botReactions = ['GG', 'Wow!', 'Close One!', 'Thinking...', 'Angry'];
            const randomReaction = botReactions[Math.floor(Math.random() * botReactions.length)];
            socket.emit('battle_reaction', {
              senderId: opponent.id,
              reaction: randomReaction
            });
          }, 1200);
        }
      } else {
        const opponentSocketId = userSockets.get(opponent.id);
        if (opponentSocketId) {
          io.to(opponentSocketId).emit('battle_reaction', {
            senderId: player.id,
            reaction: data.reaction
          });
        }
      }
    }
  });

  socket.on('challenge_friend', async (data) => {
    if (!socket.userId || !data || !data.friendId) return;
    const Alice = await storage.getUserById(socket.userId);
    const BobId = data.friendId;
    const domain = normalizeDomain(data.domain);

    if (!Alice) return;

    const friendships = await storage.getFriendships(Alice.id);
    const isAcceptedFriend = friendships.some(
      f => f.status === 'accepted' && f.friend.id === BobId
    );
    if (!isAcceptedFriend) {
      socket.emit('challenge_error', { error: 'You can only challenge accepted friends.' });
      return;
    }

    const friendSocketId = userSockets.get(BobId);
    if (!friendSocketId) {
      socket.emit('challenge_error', { error: 'Friend is currently offline.' });
      return;
    }

    const isFriendInMatch = Object.values(players).some(p => p.userId === BobId && p.matchId);
    if (isFriendInMatch) {
      socket.emit('challenge_error', { error: 'Friend is currently in a match.' });
      return;
    }

    const challengeId = 'challenge_' + Date.now();
    activeChallenges.set(challengeId, {
      id: challengeId,
      challengerId: Alice.id,
      receiverId: BobId,
      domain,
      createdAt: Date.now()
    });

    io.to(friendSocketId).emit('friend_challenge', {
      challengeId,
      challenger: publicUser(Alice),
      domain
    });
  });

  socket.on('decline_challenge', (data) => {
    if (!data || !data.challengeId) return;
    const challenge = activeChallenges.get(data.challengeId);
    if (challenge) {
      const challengerSocketId = userSockets.get(challenge.challengerId);
      if (challengerSocketId) {
        io.to(challengerSocketId).emit('challenge_declined');
      }
      activeChallenges.delete(data.challengeId);
    }
  });

  socket.on('accept_challenge', async (data) => {
    if (!data || !data.challengeId) return;
    const challenge = activeChallenges.get(data.challengeId);
    if (!challenge) {
      socket.emit('challenge_error', { error: 'Challenge has expired or was cancelled.' });
      return;
    }

    const AliceId = challenge.challengerId;
    const BobId = challenge.receiverId;
    const domain = challenge.domain;

    const p1User = await storage.getUserById(AliceId);
    const p2User = await storage.getUserById(BobId);

    const p1SocketId = userSockets.get(AliceId);
    const p2SocketId = userSockets.get(BobId);

    if (!p1User || !p2User || !p1SocketId || !p2SocketId) {
      socket.emit('challenge_error', { error: 'One of the players went offline.' });
      activeChallenges.delete(data.challengeId);
      return;
    }

    const p1FieldElos = p1User.fieldElos || {};
    let p1Elo = p1User.elo || 1200;
    if (domain && domain !== 'all') {
      p1Elo = p1FieldElos[domain] || 1200;
    }

    const p2FieldElos = p2User.fieldElos || {};
    let p2Elo = p2User.elo || 1200;
    if (domain && domain !== 'all') {
      p2Elo = p2FieldElos[domain] || 1200;
    }

    const p1 = {
      id: p1SocketId,
      userId: p1User.id,
      name: p1User.username,
      username: p1User.username,
      elo: p1Elo,
      avatarUrl: p1User.avatarUrl,
      bannerUrl: p1User.bannerUrl,
      hp: 100,
      socketId: p1SocketId,
      domain: domain,
      queuedAt: Date.now()
    };

    const p2 = {
      id: p2SocketId,
      userId: p2User.id,
      name: p2User.username,
      username: p2User.username,
      elo: p2Elo,
      avatarUrl: p2User.avatarUrl,
      bannerUrl: p2User.bannerUrl,
      hp: 100,
      socketId: p2SocketId,
      domain: domain,
      queuedAt: Date.now()
    };

    players[p1SocketId] = p1;
    players[p2SocketId] = p2;

    activeChallenges.delete(data.challengeId);

    const match = createMatch(p1, p2, domain);
    emitMatchFound(match);
    startDiscardTimer(match.id);
  });

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

    const idx = Number(answerIndex);
    if (!Number.isInteger(idx) || idx < 0 || idx > 3) return;

    const timeTaken = Date.now() - roundData.startTime;
    roundData.answers[playerId] = {
      answer: idx,
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
      domain: player.domain,
      level: 99
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
    if (socket.userId) {
      userSockets.delete(socket.userId);
      notifyFriendsStatusChange(socket.userId, false);
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

  match.questions[match.currentRound] = pickQuestionForMatch(match, match.selectedSubject);

  emitToPlayer(match.p1, 'draft_complete', { subject: match.selectedSubject, pickerId: playerId });
  emitToPlayer(match.p2, 'draft_complete', { subject: match.selectedSubject, pickerId: playerId });

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
    const delay = 3500 + Math.random() * 4500;
    setTimeout(() => {
      const liveMatch = matches[match.id];
      if (!liveMatch || liveMatch.state !== 'battle' || !liveMatch.roundState) return;
      if (liveMatch.roundState.answers[botId]) return;

      const isCorrect = Math.random() > 0.58;
      const ansIndex = isCorrect ? question.answer : Math.floor(Math.random() * question.options.length);
      liveMatch.roundState.answers[botId] = { answer: ansIndex, timeTaken: delay };

      if (Object.keys(liveMatch.roundState.answers).length === 2) {
        resolveRound(liveMatch);
      }
    }, delay);
  }
}

function resolveRound(match) {
  if (!match || !match.roundState) return;

  const roundState = match.roundState;
  match.roundState = null;

  if (match.roundTimer) {
    clearTimeout(match.roundTimer);
    match.roundTimer = null;
  }

  const question = roundState.question;
  const answers = roundState.answers;

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
    const diff = Math.abs(ans1.timeTaken - ans2.timeTaken);
    const isBotMatch = match.p1.isBot || match.p2.isBot;

    if (isBotMatch) {
      const humanPlayer = match.p1.isBot ? match.p2 : match.p1;
      const humanAns = answers[humanPlayer.id];
      const botAns = answers[humanPlayer.id === match.p1.id ? match.p2.id : match.p1.id];
      const calcSpeedDamage = (divisor) => Math.min(20, Math.max(1, Math.ceil(diff / divisor)));

      if (humanAns && botAns && humanAns.timeTaken < botAns.timeTaken) {
        const speedDamage = calcSpeedDamage(BOT_SPEED_HUMAN_ADVANTAGE_DIVISOR);
        if (humanPlayer.id === match.p1.id) {
          p2Damage = speedDamage;
        } else {
          p1Damage = speedDamage;
        }
      } else if (humanAns && botAns && botAns.timeTaken < humanAns.timeTaken) {
        const speedDamage = calcSpeedDamage(BOT_SPEED_BOT_ADVANTAGE_DIVISOR);
        if (humanPlayer.id === match.p1.id) {
          p1Damage = speedDamage;
        } else {
          p2Damage = speedDamage;
        }
      }
    } else {
      const speedDamage = Math.min(20, Math.max(1, Math.ceil(diff / PVP_SPEED_DIVISOR)));
      if (ans1.timeTaken < ans2.timeTaken) {
        p2Damage = speedDamage;
      } else if (ans2.timeTaken < ans1.timeTaken) {
        p1Damage = speedDamage;
      }
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
        const xpDelta = isBotMatch ? 0 : 100;
        const nextXp = (user.xp || 0) + xpDelta;
        const nextLevel = Math.floor(nextXp / 500) + 1;
        const nextUser = {
          ...user,
          // Ranked-only stats
          wins: isBotMatch ? (user.wins || 0) : (user.wins || 0) + 1,
          gamesPlayed: isBotMatch ? (user.gamesPlayed || 0) : (user.gamesPlayed || 0) + 1,
          // Bot-only stats
          botWins: isBotMatch ? (user.botWins || 0) + 1 : (user.botWins || 0),
          botGamesPlayed: isBotMatch ? (user.botGamesPlayed || 0) + 1 : (user.botGamesPlayed || 0),
          xp: nextXp,
          level: nextLevel
        };
        if (!isBotMatch) {
          const domain = match.domain || 'all';
          if (domain !== 'all') {
            const elos = { ...(user.fieldElos || {}) };
            elos[domain] = winner.elo;
            nextUser.fieldElos = elos;
          } else {
            nextUser.elo = winner.elo;
            nextUser.bestElo = Math.max(user.bestElo || user.elo || 1200, winner.elo);
          }

          const stats = { ...(user.fieldStats || {}) };
          if (!stats[domain]) stats[domain] = { wins: 0, losses: 0 };
          stats[domain].wins = (stats[domain].wins || 0) + 1;
          nextUser.fieldStats = stats;
        }
        return nextUser;
      });
    }

    if (!loser.isBot && loser.userId) {
      await storage.updateUserWith(loser.userId, user => {
        const xpDelta = isBotMatch ? 0 : 50;
        const nextXp = (user.xp || 0) + xpDelta;
        const nextLevel = Math.floor(nextXp / 500) + 1;
        const nextUser = {
          ...user,
          // Ranked-only stats
          losses: isBotMatch ? (user.losses || 0) : (user.losses || 0) + 1,
          gamesPlayed: isBotMatch ? (user.gamesPlayed || 0) : (user.gamesPlayed || 0) + 1,
          // Bot-only stats
          botLosses: isBotMatch ? (user.botLosses || 0) + 1 : (user.botLosses || 0),
          botGamesPlayed: isBotMatch ? (user.botGamesPlayed || 0) + 1 : (user.botGamesPlayed || 0),
          xp: nextXp,
          level: nextLevel
        };
        if (!isBotMatch) {
          const domain = match.domain || 'all';
          if (domain !== 'all') {
            const elos = { ...(user.fieldElos || {}) };
            elos[domain] = loser.elo;
            nextUser.fieldElos = elos;
          } else {
            nextUser.elo = loser.elo;
          }

          const stats = { ...(user.fieldStats || {}) };
          if (!stats[domain]) stats[domain] = { wins: 0, losses: 0 };
          stats[domain].losses = (stats[domain].losses || 0) + 1;
          nextUser.fieldStats = stats;
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

  emitToPlayer(match.p1, 'match_end', {
    winner: winner ? winner.id : 'draw',
    elo: match.p1.elo,
    eloDelta: match.p1.eloDelta || 0,
    domain: match.domain || 'all'
  });
  emitToPlayer(match.p2, 'match_end', {
    winner: winner ? winner.id : 'draw',
    elo: match.p2.elo,
    eloDelta: match.p2.eloDelta || 0,
    domain: match.domain || 'all'
  });

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
  .then(() => storage.migrateLocalUploadUrlsToAssets(UPLOADS_DIR))
  .then(({ migrated }) => {
    if (migrated > 0) {
      console.log(`Migrated ${migrated} local upload(s) into database-backed assets.`);
    }
    return storage.recalculateAllUsersStats();
  })
  .then(() => {
    server.listen(PORT, HOST, () => {
      console.log(`Server listening on ${HOST}:${PORT}`);
    });
  })
  .catch(error => {
    console.error('Failed to initialize storage:', error);
    process.exit(1);
  });
