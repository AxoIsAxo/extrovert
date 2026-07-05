'use strict';

const express = require('express');
const {
  getUserByUsername, getUserById, areMutualFollowers,
  sendMessage, getConversations, getMessages, markConversationRead,
  createNotification, setPublicKey, getPublicKey,
} = require('../db');

const router = express.Router();

function back(req, fallback = '/') {
  const ref = req.get('referer');
  return ref && ref.startsWith('/') ? ref : (ref || fallback);
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

// Upload public key.
router.post('/pubkey', express.json(), (req, res) => {
  const user = res.locals.currentUser;
  if (!user) return res.status(401).send('Unauthorized');
  const pem = String(req.body.publicKey || '');
  if (!pem || pem.length > 5000) return res.status(400).send('Invalid key');
  setPublicKey(user.id, pem);
  res.json({ ok: true });
});

// Send a message.
router.post('/:username/send', (req, res) => {
  const user = res.locals.currentUser;
  if (!user) return res.redirect('/login');
  const other = getUserByUsername(req.params.username);
  if (!other || !areMutualFollowers(user.id, other.id)) {
    return res.redirect(back(req, '/chats'));
  }
  const body = String(req.body.body || '').trim().slice(0, 5000);
  const keyForSender = String(req.body.key_for_sender || '').trim() || null;
  const keyForRecipient = String(req.body.key_for_recipient || '').trim() || null;
  if (body) {
    sendMessage(user.id, other.id, body, keyForSender, keyForRecipient);
    createNotification({ userId: other.id, type: 'message', actorId: user.id });
  }
  res.redirect('/chats/' + other.username);
});

module.exports = router;
