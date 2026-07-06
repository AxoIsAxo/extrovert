'use strict';

const express = require('express');
const {
  db, getUserByUsername, getUserById, areMutualFollowers,
  sendMessage, getConversations, getMessages, markConversationRead,
  createNotification, setPublicKey, getPublicKey, getEncryptedPrivateKey,
} = require('../db');

const router = express.Router();

function back(req, fallback = '/') {
  const ref = req.get('referer');
  if (ref && ref.startsWith('/') && !ref.startsWith('//')) return ref;
  return fallback;
}

// Conversation list.
router.get('/', (req, res) => {
  const user = res.locals.currentUser;
  if (!user) return res.redirect('/login');
  const conversations = getConversations(user.id);
  res.render('chats', { conversations });
});

// Conversation with a specific user.
router.get('/:username', (req, res) => {
  const user = res.locals.currentUser;
  if (!user) return res.redirect('/login');
  const other = getUserByUsername(req.params.username);
  if (!other) return res.status(404).render('404', { thing: 'user' });
  if (!areMutualFollowers(user.id, other.id)) {
    return res.status(403).send('You can only message mutual followers.');
  }
  const messages = getMessages(user.id, other.id);
  const recipientPubKey = getPublicKey(other.id);
  markConversationRead(user.id, other.id);
  res.render('chat', { other, messages, recipientPubKey });
});

// Download encrypted private key for the current user.
router.get('/keys', (req, res) => {
  const user = res.locals.currentUser;
  if (!user) return res.status(401).send('Unauthorized');
  const publicKey = getPublicKey(user.id);
  const encryptedPrivateKey = getEncryptedPrivateKey(user.id);
  if (!publicKey) return res.json({ publicKey: null, encryptedPrivateKey: null });
  res.json({ publicKey, encryptedPrivateKey });
});

// Upload public key and optionally an encrypted private key.
router.post('/pubkey', express.json(), (req, res) => {
  const user = res.locals.currentUser;
  if (!user) return res.status(401).send('Unauthorized');
  const pem = String(req.body.publicKey || '');
  const encPriv = String(req.body.encryptedPrivateKey || '').trim() || null;
  if (!pem || pem.length > 5000) return res.status(400).send('Invalid key');
  setPublicKey(user.id, pem, encPriv);
  res.json({ ok: true });
});

// Send a message.
router.post('/:username/send', (req, res) => {
  const user = res.locals.currentUser;
  if (!user) return req.xhr ? res.json({ error: 'not logged in' }) : res.redirect('/login');
  const other = getUserByUsername(req.params.username);
  if (!other || !areMutualFollowers(user.id, other.id)) {
    return req.xhr ? res.json({ error: 'cannot message' }) : res.redirect(back(req, '/chats'));
  }
  const body = String(req.body.body || '').trim().slice(0, 5000);
  const keyForSender = String(req.body.key_for_sender || '').trim() || null;
  const keyForRecipient = String(req.body.key_for_recipient || '').trim() || null;
  if (body) {
    const msgId = sendMessage(user.id, other.id, body, keyForSender, keyForRecipient);
    createNotification({ userId: other.id, type: 'message', actorId: user.id });
    if (req.xhr) {
      const msg = db.prepare(`SELECT id, from_id, body, created_at, key_for_sender, key_for_recipient FROM messages WHERE id = ?`).get(msgId);
      return res.json({ message: msg });
    }
  }
  res.redirect('/chats/' + other.username);
});

module.exports = router;
