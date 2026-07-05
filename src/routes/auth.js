'use strict';

const express = require('express');
const bcrypt = require('bcrypt');
const { createUser, getUserByUsername } = require('../db');

const router = express.Router();

router.get('/register', (req, res) => {
  if (req.session.userId) return res.redirect('/');
  res.render('register', { error: null });
});

router.post('/register', async (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  const displayName = String(req.body.displayName || '').trim() || username;

  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
    return res.render('register', { error: 'Username must be 3-20 letters, numbers, or underscores.' });
  }
  if (password.length < 6) {
    return res.render('register', { error: 'Password must be at least 6 characters.' });
  }
  if (getUserByUsername(username)) {
    return res.render('register', { error: 'That username is taken.' });
  }

  const hash = bcrypt.hashSync(password, 10);
  const id = createUser({ username, passwordHash: hash, displayName });
  req.session.userId = id;
  res.redirect('/');
});

router.get('/login', (req, res) => {
  if (req.session.userId) return res.redirect('/');
  res.render('login', { error: null, next: req.query.next || '' });
});

router.post('/login', (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  const user = getUserByUsername(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.render('login', { error: 'Invalid username or password.', next: req.query.next || '' });
  }
  req.session.userId = user.id;
  res.redirect(req.body.next && req.body.next.startsWith('/') ? req.body.next : '/');
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

module.exports = router;
