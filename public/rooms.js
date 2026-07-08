document.addEventListener('DOMContentLoaded', function() {
  // Delete room confirmation (on settings page too)
  var deleteForm = document.querySelector('.delete-room-form');
  if (deleteForm) {
    deleteForm.addEventListener('submit', function(e) {
      if (!confirm('Delete this room permanently? This cannot be undone.')) e.preventDefault();
    });
  }

  var msgArea = document.getElementById('room-messages');
  var sendForm = document.getElementById('room-send-form');
  var channelList = document.getElementById('channel-list');
  var channelName = document.getElementById('channel-name');

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
      msgArea.innerHTML = '<div class="room-msg"><div class="room-msg-body"><span class="muted">No messages yet</span></div></div>';
      return;
    }
    msgArea.innerHTML = '';
    messages.forEach(function(m) {
      var div = document.createElement('div');
      div.className = 'room-msg';
      if (m.avatar) {
        var img = document.createElement('img');
        img.className = 'room-msg-avatar';
        img.src = m.avatar;
        img.alt = '';
        img.addEventListener('error', function() { this.style.display = 'none'; });
        div.appendChild(img);
      }
      var bodyDiv = document.createElement('div');
      bodyDiv.className = 'room-msg-body';
      var color = roleMap[m.user_id] || '#ccc';
      bodyDiv.innerHTML = '<span class="room-msg-author" style="color:' + color + '">' + escHtml(m.display_name || m.username) + '</span><span class="room-msg-text">' + escHtml(m.body) + '</span><span class="room-msg-time">' + relTime(m.created_at) + '</span>';
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