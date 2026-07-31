// Extrovert Push registration client.
// Registers a Web Push subscription so the browser/PWA can be woken with a
// "📞 X is calling" notification even when all tabs are closed.
// Loaded on every page via header.ejs — registration is a no-op if Push API
// isn't available or not yet enabled.
//
// Exposes window.ExtrovertPush.enable(cb) / .disable(cb) for the settings page.

(function () {
  'use strict';

  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;

  var reg = null;

  // Register the service worker on every page so it stays active.
  navigator.serviceWorker.register('/static/sw.js').then(function (r) { reg = r; }).catch(function () {});

  function csrfToken() {
    var meta = document.querySelector('meta[name="csrf-token"]');
    return meta ? meta.content : '';
  }

  function fetchVapidKey() {
    return fetch('/push/vapid-public', { credentials: 'include' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { return d ? d.publicKey : null; });
  }

  function subscribeAndSend() {
    return fetchVapidKey().then(function (vapidKey) {
      if (!vapidKey) return null;
      return reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey),
      });
    }).then(function (sub) {
      if (!sub) return null;
      var j = sub.toJSON();
      return fetch('/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken() },
        credentials: 'include',
        body: JSON.stringify({ endpoint: sub.endpoint, p256dh: j.keys && j.keys.p256dh, auth: j.keys && j.keys.auth }),
      }).then(function (r) { return r.ok ? sub : null; });
    });
  }

  function urlBase64ToUint8Array(base64String) {
    var padding = '='.repeat((4 - base64String.length % 4) % 4);
    var base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    var rawData = atob(base64);
    var arr = new Uint8Array(rawData.length);
    for (var i = 0; i < rawData.length; i++) arr[i] = rawData.charCodeAt(i);
    return arr;
  }

  window.ExtrovertPush = {
    enable: function (cb) {
      if (!reg) {
        navigator.serviceWorker.ready.then(function (r) {
          reg = r;
          return enableInner(cb);
        });
        return;
      }
      return enableInner(cb);
    },
    disable: function (cb) {
      if (!reg) { if (cb) cb(false); return; }
      reg.pushManager.getSubscription().then(function (sub) {
        if (!sub) { if (cb) cb(false); return; }
        var j = sub.toJSON();
        fetch('/push/unsubscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken() },
          credentials: 'include',
          body: JSON.stringify({ endpoint: sub.endpoint }),
        }).then(function () { return sub.unsubscribe(); }).then(function () {
          if (cb) cb(true);
        }).catch(function () { if (cb) cb(false); });
      });
    },
    status: function (cb) {
      if (!reg) { if (cb) cb({ supported: false, subscribed: false }); return; }
      reg.pushManager.getSubscription().then(function (sub) {
        if (cb) cb({ supported: true, subscribed: !!sub });
      });
    },
  };

  function enableInner(cb) {
    return Notification.requestPermission().then(function (perm) {
      if (perm !== 'granted') { if (cb) cb(false); return false; }
      return subscribeAndSend().then(function (sub) {
        if (cb) cb(!!sub);
        return !!sub;
      });
    });
  }
})();
