'use strict';

const express = require('express');
const { getAllUsers, removeReferralBadge, getUserById, adminExists } = require('../db');

const router = express.Router();

function requireAdmin(req, res, next) {
  const user = res.locals.currentUser;
  if (!user || !user.is_admin) return res.status(403).send('Admins only.');
  next();
}

router.get('/', requireAdmin, (req, res) => {
  const users = getAllUsers();
  res.render('admin', { users });
});

router.post('/remove-referral/:id', requireAdmin, (req, res) => {
  const target = getUserById(Number(req.params.id));
  if (!target) return res.status(404).send('User not found');
  removeReferralBadge(target.id);
  res.redirect('/admin');
});

router.get('/become-admin', (req, res) => {
  if (!res.locals.currentUser) return res.redirect('/login');
  if (res.locals.currentUser.is_admin) return res.redirect('/admin');
  if (adminExists()) return res.redirect('/');
  res.render('become-admin');
});

router.post('/become-admin', (req, res) => {
  if (!res.locals.currentUser) return res.redirect('/login');
  if (res.locals.currentUser.is_admin) return res.redirect('/admin');
  if (adminExists()) return res.redirect('/');
  const { promoteUser } = require('../db');
  promoteUser(res.locals.currentUser.id);
  res.locals.currentUser.is_admin = 1;
  res.redirect('/admin');
});

module.exports = router;
