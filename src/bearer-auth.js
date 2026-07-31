'use strict';

const db = require('./db');

// Resolve an OAuth Bearer token to a user, or null.
// Lets native clients (which authenticate with OAuth tokens via PKCE, not
// session cookies) use the web E2EE routes through the shared JS crypto.
function bearerUser(req) {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7).trim();
  if (!token) return null;
  const tokenRecord = db.getOAuthToken(token);
  if (!tokenRecord) return null;
  if (tokenRecord.expires_at && Date.now() > tokenRecord.expires_at) return null;
  const user = db.getUserById(tokenRecord.user_id);
  if (!user || user.banned) return null;
  return user;
}

// Express middleware: populate res.locals.currentUser from a valid Bearer token
// when the session middleware hasn't already done so.
function bearerOrSession(req, res, next) {
  if (res.locals.currentUser) return next();
  const user = bearerUser(req);
  if (user) res.locals.currentUser = user;
  next();
}

module.exports = { bearerUser, bearerOrSession };
