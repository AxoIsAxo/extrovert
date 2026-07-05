'use strict';

const express = require('express');
const { getUserTheme, setUserTheme } = require('../db');

const router = express.Router();

router.get('/', (req, res) => {
  const user = res.locals.currentUser;
  if (!user) return res.redirect('/login');
  const theme = getUserTheme(user.id);
  res.render('settings', { theme });
});

router.post('/', (req, res) => {
  const user = res.locals.currentUser;
  if (!user) return res.redirect('/login');
  const theme = req.body.theme === 'neobrutalism' ? 'neobrutalism' : 'default';
  setUserTheme(user.id, theme);
  res.redirect('/');
});

module.exports = router;
