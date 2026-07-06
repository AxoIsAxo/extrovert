'use strict';

const express = require('express');
const { getAllUsers, removeReferralBadge, getUserById } = require('../db');

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

module.exports = router;
