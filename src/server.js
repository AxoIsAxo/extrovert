'use strict';

const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

const SqliteStore = require('./session-store');
const { optionalAuth, requireAuth } = require('./auth');

const app = express();
const PORT = process.env.PORT || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';
const SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET) {
  console.error('FATAL: SESSION_SECRET environment variable is required');
  process.exit(1);
}

// Ensure data + upload directories exist.
const DATA_DIR = path.join(__dirname, '..', 'data');
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// View engine.
app.set('view engine', 'ejs');

// Favicon (suppress 404 noise in console).
app.get('/favicon.ico', (req, res) => res.status(204).end());
app.set('views', path.join(__dirname, 'views'));
app.set('trust proxy', 1);

// Security headers.
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "http:", "https:"],
      mediaSrc: ["'self'"],
      scriptSrc: ["'self'"],
      connectSrc: ["'self'"],
      frameAncestors: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(express.json({ limit: '1mb' }));

// Session with secure defaults.
app.use(session({
  store: new SqliteStore(),
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: IS_PROD,
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 24 * 30,
  },
}));

// Auth rate limiter (login + register).
const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false },
  message: 'Too many authentication attempts. Try again in a minute.',
});
app.use('/login', authLimiter);
app.use('/register', authLimiter);

// General action rate limiter (lower limit than auth).
const actionLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false },
  message: 'Too many requests, please slow down.',
});
app.use((req, res, next) => {
  if (req.method === 'POST') return actionLimiter(req, res, next);
  next();
});

// CSRF middleware — generates and validates tokens per session.
app.use((req, res, next) => {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
    console.log('CSRF: generated new token for session', req.sessionID, req.session.csrfToken);
  }
  res.locals.csrfToken = req.session.csrfToken;

  // Skip CSRF check for multipart forms — multer parses body later in the route.
  if (req.method === 'POST' && (
    req.path === '/stickers/upload' ||
    req.path.startsWith('/stickers/upload') ||
    req.path === '/posts' ||
    /^\/u\/[^\/]+\/avatar$/.test(req.path)
  )) {
    return next();
  }

  if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH' || req.method === 'DELETE') {
    const bodyToken = req.body && req.body._csrf;
    const token = bodyToken || req.headers['x-csrf-token'];
    if (!token || token !== req.session.csrfToken) {
      console.log('CSRF FAIL', req.method, req.path, 'sessionToken:', req.session.csrfToken, 'received:', token, 'bodyType:', typeof req.body, 'bodyToken:', bodyToken, 'cookie:', req.headers.cookie ? req.headers.cookie.substring(0, 50) : 'none');
      return res.status(403).send('CSRF validation failed');
    }
  }
  next();
});

// Safely resolve redirect targets — only same-origin relative URLs allowed.
app.use((req, res, next) => {
  res.safeRedirect = function safeRedirect(url, fallback = '/') {
    if (typeof url === 'string' && url.startsWith('/') && !url.startsWith('//')) {
      return res.redirect(url);
    }
    res.redirect(fallback);
  };
  res.locals.safeUrl = function safeUrl(url, fallback = '/') {
    if (typeof url === 'string' && url.startsWith('/') && !url.startsWith('//')) {
      return url;
    }
    return fallback;
  };
  next();
});

app.use('/static', express.static(path.join(__dirname, '..', 'public')));
app.use('/uploads', express.static(UPLOAD_DIR, {
  setHeaders: (res) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Content-Disposition', 'inline');
  },
}));

app.locals.relTime = function relTime(ts) {
  const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return s + 's';
  if (s < 3600) return Math.floor(s / 60) + 'm';
  if (s < 86400) return Math.floor(s / 3600) + 'h';
  if (s < 604800) return Math.floor(s / 86400) + 'd';
  return new Date(ts).toLocaleDateString();
};

app.use(optionalAuth);

// Expose user data to all templates.
app.use((req, res, next) => {
  if (res.locals.currentUser) {
    const { countUnreadNotifications, countUnreadMessages, getUserTheme } = require('./db');
    res.locals.unreadCount = countUnreadNotifications(res.locals.currentUser.id);
    res.locals.unreadMessages = countUnreadMessages(res.locals.currentUser.id);
    res.locals.theme = getUserTheme(res.locals.currentUser.id);
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
app.use('/settings', require('./routes/settings'));
app.use('/admin', require('./routes/admin'));
app.use('/stickers', require('./routes/stickers'));

app.use((req, res) => res.status(404).render('404', { thing: 'page' }));

app.listen(PORT, () => {
  console.log(`Extrovert is running on http://localhost:${PORT}`);
});

module.exports = app;
