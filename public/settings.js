'use strict';
// Settings page: call-notification push toggle.
// Kept as an external file (not inline) so it works under the app's
// Content-Security-Policy (script-src 'self', no 'unsafe-inline').
(function () {
  var btn = document.getElementById('push-toggle');
  var status = document.getElementById('push-status');
  if (!btn || !status) return;
  if (!window.ExtrovertPush) {
    btn.textContent = 'Push not available';
    btn.disabled = true;
    status.textContent = 'Your browser does not support Push notifications.';
    return;
  }
  ExtrovertPush.status(function (s) {
    if (!s.supported) {
      btn.textContent = 'Push not available';
      btn.disabled = true;
      status.textContent = 'Push API not supported on this device.';
      return;
    }
    btn.disabled = false;
    if (s.subscribed) {
      btn.textContent = 'Disable call notifications';
      btn.style.color = 'var(--error)';
      status.textContent = 'Enabled — this device will receive incoming call notifications.';
    } else {
      btn.textContent = 'Enable call notifications';
      status.textContent = '';
    }
  });
  btn.addEventListener('click', function () {
    btn.disabled = true;
    btn.textContent = 'Working…';
    ExtrovertPush.status(function (s) {
      if (s.subscribed) {
        ExtrovertPush.disable(function (ok) {
          if (ok) {
            btn.textContent = 'Enable call notifications';
            btn.style.color = '';
            status.textContent = '';
          } else {
            btn.textContent = 'Error — try again';
          }
          btn.disabled = false;
        });
      } else {
        ExtrovertPush.enable(function (ok) {
          if (ok) {
            btn.textContent = 'Disable call notifications';
            btn.style.color = 'var(--error)';
            status.textContent = 'Enabled — this device will receive incoming call notifications.';
          } else {
            btn.textContent = 'Permission denied or error';
            btn.style.color = '';
            status.textContent = 'You may need to allow notifications in your browser settings.';
          }
          btn.disabled = false;
        });
      }
    });
  });
})();
