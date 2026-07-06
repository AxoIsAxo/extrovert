'use strict';

const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

const DB_PATH = path.join(__dirname, '..', 'data', 'extrovert.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

function init() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      username      TEXT UNIQUE NOT NULL COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      display_name  TEXT NOT NULL,
      bio           TEXT NOT NULL DEFAULT '',
      created_at    INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS follows (
      follower_id INTEGER NOT NULL REFERENCES users(id),
      followee_id INTEGER NOT NULL REFERENCES users(id),
      created_at  INTEGER NOT NULL,
      PRIMARY KEY (follower_id, followee_id)
    );

    -- A follow that was triggered specifically by viewing a post.
    -- This is the "follow someone because of a post" signal: a BIG boost.
    CREATE TABLE IF NOT EXISTS follows_from_post (
      follower_id INTEGER NOT NULL REFERENCES users(id),
      followee_id INTEGER NOT NULL REFERENCES users(id),
      post_id     INTEGER NOT NULL REFERENCES posts(id),
      created_at  INTEGER NOT NULL,
      PRIMARY KEY (follower_id, followee_id, post_id)
    );

    CREATE TABLE IF NOT EXISTS posts (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id       INTEGER NOT NULL REFERENCES users(id),
      type          TEXT NOT NULL CHECK(type IN ('text','photo','video','repost')),
      body          TEXT NOT NULL DEFAULT '',
      media_path    TEXT,
      repost_of_id  INTEGER REFERENCES posts(id),
      created_at    INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_posts_user ON posts(user_id);
    CREATE INDEX IF NOT EXISTS idx_posts_created ON posts(created_at);

    CREATE TABLE IF NOT EXISTS likes (
      user_id    INTEGER NOT NULL REFERENCES users(id),
      post_id    INTEGER NOT NULL REFERENCES posts(id),
      created_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, post_id)
    );

    CREATE TABLE IF NOT EXISTS comments (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL REFERENCES users(id),
      post_id    INTEGER NOT NULL REFERENCES posts(id),
      body       TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS shares (
      user_id    INTEGER NOT NULL REFERENCES users(id),
      post_id    INTEGER NOT NULL REFERENCES posts(id),
      created_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, post_id)
    );

    CREATE TABLE IF NOT EXISTS profile_customization (
      user_id INTEGER PRIMARY KEY REFERENCES users(id),
      html    TEXT NOT NULL DEFAULT '',
      css     TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL REFERENCES users(id),
      type       TEXT NOT NULL,
      actor_id   INTEGER NOT NULL REFERENCES users(id),
      post_id    INTEGER REFERENCES posts(id),
      read       INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, read, created_at);

    CREATE TABLE IF NOT EXISTS messages (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      from_id    INTEGER NOT NULL REFERENCES users(id),
      to_id      INTEGER NOT NULL REFERENCES users(id),
      body       TEXT NOT NULL,
      read       INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(from_id, to_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_messages_unread ON messages(to_id, read, created_at);

    CREATE TABLE IF NOT EXISTS user_public_keys (
      user_id    INTEGER PRIMARY KEY REFERENCES users(id),
      public_key TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);
}

init();

// Migrations.
try { db.exec(`ALTER TABLE users ADD COLUMN theme TEXT NOT NULL DEFAULT 'default'`); } catch {}
try { db.exec(`ALTER TABLE users ADD COLUMN bio TEXT NOT NULL DEFAULT ''`); } catch {}
try { db.exec(`ALTER TABLE messages ADD COLUMN key_for_sender TEXT`); } catch {}
try { db.exec(`ALTER TABLE messages ADD COLUMN key_for_recipient TEXT`); } catch {}
try { db.exec(`ALTER TABLE user_public_keys ADD COLUMN encrypted_private_key TEXT`); } catch {}
try { db.exec(`ALTER TABLE users ADD COLUMN referral_code TEXT UNIQUE`); } catch {}
try { db.exec(`ALTER TABLE users ADD COLUMN referred_by INTEGER REFERENCES users(id)`); } catch {}
try { db.exec(`ALTER TABLE users ADD COLUMN referrer_ip TEXT`); } catch {}

// ---------- users ----------
function createUser({ username, passwordHash, displayName, referredBy, referrerIp }) {
  const now = Date.now();
  const res = db.prepare(
    `INSERT INTO users (username, password_hash, display_name, created_at, referred_by, referrer_ip) VALUES (?,?,?,?,?,?)`
  ).run(username, passwordHash, displayName, now, referredBy || null, referrerIp || null);
  return res.lastInsertRowid;
}

function getUserByUsername(username) {
  return db.prepare(`SELECT * FROM users WHERE username = ?`).get(username);
}

function getUserById(id) {
  return db.prepare(`SELECT * FROM users WHERE id = ?`).get(id);
}

function updateUserProfile(id, { displayName, bio }) {
  db.prepare(`UPDATE users SET display_name = ?, bio = ? WHERE id = ?`)
    .run(displayName, bio, id);
}

// ---------- follows ----------
function follow(followerId, followeeId) {
  if (followerId === followeeId) return;
  db.prepare(
    `INSERT OR IGNORE INTO follows (follower_id, followee_id, created_at) VALUES (?,?,?)`
  ).run(followerId, followeeId, Date.now());
}

function unfollow(followerId, followeeId) {
  db.prepare(`DELETE FROM follows WHERE follower_id = ? AND followee_id = ?`)
    .run(followerId, followeeId);
  db.prepare(
    `DELETE FROM follows_from_post WHERE follower_id = ? AND followee_id = ?`
  ).run(followerId, followeeId);
}

function isFollowing(followerId, followeeId) {
  const row = db.prepare(
    `SELECT 1 FROM follows WHERE follower_id = ? AND followee_id = ?`
  ).get(followerId, followeeId);
  return !!row;
}

function followingIds(userId) {
  const rows = db.prepare(
    `SELECT followee_id AS id FROM follows WHERE follower_id = ?`
  ).all(userId);
  return rows.map(r => r.id);
}

function countFollowers(userId) {
  return db.prepare(`SELECT COUNT(*) AS n FROM follows WHERE followee_id = ?`).get(userId).n;
}

function countFollowing(userId) {
  return db.prepare(`SELECT COUNT(*) AS n FROM follows WHERE follower_id = ?`).get(userId).n;
}

// Record that a follow happened because of a specific post (big boost source).
function recordFollowFromPost(followerId, followeeId, postId) {
  follow(followerId, followeeId);
  db.prepare(
    `INSERT OR IGNORE INTO follows_from_post (follower_id, followee_id, post_id, created_at)
     VALUES (?,?,?,?)`
  ).run(followerId, followeeId, postId, Date.now());
}

// ---------- posts ----------
function createPost({ userId, type, body = '', mediaPath = null, repostOfId = null, createdAt }) {
  const now = createdAt || Date.now();
  const res = db.prepare(
    `INSERT INTO posts (user_id, type, body, media_path, repost_of_id, created_at)
     VALUES (?,?,?,?,?,?)`
  ).run(userId, type, body, mediaPath, repostOfId, now);
  return res.lastInsertRowid;
}

function getPostById(id) {
  return db.prepare(`SELECT * FROM posts WHERE id = ?`).get(id);
}

// Resolve a post, following one level of repost to its original.
function getDisplayPost(id) {
  const post = db.prepare(`SELECT * FROM posts WHERE id = ?`).get(id);
  if (!post) return null;
  if (post.type === 'repost' && post.repost_of_id) {
    const original = getDisplayPost(post.repost_of_id);
    return { post, original };
  }
  return { post, original: null };
}

function postsByUser(userId) {
  return db.prepare(
    `SELECT * FROM posts WHERE user_id = ? ORDER BY created_at DESC`
  ).all(userId);
}

// ---------- post deletion ----------
function deletePost(postId, userId) {
  const post = db.prepare(`SELECT * FROM posts WHERE id = ? AND user_id = ?`).get(postId, userId);
  if (!post) return false;
  // Cascade: remove related data for the effective (original) content.
  const effId = post.type === 'repost' && post.repost_of_id ? post.repost_of_id : post.id;
  db.prepare(`DELETE FROM likes WHERE post_id = ?`).run(effId);
  db.prepare(`DELETE FROM comments WHERE post_id = ?`).run(effId);
  db.prepare(`DELETE FROM shares WHERE post_id = ?`).run(effId);
  db.prepare(`DELETE FROM follows_from_post WHERE post_id = ?`).run(effId);
  db.prepare(`DELETE FROM notifications WHERE post_id = ?`).run(effId);
  // Delete reposts that point to this post.
  db.prepare(`DELETE FROM posts WHERE repost_of_id = ?`).run(post.id);
  // Delete the post itself.
  db.prepare(`DELETE FROM posts WHERE id = ?`).run(post.id);
  return true;
}

// ---------- likes ----------
function toggleLike(userId, postId) {
  const existing = db.prepare(
    `SELECT 1 FROM likes WHERE user_id = ? AND post_id = ?`
  ).get(userId, postId);
  if (existing) {
    db.prepare(`DELETE FROM likes WHERE user_id = ? AND post_id = ?`).run(userId, postId);
    return false;
  }
  db.prepare(
    `INSERT INTO likes (user_id, post_id, created_at) VALUES (?,?,?)`
  ).run(userId, postId, Date.now());
  return true;
}

function hasLiked(userId, postId) {
  return !!db.prepare(
    `SELECT 1 FROM likes WHERE user_id = ? AND post_id = ?`
  ).get(userId, postId);
}

// ---------- comments ----------
function addComment(userId, postId, body) {
  const now = Date.now();
  const res = db.prepare(
    `INSERT INTO comments (user_id, post_id, body, created_at) VALUES (?,?,?,?)`
  ).run(userId, postId, body, now);
  return res.lastInsertRowid;
}

function commentsForPost(postId) {
  return db.prepare(
    `SELECT c.*, u.username, u.display_name FROM comments c
     JOIN users u ON u.id = c.user_id
     WHERE c.post_id = ? ORDER BY c.created_at ASC`
  ).all(postId);
}

// ---------- shares ----------
function sharePost(userId, postId) {
  db.prepare(
    `INSERT OR IGNORE INTO shares (user_id, post_id, created_at) VALUES (?,?,?)`
  ).run(userId, postId, Date.now());
}

function hasShared(userId, postId) {
  return !!db.prepare(
    `SELECT 1 FROM shares WHERE user_id = ? AND post_id = ?`
  ).get(userId, postId);
}

// Has `userId` already reposted `originalId`? (prevents duplicate reposts)
function hasReposted(userId, originalId) {
  return !!db.prepare(
    `SELECT 1 FROM posts WHERE user_id = ? AND type = 'repost' AND repost_of_id = ?`
  ).get(userId, originalId);
}

// ---------- profile customization ----------
function getCustomization(userId) {
  return db.prepare(
    `SELECT * FROM profile_customization WHERE user_id = ?`
  ).get(userId) || { user_id: userId, html: '', css: '' };
}

function setCustomization(userId, html, css) {
  db.prepare(
    `INSERT INTO profile_customization (user_id, html, css) VALUES (?,?,?)
     ON CONFLICT(user_id) DO UPDATE SET html = excluded.html, css = excluded.css`
  ).run(userId, html, css);
}

// ---------- notifications ----------
function createNotification({ userId, type, actorId, postId }) {
  if (userId === actorId) return;
  db.prepare(
    `INSERT INTO notifications (user_id, type, actor_id, post_id, created_at) VALUES (?,?,?,?,?)`
  ).run(userId, type, actorId, postId || null, Date.now());
}

function getNotifications(userId, limit = 50) {
  return db.prepare(`
    SELECT n.*, u.username AS actor_username, u.display_name AS actor_name
    FROM notifications n
    JOIN users u ON u.id = n.actor_id
    WHERE n.user_id = ?
    ORDER BY n.created_at DESC
    LIMIT ?
  `).all(userId, limit);
}

function countUnreadNotifications(userId) {
  const row = db.prepare(
    `SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read = 0`
  ).get(userId);
  return row.n;
}

function markNotificationsRead(userId) {
  db.prepare(`UPDATE notifications SET read = 1 WHERE user_id = ? AND read = 0`).run(userId);
}

// ---------- user lists ----------
function getFollowers(userId) {
  return db.prepare(`
    SELECT u.id, u.username, u.display_name, u.bio, f.created_at AS followed_at
    FROM follows f
    JOIN users u ON u.id = f.follower_id
    WHERE f.followee_id = ?
    ORDER BY f.created_at DESC
  `).all(userId);
}

function getFollowing(userId) {
  return db.prepare(`
    SELECT u.id, u.username, u.display_name, u.bio, f.created_at AS followed_at
    FROM follows f
    JOIN users u ON u.id = f.followee_id
    WHERE f.follower_id = ?
    ORDER BY f.created_at DESC
  `).all(userId);
}

// ---------- mutual follow check ----------
function areMutualFollowers(aId, bId) {
  const row = db.prepare(`
    SELECT 1 FROM follows f1
    JOIN follows f2 ON f1.follower_id = f2.followee_id AND f1.followee_id = f2.follower_id
    WHERE f1.follower_id = ? AND f1.followee_id = ?
  `).get(aId, bId);
  return !!row;
}

// ---------- messages ----------
function sendMessage(fromId, toId, body, keyForSender, keyForRecipient) {
  db.prepare(
    `INSERT INTO messages (from_id, to_id, body, created_at, key_for_sender, key_for_recipient) VALUES (?,?,?,?,?,?)`
  ).run(fromId, toId, body, Date.now(), keyForSender || null, keyForRecipient || null);
}

function getConversations(userId) {
  return db.prepare(`
    WITH parts AS (
      SELECT DISTINCT
        CASE WHEN from_id = ? THEN to_id ELSE from_id END AS other_id
      FROM messages
      WHERE from_id = ? OR to_id = ?
    )
    SELECT p.other_id AS id, u.username, u.display_name,
      (SELECT body FROM messages m
       WHERE (m.from_id = ? AND m.to_id = p.other_id)
          OR (m.from_id = p.other_id AND m.to_id = ?)
       ORDER BY m.created_at DESC LIMIT 1) AS last_message,
      (SELECT created_at FROM messages m
       WHERE (m.from_id = ? AND m.to_id = p.other_id)
          OR (m.from_id = p.other_id AND m.to_id = ?)
       ORDER BY m.created_at DESC LIMIT 1) AS last_at,
      (SELECT COUNT(*) FROM messages m
       WHERE m.to_id = ? AND m.from_id = p.other_id AND m.read = 0) AS unread
    FROM parts p
    JOIN users u ON u.id = p.other_id
    ORDER BY last_at DESC
  `).all(userId, userId, userId, userId, userId, userId, userId, userId);
}

function getMessages(userId, otherId, limit = 100) {
  return db.prepare(`
    SELECT m.*, u.username, u.display_name
    FROM messages m
    JOIN users u ON u.id = m.from_id
    WHERE (m.from_id = ? AND m.to_id = ?)
       OR (m.from_id = ? AND m.to_id = ?)
    ORDER BY m.created_at ASC
    LIMIT ?
  `).all(userId, otherId, otherId, userId, limit);
}

function countUnreadMessages(userId) {
  const row = db.prepare(
    `SELECT COUNT(*) AS n FROM messages WHERE to_id = ? AND read = 0`
  ).get(userId);
  return row.n;
}

function markConversationRead(userId, otherId) {
  db.prepare(
    `UPDATE messages SET read = 1 WHERE to_id = ? AND from_id = ? AND read = 0`
  ).run(userId, otherId);
}

// ---------- E2EE public keys ----------
function setPublicKey(userId, publicKey, encryptedPrivateKey) {
  db.prepare(`
    INSERT INTO user_public_keys (user_id, public_key, encrypted_private_key, created_at)
    VALUES (?,?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET public_key = excluded.public_key, encrypted_private_key = COALESCE(excluded.encrypted_private_key, user_public_keys.encrypted_private_key), created_at = excluded.created_at
  `).run(userId, publicKey, encryptedPrivateKey || null, Date.now());
}
function getPublicKey(userId) {
  const row = db.prepare(`SELECT public_key FROM user_public_keys WHERE user_id = ?`).get(userId);
  return row ? row.public_key : null;
}
function getEncryptedPrivateKey(userId) {
  const row = db.prepare(`SELECT encrypted_private_key FROM user_public_keys WHERE user_id = ?`).get(userId);
  return row ? row.encrypted_private_key : null;
}

// ---------- referrals ----------
function setReferralCode(userId) {
  const existing = db.prepare(`SELECT referral_code FROM users WHERE id = ?`).get(userId);
  if (existing && existing.referral_code) return existing.referral_code;
  let code;
  do {
    code = crypto.randomBytes(6).toString('base64url');
  } while (db.prepare(`SELECT 1 FROM users WHERE referral_code = ?`).get(code));
  db.prepare(`UPDATE users SET referral_code = ? WHERE id = ?`).run(code, userId);
  return code;
}

function getUserByReferralCode(code) {
  return db.prepare(`SELECT * FROM users WHERE referral_code = ?`).get(code);
}

function getReferralCount(userId) {
  const row = db.prepare(`SELECT COUNT(*) AS n FROM users WHERE referred_by = ?`).get(userId);
  return row.n;
}

function getReferralCode(userId) {
  const row = db.prepare(`SELECT referral_code FROM users WHERE id = ?`).get(userId);
  return row ? row.referral_code : null;
}

function getReferrerIp(userId) {
  const row = db.prepare(`SELECT referrer_ip FROM users WHERE id = ?`).get(userId);
  return row ? row.referrer_ip : null;
}

// ---------- theme ----------
function getUserTheme(userId) {
  const row = db.prepare(`SELECT theme FROM users WHERE id = ?`).get(userId);
  return row ? row.theme : 'default';
}

function setUserTheme(userId, theme) {
  db.prepare(`UPDATE users SET theme = ? WHERE id = ?`).run(theme, userId);
}

module.exports = {
  db,
  // users
  createUser, getUserByUsername, getUserById, updateUserProfile,
  // follows
  follow, unfollow, isFollowing, followingIds, countFollowers, countFollowing, recordFollowFromPost,
  // posts
  createPost, getPostById, getDisplayPost, postsByUser, deletePost,
  // likes
  toggleLike, hasLiked,
  // comments
  addComment, commentsForPost,
  // shares
  sharePost, hasShared, hasReposted,
  // customization
  getCustomization, setCustomization,
  // notifications
  createNotification, getNotifications, countUnreadNotifications, markNotificationsRead,
  // user lists
  getFollowers, getFollowing,
  // mutual follow
  areMutualFollowers,
  // messages
  sendMessage, getConversations, getMessages, countUnreadMessages, markConversationRead,
  // E2EE
  setPublicKey, getPublicKey, getEncryptedPrivateKey,
  // referrals
  setReferralCode, getUserByReferralCode, getReferralCount, getReferralCode, getReferrerIp,
  // theme
  getUserTheme, setUserTheme,
};
