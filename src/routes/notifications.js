'use strict';

const express = require('express');
const {
  getNotifications, countUnreadNotifications, markNotificationsRead,
  getPostById,
} = require('../db');

const router = express.Router();

router.get('/', (req, res) => {
  const user = res.locals.currentUser;
  if (!user) return res.redirect('/login');
  const notifications = getNotifications(user.id, 100);
  markNotificationsRead(user.id);
  res.render('inbox', { notifications });
});

module.exports = router;
