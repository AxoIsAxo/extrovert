'use strict';

// Web-push (VAPID) for browser subscriptions only.
//
// The native app does NOT use a third-party push relay: its foreground
// service keeps a WebSocket to the signaling server (push_register) and the
// server delivers call/missed-call payloads over that connection directly.
// See webrtc-signaling.js sendWsPush.

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

// The native app's devices are reached via the signaling WS (sendWsPush in
// webrtc-signaling.js), so this only fans out to browser (web) subscriptions.
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
      }
    }
  } catch (e) {
    console.error('push: sendCallPush error:', e && e.message);
  }
}

// Offline-call timeout: tell the callee's browsers the call was missed.
// (The native app gets this over the signaling WS instead.)
async function sendMissedCallPush(calleeUser, callerUser) {
  try {
    const subs = db.getPushSubscriptions(calleeUser.id);
    if (!subs || subs.length === 0) return;
    const payload = {
      type: 'missed_call',
      from: callerUser.username,
      from_display: callerUser.display_name || callerUser.username,
    };
    for (const sub of subs) {
      if (sub.platform === 'web') {
        await sendWebPush(sub, payload);
      }
    }
  } catch (e) {
    console.error('push: sendMissedCallPush error:', e && e.message);
  }
}

module.exports = { sendCallPush, sendMissedCallPush, getVapidPublicKey };
