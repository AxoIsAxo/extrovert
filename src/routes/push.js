'use strict';

const express = require('express');
const { requireAuth } = require('../auth');
const { getVapidPublicKey, validatePushEndpoint } = require('../push');
const db = require('../db');
const { cancelPendingCallByToken } = require('../webrtc-signaling');

const router = express.Router();

// Returns the VAPID public key needed by the browser to create a push
// subscription. Requires session auth (browser client).
router.get('/vapid-public', requireAuth, (req, res) => {
  const key = getVapidPublicKey();
  if (!key) return res.status(404).json({ error: 'Push not configured on this server' });
  res.json({ publicKey: key });
});

// Register a push subscription (browser/pwa). Requires session auth + CSRF.
// Body: { endpoint, p256dh, auth, platform? }
router.post('/subscribe', requireAuth, async (req, res) => {
  const { endpoint, p256dh, auth, platform: rawPlatform } = req.body || {};
  if (!endpoint) return res.status(400).json({ error: 'endpoint is required' });
  const platform = String(rawPlatform || 'web');
  if (!['web', 'fcm', 'apns', 'ws'].includes(platform)) return res.status(400).json({ error: 'unsupported platform' });
  const check = await validatePushEndpoint(endpoint, platform);
  if (!check.ok) return res.status(400).json({ error: check.reason });
  const user = res.locals.currentUser;
  db.addPushSubscription({
    userId: user.id,
    platform,
    endpoint: String(endpoint).trim(),
    p256dh,
    auth,
  });
  res.json({ ok: true });
});

// Remove a push subscription. Requires session auth + CSRF.
// Body: { endpoint }
router.post('/unsubscribe', requireAuth, (req, res) => {
  const { endpoint } = req.body || {};
  if (!endpoint) return res.status(400).json({ error: 'endpoint is required' });
  const user = res.locals.currentUser;
  db.removePushSubscription(user.id, String(endpoint).trim());
  res.json({ ok: true });
});

// Cancel a pending offline call (triggered by the notification Decline action).
// NO session auth, NO CSRF — validated by cancelToken (a random unguessable
// secret delivered only to the callee's push channel). Rate-limited in server.js.
// Body: { cancel_token }
router.post('/cancel-pending', (req, res) => {
  const { cancel_token } = req.body || {};
  if (!cancel_token) return res.status(400).json({ error: 'cancel_token is required' });
  const ok = cancelPendingCallByToken(cancel_token);
  res.json({ ok });
});

module.exports = router;
