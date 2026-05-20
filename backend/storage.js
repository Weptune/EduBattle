require('dotenv').config();
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

    ALTER TABLE users ADD COLUMN IF NOT EXISTS field_elos TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS field_stats TEXT;
    ALTER TABLE match_history ADD COLUMN IF NOT EXISTS domain TEXT DEFAULT 'all';
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
    bio: row.bio,
    fieldElos: fieldElos,
    fieldStats: fieldStats,
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
    bio: user.bio,
    field_elos: user.fieldElos ? JSON.stringify(user.fieldElos) : '{}',
    field_stats: user.fieldStats ? JSON.stringify(user.fieldStats) : '{}',
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
  const stored = { ...user, createdAt: now, updatedAt: now };

  const row = userToRow(stored);
  await pool.query(
    `INSERT INTO users (
      id, username, password_salt, password_hash, elo, best_elo, wins, losses,
      games_played, avatar_url, banner_url, bio, field_elos, field_stats, created_at, updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
    [
      row.id, row.username, row.password_salt, row.password_hash, row.elo, row.best_elo,
      row.wins, row.losses, row.games_played, row.avatar_url, row.banner_url, row.bio,
      row.field_elos, row.field_stats, row.created_at, row.updated_at
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
      updated_at = now()
    WHERE id = $1
    RETURNING *`,
    [
      userId, patch.username, patch.elo, patch.bestElo, patch.wins, patch.losses,
      patch.gamesPlayed, patch.avatarUrl, patch.bannerUrl, patch.bio,
      patch.fieldElos ? JSON.stringify(patch.fieldElos) : '{}',
      patch.fieldStats ? JSON.stringify(patch.fieldStats) : '{}'
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
  listRecentMatches
};
