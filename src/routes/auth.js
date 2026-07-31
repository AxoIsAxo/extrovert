'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { createUser, getUserByUsername, getUserByReferralCode, getUserById } = db;
const { adminExists } = db;

const router = express.Router();

router.get('/register', (req, res) => {
  if (req.session.userId) return res.redirect('/');
  const ref = String(req.query.ref || '').trim();
  res.render('register', { error: null, ref });
});

router.post('/register', async (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  const displayName = String(req.body.displayName || '').trim() || username;

  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
    return res.render('register', { error: 'Username must be 3-20 letters, numbers, or underscores.' });
  }
  if (password.length < 6 || password.length > 128) {
    return res.render('register', { error: 'Password must be 6–128 characters.' });
  }
  if (getUserByUsername(username)) {
    return res.render('register', { error: 'That username is taken — try another.' });
  }

  // Handle referral.
  const ref = String(req.body.ref || req.query.ref || '').trim();
  let referredBy = null;
  const registrantIp = req.ip || req.connection.remoteAddress;
  if (ref) {
    const referrer = getUserByReferralCode(ref);
    if (referrer) {
      const refIp = db.getReferrerIp ? db.getReferrerIp(referrer.id) : null;
      // Anti-farming: reject if same IP as referrer's stored IP.
      if (refIp && registrantIp === refIp) {
        return res.render('register', { error: "You can't use a referral from your own network.", ref });
      }
      referredBy = referrer.id;
    }
  }

  const hash = bcrypt.hashSync(password, 10);
  const id = createUser({ username, passwordHash: hash, displayName, referredBy, referrerIp: registrantIp });
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
  if (password.length > 128) {
    return res.render('login', { error: 'Invalid username or password.', next: req.query.next || '' });
  }
  const user = getUserByUsername(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.render('login', { error: 'Invalid username or password.', next: req.query.next || '' });
  }
  if (user.banned) {
    return res.render('login', { error: 'Your account has been suspended.', next: req.query.next || '' });
  }
  req.session.userId = user.id;
  const loginIp = req.ip || req.connection.remoteAddress;
  try { db.db.prepare(`UPDATE users SET referrer_ip = ? WHERE id = ?`).run(loginIp, user.id); } catch {}
  if (!user.is_admin && !adminExists()) {
    return res.redirect('/become-admin');
  }
  res.safeRedirect(req.body.next, '/');
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

router.get('/become-admin', (req, res) => {
  if (!req.session.userId) return res.redirect('/login');
  const user = getUserById(req.session.userId);
  if (!user) return res.redirect('/login');
  if (user.is_admin) return res.redirect('/admin');
  if (adminExists()) return res.redirect('/');
  res.render('become-admin');
});

router.post('/become-admin', (req, res) => {
  if (!req.session.userId) return res.redirect('/login');
  const user = getUserById(req.session.userId);
  if (!user) return res.redirect('/login');
  if (user.is_admin) return res.redirect('/admin');
  if (adminExists()) return res.redirect('/');
  const { promoteUser } = require('../db');
  promoteUser(user.id);
  res.redirect('/admin');
});

module.exports = router;
