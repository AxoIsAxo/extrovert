(function () {
  'use strict';

  var incomingOverlay = null;
  var activeCallBar = null;
  var callTimerInterval = null;
  var ringingAudioCtx = null;
  var ringingTimeout = null;
  var pendingIncoming = null;

  var onlineStatuses = {};

  document.addEventListener('DOMContentLoaded', function () {
    if (!window.ExtrovertCall) return;

    createIncomingOverlay();
    createActiveCallBar();
    initCallButtons();

    ExtrovertCall.on('incoming_call', onIncomingCall);
    ExtrovertCall.on('calling', onCalling);
    ExtrovertCall.on('call_connected', onCallConnected);
    ExtrovertCall.on('call_ended', onCallEnded);
    ExtrovertCall.on('call_declined', onCallDeclined);
    ExtrovertCall.on('user_online', onUserOnline);
    ExtrovertCall.on('user_offline', onUserOffline);
    ExtrovertCall.on('remote_stream', onRemoteStream);
    ExtrovertCall.on('error', onError);

    ExtrovertCall.connect();
  });

  function createIncomingOverlay() {
    incomingOverlay = document.createElement('div');
    incomingOverlay.id = 'call-incoming-overlay';
    incomingOverlay.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:9999;align-items:center;justify-content:center;flex-direction:column;gap:16px';
    incomingOverlay.innerHTML =
      '<div style="font-size:2rem;font-weight:700" id="call-incoming-label">Incoming call...</div>' +
      '<div style="font-size:1.2rem;color:var(--text-muted)" id="call-incoming-from"></div>' +
      '<div style="display:flex;gap:16px;margin-top:8px">' +
        '<button id="call-answer-btn" style="padding:12px 32px;background:#22c55e;color:#fff;border:none;border-radius:8px;font-size:1.1rem;cursor:pointer">Answer</button>' +
        '<button id="call-decline-btn" style="padding:12px 32px;background:#ef4444;color:#fff;border:none;border-radius:8px;font-size:1.1rem;cursor:pointer">Decline</button>' +
      '</div>';
    document.body.appendChild(incomingOverlay);

    document.getElementById('call-answer-btn').addEventListener('click', function () {
      if (pendingIncoming) {
        createRemoteAudioEl();
        ExtrovertCall.answerCall(pendingIncoming.username, pendingIncoming.sdp);
        pendingIncoming = null;
        hideIncomingOverlay();
      }
    });

    document.getElementById('call-decline-btn').addEventListener('click', function () {
      if (pendingIncoming) {
        ExtrovertCall.declineCall(pendingIncoming.username);
        pendingIncoming = null;
        hideIncomingOverlay();
      }
    });
  }

  function createActiveCallBar() {
    activeCallBar = document.createElement('div');
    activeCallBar.id = 'call-active-bar';
    activeCallBar.style.cssText = 'display:none;position:fixed;bottom:0;left:0;right:0;background:var(--card);border-top:1px solid var(--border);z-index:9998;padding:8px 16px;align-items:center;justify-content:space-between';
    activeCallBar.innerHTML =
      '<div style="display:flex;align-items:center;gap:12px">' +
        '<span style="font-size:1.2rem">🔊</span>' +
        '<div>' +
          '<div style="font-weight:600" id="call-bar-label">In call</div>' +
          '<div style="font-size:0.85rem;color:var(--text-muted)" id="call-bar-timer">00:00</div>' +
        '</div>' +
      '</div>' +
      '<div style="display:flex;align-items:center;gap:8px">' +
        '<button id="call-mute-btn" style="padding:8px 16px;background:var(--surface-container);border:1px solid var(--border);border-radius:6px;cursor:pointer;font-size:0.9rem">Mute</button>' +
        '<button id="call-hangup-btn" style="padding:8px 24px;background:#ef4444;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:0.9rem;font-weight:600">Hang Up</button>' +
      '</div>';
    document.body.appendChild(activeCallBar);

    var muted = false;
    document.getElementById('call-mute-btn').addEventListener('click', function () {
      muted = ExtrovertCall.toggleMute();
      this.textContent = muted ? 'Unmute' : 'Mute';
      this.style.background = muted ? '#ef4444' : 'var(--surface-container)';
      this.style.color = muted ? '#fff' : '';
    });

    document.getElementById('call-hangup-btn').addEventListener('click', function () {
      ExtrovertCall.endCall();
    });
  }

  function initCallButtons() {
    document.querySelectorAll('.call-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var username = btn.dataset.username;
        if (username) {
          createRemoteAudioEl();
          ExtrovertCall.startCall(username);
        }
      });
    });
  }

  function createRemoteAudioEl() {
    if (!remoteAudioEl) {
      remoteAudioEl = document.createElement('audio');
      remoteAudioEl.autoplay = true;
      remoteAudioEl.playsinline = true;
      remoteAudioEl.style.display = 'none';
      document.body.appendChild(remoteAudioEl);
      remoteAudioEl.play().catch(function () {});
    }
  }

  function onIncomingCall(username, displayName, sdp) {
    pendingIncoming = { username: username, sdp: sdp };
    document.getElementById('call-incoming-from').textContent = displayName || username;
    incomingOverlay.style.display = 'flex';
    showRingingOverlay();
    startRinging();
    ringingTimeout = setTimeout(function () {
      if (pendingIncoming) {
        ExtrovertCall.declineCall(pendingIncoming.username);
        pendingIncoming = null;
        hideIncomingOverlay();
        stopRinging();
      }
    }, 30000);
  }

  function onCalling(username) {
    showCallingBar(username);
  }

  function onCallConnected(username) {
    stopRinging();
    hideIncomingOverlay();
    showConnectedBar(username);
  }

  function onCallEnded(username) {
    stopRinging();
    hideIncomingOverlay();
    hideActiveCallBar();
    stopCallTimer();
    cleanupRemoteAudio();
  }

  function onCallDeclined(username) {
    stopRinging();
    hideIncomingOverlay();
    cleanupRemoteAudio();
  }

  function onUserOnline(username, displayName) {
    onlineStatuses[username] = true;
    updateOnlineDots();
    updateCallButtons();
  }

  function onUserOffline(username) {
    onlineStatuses[username] = false;
    updateOnlineDots();
    updateCallButtons();
  }

  var remoteAudioEl = null;

  function onRemoteStream(username, stream) {
    if (remoteAudioEl) {
      remoteAudioEl.srcObject = stream;
    }
  }

  function onError(message) {
    console.error('Call error:', message);
  }

  function showRingingOverlay() {
    document.getElementById('call-incoming-label').textContent = '📞 Incoming call...';
  }

  function startRinging() {
    try {
      ringingAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
      var osc = ringingAudioCtx.createOscillator();
      var gain = ringingAudioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 440;
      gain.gain.setValueAtTime(0.3, ringingAudioCtx.currentTime);
      osc.connect(gain);
      gain.connect(ringingAudioCtx.destination);
      osc.start();
      osc.onended = function () { try { ringingAudioCtx.close(); } catch {} };
      setTimeout(function () { try { osc.stop(); } catch {} }, 2000);
    } catch {}
  }

  function stopRinging() {
    if (ringingTimeout) { clearTimeout(ringingTimeout); ringingTimeout = null; }
    if (ringingAudioCtx) { try { ringingAudioCtx.close(); } catch {} ringingAudioCtx = null; }
  }

  function hideIncomingOverlay() {
    incomingOverlay.style.display = 'none';
  }

  function showCallingBar(username) {
    document.getElementById('call-bar-label').textContent = 'Calling ' + username + '...';
    activeCallBar.style.display = 'flex';
  }

  function showConnectedBar(username) {
    document.getElementById('call-bar-label').textContent = 'Call with ' + username;
    activeCallBar.style.display = 'flex';
    startCallTimer();
  }

  function hideActiveCallBar() {
    activeCallBar.style.display = 'none';
  }

  function cleanupRemoteAudio() {
    if (remoteAudioEl) {
      remoteAudioEl.pause();
      remoteAudioEl.srcObject = null;
      remoteAudioEl.remove();
      remoteAudioEl = null;
    }
  }

  function startCallTimer() {
    stopCallTimer();
    var el = document.getElementById('call-bar-timer');
    callTimerInterval = setInterval(function () {
      var s = Math.floor((Date.now() - (ExtrovertCall.getState().callStartTime || Date.now())) / 1000);
      var m = Math.floor(s / 60);
      s = s % 60;
      el.textContent = (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
    }, 1000);
  }

  function stopCallTimer() {
    if (callTimerInterval) { clearInterval(callTimerInterval); callTimerInterval = null; }
  }

  function updateOnlineDots() {
    document.querySelectorAll('.online-dot').forEach(function (dot) {
      var user = dot.dataset.user;
      if (onlineStatuses[user] !== undefined) {
        dot.classList.toggle('online', !!onlineStatuses[user]);
      }
    });
  }

  function updateCallButtons() {
    document.querySelectorAll('.call-btn').forEach(function (btn) {
      var user = btn.dataset.username;
      if (onlineStatuses[user] !== undefined) {
        btn.disabled = !onlineStatuses[user];
        btn.style.opacity = onlineStatuses[user] ? '1' : '0.4';
        btn.title = onlineStatuses[user] ? 'Call ' + user : user + ' is offline';
      }
    });
  }
})();
