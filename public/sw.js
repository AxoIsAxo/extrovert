// Service worker for Extrovert Web Push (call notifications).
// Wakes a closed browser/tab with a ringing system notification.
// On "Answer": opens the app to the caller's chat → WS reconnect → server
// rings (Phase 1) → live WebRTC call completes.
// On "Decline": POSTs cancel_token to /push/cancel-pending so the caller
// is told "call_declined" instead of waiting out the timeout.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data;
  try { data = event.waitUntil ? event.data.json() : null; } catch {}
  if (!data || data.type !== 'call') return;
  const from = data.from_display || data.from;
  event.waitUntil(self.registration.showNotification('Incoming call', {
    body: from + ' is calling',
    tag: 'call:' + data.from,
    requireInteraction: true,
    data,
    actions: [
      { action: 'answer', title: 'Answer' },
      { action: 'decline', title: 'Decline' },
    ],
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const from = data.from || '';
  if (event.action === 'decline') {
    const token = data.cancel_token;
    if (token) {
      event.waitUntil(fetch('/push/cancel-pending', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ cancel_token: token }),
      }));
    }
    return;
  }
  // Answer (or default click): open/focus the app. The server's connect-time
  // ring will send incoming_call (Phase 1) the moment the WS connects — no
  // need to also trigger startCall via ?call=1.
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
    const chatUrl = from ? '/chats/' + from : '/chats';
    for (const c of clients) {
      if (c.visibilityState === 'visible') {
        c.navigate(chatUrl);
        return c.focus();
      }
    }
    return self.clients.openWindow(chatUrl);
  }));
});
