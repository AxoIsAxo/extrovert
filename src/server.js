'use strict';

const express = require('express');
const session = require('express-session');
const path = require('node:path');
const fs = require('node:fs');

const SqliteStore = require('./session-store');
const { optionalAuth, requireAuth } = require('./auth');

const app = express();
const PORT = process.env.PORT || 3000;

// Ensure data + upload directories exist.
const DATA_DIR = path.join(__dirname, '..', 'data');
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: true, limit: '70mb' }));
app.use(express.json());
app.use(session({
  store: new SqliteStore(),
  secret: process.env.SESSION_SECRET || 'extrovert-dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, maxAge: 1000 * 60 * 60 * 24 * 30 },
}));

app.use('/static', express.static(path.join(__dirname, '..', 'public')));
app.use('/uploads', express.static(UPLOAD_DIR));

app.locals.relTime = function relTime(ts) {
  const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return s + 's';
  if (s < 3600) return Math.floor(s / 60) + 'm';
  if (s < 86400) return Math.floor(s / 3600) + 'h';
  if (s < 604800) return Math.floor(s / 86400) + 'd';
  return new Date(ts).toLocaleDateString();
};

app.use(optionalAuth);

// Expose unread counts to all templates.
app.use((req, res, next) => {
  if (res.locals.currentUser) {
    const { countUnreadNotifications, countUnreadMessages } = require('./db');
    res.locals.unreadCount = countUnreadNotifications(res.locals.currentUser.id);
    res.locals.unreadMessages = countUnreadMessages(res.locals.currentUser.id);
  }
  next();
});

// Routes.
app.use('/', require('./routes/auth'));
app.use('/', require('./routes/pages'));      // /, /compose, /discover
app.use('/posts', require('./routes/posts')); // post creation + interactions
app.use('/u', require('./routes/profile'));   // profile view + edit
app.use('/', require('./routes/social'));     // follow/unfollow
app.use('/inbox', require('./routes/notifications'));
app.use('/chats', require('./routes/chats'));

app.use((req, res) => res.status(404).render('404', { thing: 'page' }));

app.listen(PORT, () => {
  console.log(`Extrovert is running on http://localhost:${PORT}`);
});

module.exports = app;
