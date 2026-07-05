'use strict';

const { db } = require('./db');

// Direct friends: people you follow.
function friendIds(userId) {
  const rows = db.prepare(
    `SELECT followee_id AS id FROM follows WHERE follower_id = ?`
  ).all(userId);
  return new Set(rows.map(r => r.id));
}

// Friends of friends: people followed by your friends, excluding you and your
// direct friends. These are the only other people whose content you can see.
function foafIds(userId) {
  const rows = db.prepare(`
    SELECT DISTINCT f2.followee_id AS id
    FROM follows f2
    JOIN follows f1 ON f1.followee_id = f2.follower_id
    WHERE f1.follower_id = ?
      AND f2.followee_id != ?
      AND f2.followee_id NOT IN (
        SELECT followee_id FROM follows WHERE follower_id = ?
      )
  `).all(userId, userId, userId);
  return new Set(rows.map(r => r.id));
}

// The full set of user ids whose content is visible to `viewerId`:
// the viewer themself, their friends, and their friends-of-friends.
function visibleUserIds(viewerId) {
  const set = new Set([viewerId]);
  for (const id of friendIds(viewerId)) set.add(id);
  for (const id of foafIds(viewerId)) set.add(id);
  return set;
}

function canView(viewerId, authorId) {
  if (viewerId === authorId) return true;
  return visibleUserIds(viewerId).has(authorId);
}

// Is authorId reachable at exactly distance 2 (a friend of a friend, not closer)?
function isFoaf(viewerId, authorId) {
  return foafIds(viewerId).has(authorId);
}

module.exports = { friendIds, foafIds, visibleUserIds, canView, isFoaf };
