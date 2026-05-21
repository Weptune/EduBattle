require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error("=========================================================================");
  console.error("🔴 SYNAPSE ERROR: DATABASE_URL ENVIRONMENT VARIABLE IS MISSING!");
  console.error("To ensure high-performance scaling and permanent data persistence,");
  console.error("Synapse.gg now strictly runs on a PostgreSQL database.");
  console.error("");
  console.error("👉 ACTIONS TO RESOLVE THIS:");
  console.error("1. Provision a free PostgreSQL database (e.g. on Render, Railway, or Neon.tech).");
  console.error("2. Add 'DATABASE_URL' to your environment variables (under service settings).");
  console.error("3. Restart your deployment.");
  console.error("=========================================================================");
  process.exit(1);
}

const pool = new Pool({
  connectionString: databaseUrl,
  ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false }
});

let initialized = false;

async function init() {
  if (initialized) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_salt TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      elo INTEGER NOT NULL DEFAULT 1200,
      best_elo INTEGER NOT NULL DEFAULT 1200,
      wins INTEGER NOT NULL DEFAULT 0,
      losses INTEGER NOT NULL DEFAULT 0,
      games_played INTEGER NOT NULL DEFAULT 0,
      avatar_url TEXT,
      banner_url TEXT,
      bio TEXT,
      field_elos TEXT,
      field_stats TEXT,
      xp INTEGER NOT NULL DEFAULT 0,
      level INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS match_history (
      id TEXT PRIMARY KEY,
      winner_id TEXT,
      loser_id TEXT,
      player_one_id TEXT,
      player_two_id TEXT,
      player_one_name TEXT NOT NULL,
      player_two_name TEXT NOT NULL,
      player_one_elo_before INTEGER NOT NULL,
      player_two_elo_before INTEGER NOT NULL,
      player_one_elo_after INTEGER NOT NULL,
      player_two_elo_after INTEGER NOT NULL,
      player_one_delta INTEGER NOT NULL,
      player_two_delta INTEGER NOT NULL,
      rounds INTEGER NOT NULL,
      finished_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      domain TEXT DEFAULT 'all'
    );

    CREATE TABLE IF NOT EXISTS friendships (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      friend_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, friend_id)
    );

    CREATE TABLE IF NOT EXISTS arena_chat_messages (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      message TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS direct_messages (
      id TEXT PRIMARY KEY,
      sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      receiver_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      message TEXT NOT NULL,
      is_read BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    ALTER TABLE users ADD COLUMN IF NOT EXISTS field_elos TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS field_stats TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS xp INTEGER DEFAULT 0;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS level INTEGER DEFAULT 1;
    ALTER TABLE match_history ADD COLUMN IF NOT EXISTS domain TEXT DEFAULT 'all';

    CREATE TABLE IF NOT EXISTS user_assets (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      mime_type TEXT NOT NULL,
      data_base64 TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  initialized = true;
}

function rowToUser(row) {
  if (!row) return null;
  let fieldElos = {};
  try {
    fieldElos = row.field_elos ? JSON.parse(row.field_elos) : {};
  } catch (e) {
    console.error('Failed to parse field_elos:', e);
  }
  let fieldStats = {};
  try {
    fieldStats = row.field_stats ? JSON.parse(row.field_stats) : {};
  } catch (e) {
    console.error('Failed to parse field_stats:', e);
  }
  return {
    id: row.id,
    username: row.username,
    displayName: row.username,
    passwordSalt: row.password_salt,
    passwordHash: row.password_hash,
    elo: row.elo,
    bestElo: row.best_elo,
    wins: row.wins,
    losses: row.losses,
    gamesPlayed: row.games_played,
    avatarUrl: row.avatar_url,
    bannerUrl: row.banner_url,
    bio: row.bio === 'New challenger in the MIT arena.' ? 'hi' : (row.bio || 'hi'),
    fieldElos: fieldElos,
    fieldStats: fieldStats,
    xp: row.xp || 0,
    level: row.level || 1,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at
  };
}

function userToRow(user) {
  return {
    id: user.id,
    username: user.username,
    password_salt: user.passwordSalt,
    password_hash: user.passwordHash,
    elo: user.elo,
    best_elo: user.bestElo,
    wins: user.wins,
    losses: user.losses,
    games_played: user.gamesPlayed,
    avatar_url: user.avatarUrl,
    banner_url: user.bannerUrl,
    bio: user.bio === 'New challenger in the MIT arena.' ? 'hi' : (user.bio || 'hi'),
    field_elos: user.fieldElos ? JSON.stringify(user.fieldElos) : '{}',
    field_stats: user.fieldStats ? JSON.stringify(user.fieldStats) : '{}',
    xp: user.xp || 0,
    level: user.level || 1,
    created_at: user.createdAt,
    updated_at: user.updatedAt || new Date().toISOString()
  };
}

async function getUserByUsername(username) {
  await init();
  const result = await pool.query('SELECT * FROM users WHERE lower(username) = lower($1)', [username]);
  return rowToUser(result.rows[0]);
}

async function getUserById(id) {
  await init();
  const result = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
  return rowToUser(result.rows[0]);
}

async function createUser(user) {
  await init();
  const now = new Date().toISOString();
  const stored = { ...user, createdAt: now, updatedAt: now, xp: 0, level: 1 };

  const row = userToRow(stored);
  await pool.query(
    `INSERT INTO users (
      id, username, password_salt, password_hash, elo, best_elo, wins, losses,
      games_played, avatar_url, banner_url, bio, field_elos, field_stats, xp, level, created_at, updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
    [
      row.id, row.username, row.password_salt, row.password_hash, row.elo, row.best_elo,
      row.wins, row.losses, row.games_played, row.avatar_url, row.banner_url, row.bio,
      row.field_elos, row.field_stats, row.xp, row.level, row.created_at, row.updated_at
    ]
  );
  return stored;
}

async function createSession(token, userId) {
  await init();
  await pool.query('INSERT INTO sessions (token, user_id) VALUES ($1, $2)', [token, userId]);
}

async function getUserByToken(token) {
  await init();
  if (!token) return null;

  const result = await pool.query(
    'SELECT users.* FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.token = $1',
    [token]
  );
  return rowToUser(result.rows[0]);
}

async function deleteSession(token) {
  await init();
  if (!token) return;
  await pool.query('DELETE FROM sessions WHERE token = $1', [token]);
}

async function updateUser(userId, patch) {
  await init();

  const result = await pool.query(
    `UPDATE users SET
      username = $2,
      elo = $3,
      best_elo = $4,
      wins = $5,
      losses = $6,
      games_played = $7,
      avatar_url = $8,
      banner_url = $9,
      bio = $10,
      field_elos = $11,
      field_stats = $12,
      xp = $13,
      level = $14,
      updated_at = now()
    WHERE id = $1
    RETURNING *`,
    [
      userId, patch.username, patch.elo, patch.bestElo, patch.wins, patch.losses,
      patch.gamesPlayed, patch.avatarUrl, patch.bannerUrl, patch.bio,
      patch.fieldElos ? JSON.stringify(patch.fieldElos) : '{}',
      patch.fieldStats ? JSON.stringify(patch.fieldStats) : '{}',
      patch.xp || 0,
      patch.level || 1
    ]
  );
  return rowToUser(result.rows[0]);
}

async function updateUserWith(userId, updater) {
  const user = await getUserById(userId);
  if (!user) return null;
  return updateUser(userId, updater(user));
}

async function listUsers() {
  await init();
  const result = await pool.query('SELECT * FROM users ORDER BY elo DESC, wins DESC, created_at ASC');
  return result.rows.map(rowToUser);
}

async function recordMatch(match) {
  await init();
  await pool.query(
    `INSERT INTO match_history (
      id, winner_id, loser_id, player_one_id, player_two_id, player_one_name, player_two_name,
      player_one_elo_before, player_two_elo_before, player_one_elo_after, player_two_elo_after,
      player_one_delta, player_two_delta, rounds, finished_at, domain
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
    [
      match.id, match.winnerId, match.loserId, match.playerOneId, match.playerTwoId,
      match.playerOneName, match.playerTwoName, match.playerOneEloBefore, match.playerTwoEloBefore,
      match.playerOneEloAfter, match.playerTwoEloAfter, match.playerOneDelta, match.playerTwoDelta,
      match.rounds, match.finishedAt, match.domain || 'all'
    ]
  );
}

async function listRecentMatches(userId, limit = 20) {
  await init();
  const result = await pool.query(
    `SELECT * FROM match_history
     WHERE player_one_id = $1 OR player_two_id = $1
     ORDER BY finished_at DESC
     LIMIT $2`,
    [userId, limit]
  );
  return result.rows;
}

async function getFriendships(userId) {
  await init();
  const result = await pool.query(`
    SELECT f.user_id, f.friend_id, f.status, f.created_at,
           u1.username as requester_username, u1.avatar_url as requester_avatar, u1.banner_url as requester_banner, u1.elo as requester_elo, u1.wins as requester_wins, u1.losses as requester_losses, u1.bio as requester_bio, u1.xp as requester_xp, u1.level as requester_level,
           u2.username as receiver_username, u2.avatar_url as receiver_avatar, u2.banner_url as receiver_banner, u2.elo as receiver_elo, u2.wins as receiver_wins, u2.losses as receiver_losses, u2.bio as receiver_bio, u2.xp as receiver_xp, u2.level as receiver_level
    FROM friendships f
    JOIN users u1 ON f.user_id = u1.id
    JOIN users u2 ON f.friend_id = u2.id
    WHERE f.user_id = $1 OR f.friend_id = $1
  `, [userId]);

  return result.rows.map(row => {
    const isRequester = row.user_id === userId;
    const friendInfo = isRequester ? {
      id: row.friend_id,
      username: row.receiver_username,
      avatarUrl: row.receiver_avatar,
      bannerUrl: row.receiver_banner,
      elo: row.receiver_elo,
      wins: row.receiver_wins,
      losses: row.receiver_losses,
      bio: row.receiver_bio,
      xp: row.receiver_xp || 0,
      level: row.receiver_level || 1
    } : {
      id: row.user_id,
      username: row.requester_username,
      avatarUrl: row.requester_avatar,
      bannerUrl: row.requester_banner,
      elo: row.requester_elo,
      wins: row.requester_wins,
      losses: row.requester_losses,
      bio: row.requester_bio,
      xp: row.requester_xp || 0,
      level: row.requester_level || 1
    };

    return {
      userId: row.user_id,
      friendId: row.friend_id,
      status: row.status,
      createdAt: row.created_at,
      isOutgoingRequest: isRequester && row.status === 'pending',
      isIncomingRequest: !isRequester && row.status === 'pending',
      friend: friendInfo
    };
  });
}

async function createFriendRequest(userId, friendId) {
  await init();
  if (userId === friendId) throw new Error('Cannot add yourself as a friend.');
  
  const existing = await pool.query(
    `SELECT * FROM friendships 
     WHERE (user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1)`,
    [userId, friendId]
  );
  if (existing.rows.length > 0) {
    throw new Error('A friendship or friend request already exists between you.');
  }

  await pool.query(
    `INSERT INTO friendships (user_id, friend_id, status) VALUES ($1, $2, 'pending')`,
    [userId, friendId]
  );
}

async function acceptFriendRequest(userId, friendId) {
  await init();
  const result = await pool.query(
    `UPDATE friendships SET status = 'accepted'
     WHERE user_id = $1 AND friend_id = $2 AND status = 'pending'`,
    [friendId, userId]
  );
  if (result.rowCount === 0) {
    throw new Error('No pending request from this user found.');
  }
}

async function removeFriendship(userId, friendId) {
  await init();
  await pool.query(
    `DELETE FROM friendships 
     WHERE (user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1)`,
    [userId, friendId]
  );
}

async function saveArenaChatMessage(message) {
  await init();
  await pool.query(
    `INSERT INTO arena_chat_messages (id, user_id, message, created_at)
     VALUES ($1, $2, $3, $4)`,
    [message.id, message.userId, message.message, message.timestamp]
  );
}

async function listArenaChatMessages(limit = 100) {
  await init();
  const result = await pool.query(
    `SELECT m.id, m.user_id, m.message, m.created_at,
            u.username, u.avatar_url, u.banner_url, u.elo, u.level
     FROM arena_chat_messages m
     JOIN users u ON m.user_id = u.id
     ORDER BY m.created_at DESC
     LIMIT $1`,
    [limit]
  );

  return result.rows
    .map(row => ({
      id: row.id,
      userId: row.user_id,
      username: row.username,
      avatarUrl: row.avatar_url,
      bannerUrl: row.banner_url,
      elo: row.elo,
      level: row.level || 1,
      message: row.message,
      timestamp: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at
    }))
    .reverse();
}

async function saveDirectMessage(dm) {
  await init();
  await pool.query(
    `INSERT INTO direct_messages (id, sender_id, receiver_id, message, is_read, created_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [dm.id, dm.senderId, dm.receiverId, dm.message, dm.isRead || false, dm.createdAt]
  );
}

async function listDirectMessages(userId1, userId2, limit = 50) {
  await init();
  const result = await pool.query(
    `SELECT dm.id, dm.sender_id, dm.receiver_id, dm.message, dm.is_read, dm.created_at,
            u.username as sender_username, u.avatar_url as sender_avatar_url
     FROM direct_messages dm
     JOIN users u ON dm.sender_id = u.id
     WHERE (dm.sender_id = $1 AND dm.receiver_id = $2)
        OR (dm.sender_id = $2 AND dm.receiver_id = $1)
     ORDER BY dm.created_at DESC
     LIMIT $3`,
    [userId1, userId2, limit]
  );

  return result.rows
    .map(row => ({
      id: row.id,
      senderId: row.sender_id,
      receiverId: row.receiver_id,
      message: row.message,
      isRead: row.is_read,
      createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
      sender: {
        id: row.sender_id,
        username: row.sender_username,
        avatarUrl: row.sender_avatar_url
      }
    }))
    .reverse();
}

async function markDMsAsRead(senderId, receiverId) {
  await init();
  await pool.query(
    `UPDATE direct_messages
     SET is_read = TRUE
     WHERE sender_id = $1 AND receiver_id = $2 AND is_read = FALSE`,
    [senderId, receiverId]
  );
}

async function saveUserAsset(userId, mimeType, base64Data) {
  await init();
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO user_assets (id, user_id, mime_type, data_base64)
     VALUES ($1, $2, $3, $4)`,
    [id, userId, mimeType, base64Data]
  );
  return id;
}

async function getUserAsset(assetId) {
  await init();
  const result = await pool.query(
    `SELECT id, mime_type, data_base64 FROM user_assets WHERE id = $1`,
    [assetId]
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    mimeType: row.mime_type,
    dataBase64: row.data_base64
  };
}

function mimeTypeFromExtension(ext) {
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'png') return 'image/png';
  if (ext === 'gif') return 'image/gif';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'svg') return 'image/svg+xml';
  return `image/${ext}`;
}

async function migrateLocalUploadUrlsToAssets(uploadsDir) {
  await init();
  if (!uploadsDir || !fs.existsSync(uploadsDir)) return { migrated: 0 };

  const result = await pool.query(
    `SELECT id, avatar_url, banner_url FROM users
     WHERE avatar_url LIKE '/uploads/%' OR banner_url LIKE '/uploads/%'`
  );

  let migrated = 0;

  for (const row of result.rows) {
    let avatarUrl = row.avatar_url;
    let bannerUrl = row.banner_url;
    let changed = false;

    for (const [field, currentUrl] of [['avatar', avatarUrl], ['banner', bannerUrl]]) {
      if (!currentUrl || !currentUrl.startsWith('/uploads/')) continue;

      const filePath = path.join(uploadsDir, path.basename(currentUrl));
      if (!fs.existsSync(filePath)) continue;

      const buffer = fs.readFileSync(filePath);
      const ext = path.extname(filePath).slice(1).toLowerCase();
      const mimeType = mimeTypeFromExtension(ext);
      const assetId = await saveUserAsset(row.id, mimeType, buffer.toString('base64'));
      const assetUrl = `/assets/${assetId}`;

      if (field === 'avatar') avatarUrl = assetUrl;
      else bannerUrl = assetUrl;
      changed = true;
      migrated += 1;
    }

    if (changed) {
      await pool.query(
        `UPDATE users SET avatar_url = $1, banner_url = $2, updated_at = now() WHERE id = $3`,
        [avatarUrl, bannerUrl, row.id]
      );
    }
  }

  return { migrated };
}

module.exports = {
  init,
  getUserByUsername,
  getUserById,
  createUser,
  createSession,
  getUserByToken,
  deleteSession,
  updateUser,
  updateUserWith,
  listUsers,
  recordMatch,
  listRecentMatches,
  getFriendships,
  createFriendRequest,
  acceptFriendRequest,
  removeFriendship,
  saveArenaChatMessage,
  listArenaChatMessages,
  saveDirectMessage,
  listDirectMessages,
  markDMsAsRead,
  saveUserAsset,
  getUserAsset,
  migrateLocalUploadUrlsToAssets
};
