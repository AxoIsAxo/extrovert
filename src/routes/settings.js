'use strict';

const express = require('express');
const crypto = require('node:crypto');
const db = require('../db');
const { getUserTheme, setUserTheme, getCustomization, setCustomization, deleteUser } = db;
const { VALID_SCOPES } = require('../api-auth');

const router = express.Router();

const DARK_CSS = `.ev-banner {
  padding: 32px;
  background: #2a2347;
  color: #d8ccff;
  border: 1px solid #7c5cff;
  border-radius: 18px;
  margin-bottom: 22px;
}
.ev-banner h2 { margin: 0 0 8px; color: #fff; }
.ev-banner p { margin: 0; opacity: .85; }
.ev-posts-wrap { display: flex; flex-direction: column; gap: 16px; }`;

const NEO_CSS = `.ev-banner {
  padding: 32px;
  background: #fef9ef;
  color: #1a1a1a;
  border: 4px solid #111;
  box-shadow: 6px 6px 0 #111;
  margin-bottom: 22px;
}
.ev-banner h2 { margin: 0 0 8px; color: #ff4500; font-family: "Courier New", monospace; text-transform: uppercase; letter-spacing: 1px; }
.ev-banner p { margin: 0; }
.ev-posts-wrap { display: flex; flex-direction: column; gap: 16px; }`;

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

  const custom = getCustomization(user.id);
  const oldCss = (custom.css || '').trim();

  let newCss = null;
  if (oldCss === DARK_CSS.trim()) newCss = NEO_CSS;
  else if (oldCss === NEO_CSS.trim()) newCss = DARK_CSS;

  if (newCss) setCustomization(user.id, custom.html, newCss);

  res.redirect('/');
});

// Account deletion.
router.get('/delete', (req, res) => {
  const user = res.locals.currentUser;
  if (!user) return res.redirect('/login');
  res.render('confirm-delete-account', { csrfToken: res.locals.csrfToken });
});

router.post('/delete', (req, res) => {
  const user = res.locals.currentUser;
  if (!user) return res.redirect('/login');
  deleteUser(user.id);
  req.session.destroy(() => {
    res.redirect('/');
  });
});

// Developer OAuth app management
router.get('/developers', (req, res) => {
  const user = res.locals.currentUser;
  if (!user) return res.redirect('/login');
  const apps = db.getOAuthAppsByOwner(user.id);
  const authorizedApps = db.getAuthorizedAppsForUser(user.id);
  res.render('developers', { apps, authorizedApps });
});

router.post('/developers', (req, res) => {
  const user = res.locals.currentUser;
  if (!user) return res.redirect('/login');

  const { name, description, website, redirect_uris, scopes } = req.body;
  if (!name || !redirect_uris) {
    return res.render('developers', {
      apps: db.getOAuthAppsByOwner(user.id),
      authorizedApps: db.getAuthorizedAppsForUser(user.id),
      error: 'Name and Redirect URIs are required.',
    });
  }

  const validScopes = scopes
    ? scopes.split(' ').filter(s => VALID_SCOPES.has(s)).join(' ')
    : 'read';

  const clientId = crypto.randomBytes(24).toString('hex');
  const clientSecret = crypto.randomBytes(32).toString('hex');
  const uris = Array.isArray(redirect_uris) ? redirect_uris.join(',') : redirect_uris;

  db.createOAuthApp({
    name,
    description: description || '',
    website: website || '',
    redirectUris: uris,
    clientId,
    clientSecret,
    scopes: validScopes,
    ownerId: user.id,
  });

  res.redirect('/settings/developers');
});

router.post('/developers/:id/delete', (req, res) => {
  const user = res.locals.currentUser;
  if (!user) return res.redirect('/login');

  const appId = parseInt(req.params.id, 10);
  const app = db.getOAuthAppById(appId);
  if (!app || app.owner_id !== user.id) {
    return res.status(404).send('App not found.');
  }
  db.deleteOAuthApp(appId);
  res.redirect('/settings/developers');
});

router.post('/developers/authorized/:clientId/revoke', (req, res) => {
  const user = res.locals.currentUser;
  if (!user) return res.redirect('/login');

  const app = db.getOAuthAppByClientId(req.params.clientId);
  if (app) {
    db.revokeOAuthTokensForUser(user.id, app.id);
  }
  res.redirect('/settings/developers');
});

module.exports = router;
