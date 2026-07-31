'use strict';

const db = require('./db');

function getConversations(userId) {
  return db.getConversations(userId);
}

function getMessages(userId, otherId, limit, cursor) {
  if (cursor) {
    return db.db.prepare(`
      SELECT m.*, u.username, u.display_name
      FROM messages m
      JOIN users u ON u.id = m.from_id
      WHERE ((m.from_id = ? AND m.to_id = ?) OR (m.from_id = ? AND m.to_id = ?))
        AND m.id < ?
      ORDER BY m.created_at DESC
      LIMIT ?
    `).all(userId, otherId, otherId, userId, cursor, limit);
  }
  return db.db.prepare(`
    SELECT m.*, u.username, u.display_name
    FROM messages m
    JOIN users u ON u.id = m.from_id
    WHERE (m.from_id = ? AND m.to_id = ?)
       OR (m.from_id = ? AND m.to_id = ?)
    ORDER BY m.created_at DESC
    LIMIT ?
  `).all(userId, otherId, otherId, userId, limit);
}

function sendMessage(fromId, toId, body, keyForSender, keyForRecipient, proto, senderCiphertext) {
  return db.sendMessage(fromId, toId, body, keyForSender, keyForRecipient, proto, senderCiphertext);
}

function getPublicKey(userId) {
  return db.getPublicKey(userId);
}

function getEncryptedPrivateKey(userId) {
  return db.getEncryptedPrivateKey(userId);
}

function setPublicKey(userId, publicKey, encryptedPrivateKey) {
  db.setPublicKey(userId, publicKey, encryptedPrivateKey);
}

function editMessage(msgId, userId, newBody, keyForSender, keyForRecipient, proto, senderCiphertext) {
  return db.editMessage(msgId, userId, newBody, keyForSender, keyForRecipient, proto, senderCiphertext);
}

function deleteMessage(msgId, userId) {
  const msg = db.db.prepare(`SELECT * FROM messages WHERE id = ? AND from_id = ?`).get(msgId, userId);
  if (!msg) return false;
  db.db.prepare(`DELETE FROM messages WHERE id = ?`).run(msgId);
  return true;
}

module.exports = {
  getConversations, getMessages, sendMessage,
  getPublicKey, setPublicKey, getEncryptedPrivateKey,
  editMessage, deleteMessage,
};