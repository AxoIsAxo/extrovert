'use strict';

const { getUserById } = require('./db');

function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
  }
  res.locals.currentUser = getUserById(req.session.userId);
  next();
}

function optionalAuth(req, res, next) {
  if (req.session.userId) {
    res.locals.currentUser = getUserById(req.session.userId);
  }
  next();
}

module.exports = { requireAuth, optionalAuth };
