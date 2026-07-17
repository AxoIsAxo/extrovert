'use strict';

const { DatabaseSync } = require('node:sqlite');
const { Store } = require('express-session');
const path = require('node:path');
const fs = require('node:fs');

const DB_PATH = process.env.EXTV_SESSION_DB_PATH || path.join(__dirname, '..', 'data', 'sessions.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');
db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    sid TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  )
`);
db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at)');

const PURGE_INTERVAL = 900_000; // 15 min
let lastPurge = 0;

function purgeExpired() {
  const now = Date.now();
  if (now - lastPurge < PURGE_INTERVAL) return;
  lastPurge = now;
  db.prepare(`DELETE FROM sessions WHERE expires_at <= ?`).run(now);
}

class SqliteStore extends Store {
  get(sid, cb) {
    try {
      purgeExpired();
      const row = db.prepare(`SELECT data, expires_at FROM sessions WHERE sid = ?`).get(sid);
      if (!row) return cb(null, null);
      if (row.expires_at <= Date.now()) {
        db.prepare(`DELETE FROM sessions WHERE sid = ?`).run(sid);
        return cb(null, null);
      }
      cb(null, JSON.parse(row.data));
    } catch (err) {
      console.error('Session store get error:', err);
      cb(err);
    }
  }

  set(sid, session, cb) {
    try {
      const expiresAt = session.cookie && session.cookie.maxAge
        ? Date.now() + session.cookie.maxAge
        : Date.now() + 86400000;
      const data = JSON.stringify(session);
      db.prepare(`
        INSERT INTO sessions (sid, data, expires_at) VALUES (?,?,?)
        ON CONFLICT(sid) DO UPDATE SET data = excluded.data, expires_at = excluded.expires_at
      `).run(sid, data, expiresAt);
      cb(null);
    } catch (err) {
      console.error('Session store set error:', err);
      cb(err);
    }
  }

  destroy(sid, cb) {
    try {
      db.prepare(`DELETE FROM sessions WHERE sid = ?`).run(sid);
      cb(null);
    } catch (err) {
      cb(err);
    }
  }

  touch(sid, session, cb) {
    try {
      if (session.cookie && session.cookie.maxAge) {
        const expiresAt = Date.now() + session.cookie.maxAge;
        db.prepare(`UPDATE sessions SET expires_at = ? WHERE sid = ?`).run(expiresAt, sid);
      }
      cb(null);
    } catch (err) {
      cb(err);
    }
  }

  length(cb) {
    try {
      purgeExpired();
      const row = db.prepare(`SELECT COUNT(*) AS n FROM sessions`).get();
      cb(null, row.n);
    } catch (err) {
      cb(err);
    }
  }

  clear(cb) {
    try {
      db.prepare(`DELETE FROM sessions`).run();
      cb(null);
    } catch (err) {
      cb(err);
    }
  }
}

module.exports = SqliteStore;
