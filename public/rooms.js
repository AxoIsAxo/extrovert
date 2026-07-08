document.addEventListener('DOMContentLoaded', function() {
  var msgArea = document.getElementById('room-messages');
  var sendForm = document.getElementById('room-send-form');
  var channelList = document.getElementById('channel-list');
  var channelName = document.getElementById('channel-name');
  var reportOverlay = document.getElementById('report-overlay');
  var reportForm = document.getElementById('report-form');

  if (!msgArea || !sendForm || !channelList) return;

  loadMessages(msgArea.dataset.channelId);

  channelList.addEventListener('click', function(e) {
    var link = e.target.closest('.room-channel');
    if (!link) return;
    e.preventDefault();
    channelList.querySelectorAll('.room-channel').forEach(function(c) { c.classList.remove('active'); });
    link.classList.add('active');
    var cid = link.dataset.channelId;
    switchChannel(cid, link.querySelector('span').textContent);
  });

  sendForm.addEventListener('submit', function(e) {
    e.preventDefault();
    var cid = sendForm.dataset.channelId;
    if (!cid) return;
    var input = sendForm.querySelector('input[name="body"]');
    var body = input.value.trim();
    if (!body) return;
    input.disabled = true;

    var csrf = getCsrf();
    fetch('/rooms/' + roomId() + '/channels/' + cid + '/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-CSRF-Token': csrf },
      body: 'body=' + encodeURIComponent(body)
    }).then(function(r) { return r.json(); }).then(function() {
      input.value = '';
      input.disabled = false;
      input.focus();
      loadMessages(cid);
    }).catch(function() { input.disabled = false; });
  });

  // Report buttons: delegation on msgArea for server-rendered and AJAX messages
  msgArea.addEventListener('click', function(e) {
    var reportBtn = e.target.closest('.room-msg-report');
    if (!reportBtn) return;
    var msgId = reportBtn.dataset.msgId;
    var msgDiv = reportBtn.closest('.room-msg');
    var msgText = msgDiv ? msgDiv.querySelector('.room-msg-text') : null;
    var preview = document.getElementById('report-message-preview');
    if (preview && msgText) preview.textContent = msgText.textContent;
    document.getElementById('report-msg-id').value = msgId;
    document.getElementById('report-reason').value = '';
    if (reportOverlay) reportOverlay.style.display = 'flex';
  });

  // Close report overlay
  document.addEventListener('click', function(e) {
    if (e.target.closest('.close-report-overlay')) {
      if (reportOverlay) reportOverlay.style.display = 'none';
    }
  });

  // Submit report
  if (reportForm) {
    reportForm.addEventListener('submit', function(e) {
      e.preventDefault();
      var msgId = document.getElementById('report-msg-id').value;
      var reason = document.getElementById('report-reason').value.trim();
      if (!msgId || !reason) return;
      var csrf = getCsrf();
      var cid = sendForm ? sendForm.dataset.channelId : '';
      fetch('/rooms/' + roomId() + '/channels/' + cid + '/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-CSRF-Token': csrf },
        body: 'message_id=' + encodeURIComponent(msgId) + '&reason=' + encodeURIComponent(reason)
      }).then(function(r) { return r.json(); }).then(function(d) {
        if (d.ok) {
          if (reportOverlay) reportOverlay.style.display = 'none';
          alert('Report submitted.');
        }
      }).catch(function() {});
    });
  }

  function switchChannel(cid, name) {
    msgArea.dataset.channelId = cid;
    sendForm.dataset.channelId = cid;
    channelName.textContent = name;
    sendForm.querySelector('input[name="body"]').placeholder = 'Message #' + name;
    loadMessages(cid);
  }

  function loadMessages(cid) {
    if (!cid) return;
    fetch('/rooms/' + roomId() + '/channels/' + cid + '/messages')
      .then(function(r) { return r.json(); })
      .then(function(data) {
        renderMessages(data.messages || [], data.roleMap || {});
      });
  }

  function renderMessages(messages, roleMap) {
    if (!messages || !messages.length) {
      msgArea.innerHTML = '<div class="room-msg"><div class="room-msg-body"><div class="room-msg-body-inner"><span class="muted">No messages yet</span></div></div></div>';
      return;
    }
      msgArea.innerHTML = '';
    messages.forEach(function(m) {
      var div = document.createElement('div');
      div.className = 'room-msg';
      var wrap = document.createElement('div');
      wrap.className = 'room-msg-avatar-wrap';
      if (m.avatar) {
        var img = document.createElement('img');
        img.className = 'room-msg-avatar';
        img.src = m.avatar;
        img.alt = '';
        img.addEventListener('error', function() { this.style.display = 'none'; });
        wrap.appendChild(img);
      } else {
        var letter = document.createElement('span');
        letter.className = 'room-msg-avatar room-msg-avatar-letter';
        letter.textContent = (m.display_name || m.username)[0].toUpperCase();
        wrap.appendChild(letter);
      }
      div.appendChild(wrap);
      var bodyDiv = document.createElement('div');
      bodyDiv.className = 'room-msg-body';
      var headerDiv = document.createElement('div');
      headerDiv.className = 'room-msg-header';
      var color = roleMap[m.user_id] || '#ccc';
      headerDiv.innerHTML = '<span class="room-msg-author" style="color:' + color + '">' + escHtml(m.display_name || m.username) + '</span><span class="room-msg-time">' + relTime(m.created_at) + '</span>';
      bodyDiv.appendChild(headerDiv);
      var innerDiv = document.createElement('div');
      innerDiv.className = 'room-msg-body-inner';
      innerDiv.innerHTML = '<span class="room-msg-text">' + escHtml(m.body) + '</span>';
      bodyDiv.appendChild(innerDiv);
      var reportSpan = document.createElement('span');
      reportSpan.className = 'room-msg-report';
      reportSpan.dataset.msgId = m.id;
      reportSpan.textContent = 'Report';
      bodyDiv.appendChild(reportSpan);
      div.appendChild(bodyDiv);
      msgArea.appendChild(div);
    });
    msgArea.scrollTop = msgArea.scrollHeight;
  }

  function escHtml(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
  function getCsrf() {
    var meta = document.querySelector('meta[name="csrf-token"]');
    if (meta) return meta.content;
    var inp = sendForm.querySelector('input[name="_csrf"]');
    return inp ? inp.value : '';
  }
  function roomId() { return window.location.pathname.split('/')[2]; }

function relTime(ts) {
    var s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
    if (s < 60) return s + 's';
    if (s < 3600) return Math.floor(s / 60) + 'm';
    if (s < 86400) return Math.floor(s / 3600) + 'h';
    if (s < 604800) return Math.floor(s / 86400) + 'd';
    return new Date(ts).toLocaleDateString();
  }
});