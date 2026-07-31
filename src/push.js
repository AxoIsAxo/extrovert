'use strict';

// Multi-provider push dispatcher (web-push / UnifiedPush).
//
// Wakes offline devices when someone calls them. sendCallPush is invoked by
// the signaling server when an offline call is queued; it fans out to every
// push subscription the callee has registered. Dead endpoints/tokens are
// auto-pruned.
//
// Web push env:  VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT
// UnifiedPush:   No env needed — the endpoint URL stored per-device is all
//                that's needed. The server does a plain HTTP POST to it.
//
// If a provider's env is unset, that branch is skipped (the offline-call flow
// still works via ring-on-reconnect + missed-call notification).

const db = require('./db');

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@extrovert.local';

let webPush = null;
let webPushConfigured = false;
function loadWebPush() {
  if (webPush) return webPush;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return null;
  try {
    webPush = require('web-push');
    webPush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    webPushConfigured = true;
    return webPush;
  } catch (e) {
    console.error('push: web-push not available:', e.message);
    return null;
  }
}

function getVapidPublicKey() {
  return VAPID_PUBLIC_KEY || null;
}

async function sendWebPush(sub, payload) {
  const wp = loadWebPush();
  if (!wp) return;
  const pushSub = { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } };
  try {
    await wp.sendNotification(
      pushSub,
      JSON.stringify(payload),
      { urgency: 'high', TTL: 120 }
    );
  } catch (err) {
    const status = err.statusCode;
    if (status === 410 || status === 404 || status === 400) {
      try { db.deletePushSubscriptionsByEndpoint(sub.endpoint); } catch {}
    } else if (status) {
      console.error('push: web-push send failed:', status, err.message);
    }
  }
}

// UnifiedPush: the endpoint URL is the user's chosen distributor (ntfy,
// Gotify, Nextcloud, etc.). We just HTTP POST the payload — no Google APIs,
// no service-account keys, no special auth. The endpoint URL IS the auth
// (unique per device subscription).
async function sendUnifiedPush(endpoint, payload) {
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000),
    });
    if (res.status === 404 || res.status === 410 || res.status === 403) {
      try { db.deletePushSubscriptionsByEndpoint(endpoint); } catch {}
    } else if (!res.ok) {
      console.error('push: UnifiedPush send failed:', res.status, await res.text().catch(() => ''));
    }
  } catch (e) {
    if (e.name === 'TimeoutError') {
      console.error('push: UnifiedPush send timed out:', endpoint);
    } else {
      console.error('push: UnifiedPush send error:', e && e.message);
    }
  }
}

async function sendCallPush(calleeUser, callerUser, cancelToken) {
  try {
    const subs = db.getPushSubscriptions(calleeUser.id);
    if (!subs || subs.length === 0) return;
    const payload = {
      type: 'call',
      from: callerUser.username,
      from_display: callerUser.display_name || callerUser.username,
      cancel_token: cancelToken || '',
    };
    for (const sub of subs) {
      if (sub.platform === 'web') {
        await sendWebPush(sub, payload);
      } else if (sub.platform === 'unifiedpush') {
        await sendUnifiedPush(sub.endpoint, payload);
      }
      // apns -> TODO (future iOS / CallKit VoIP)
    }
  } catch (e) {
    console.error('push: sendCallPush error:', e && e.message);
  }
}

module.exports = { sendCallPush, getVapidPublicKey };
