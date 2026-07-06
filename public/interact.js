document.addEventListener('DOMContentLoaded', function(){
  var csrfMeta = document.querySelector('meta[name="csrf-token"]');
  var csrfToken = csrfMeta ? csrfMeta.getAttribute('content') : '';
  var relTime = window.relTime || function(t){ return new Date(t).toLocaleString(); };

  document.addEventListener('submit', function(e){
    var form = e.target;
    var action = form.getAttribute('action') || '';
    var m = action.match(/^\/posts\/(\d+)\/(like|share|repost|follow-from|comment|delete)$/);
    var chatM = action.match(/^\/chats\/([^/]+)\/send$/);
    if (!m && !chatM) return;
    e.preventDefault();

    if (chatM) {
      var otherUsername = chatM[1];
      var chatMsgDiv = document.querySelector('.chat-messages');
      if (!chatMsgDiv) return;
      var input = form.querySelector('input[name="body"]');
      if (!input || !input.value.trim()) return;

      var fd = new FormData(form);
      fetch(action, {
        method: 'POST',
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
        body: fd,
      })
      .then(function(r){ return r.json(); })
      .then(function(data){
        if (data.error) return;
        if (data.message) {
          addChatMessage(chatMsgDiv, data.message);
          input.value = '';
          chatMsgDiv.scrollTop = chatMsgDiv.scrollHeight;
        }
      })
      .catch(function(){});
      return;
    }

    var postId = m[1], verb = m[2];
    var postEl = form.closest('.post');
    if (!postEl) return;

    var body = {};
    if (verb === 'comment') {
      var input = form.querySelector('input[name="body"]');
      if (!input || !input.value.trim()) return;
      body.body = input.value;
    }

    fetch(action, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        'X-CSRF-Token': csrfToken,
      },
      body: verb === 'comment' ? JSON.stringify(body) : undefined,
    })
    .then(function(r){ return r.json(); })
    .then(function(data){
      if (data.error) return;
      switch (verb) {
        case 'like':
          updateStats(postEl, 'like', data.liked, data.likeCount);
          toggleBtn(form, data.liked ? '♥ Liked' : '♡ Like', data.liked);
          break;
        case 'share':
          updateStats(postEl, 'share', data.shared, data.shareCount);
          toggleBtn(form, 'Share', data.shared);
          break;
        case 'repost':
          showToast('Reposted!');
          break;
        case 'follow-from':
          form.remove();
          break;
        case 'comment':
          if (data.comment) {
            addCommentHtml(postEl, data.comment, relTime);
            var inp = form.querySelector('input[name="body"]');
            if (inp) inp.value = '';
          }
          break;
        case 'delete':
          postEl.remove();
          break;
      }
    })
    .catch(function(){});
  });

  function updateStats(postEl, type, active, count){
    var stats = postEl.querySelector('.post-stats');
    if (!stats) return;
    var labels = { like: '❤️', share: '🔗' };
    var icon = labels[type] || '';
    var spans = stats.querySelectorAll('span');
    for (var i = 0; i < spans.length; i++) {
      if (spans[i].textContent.indexOf(icon) !== -1) {
        spans[i].textContent = icon + ' ' + count;
        break;
      }
    }
  }

  function toggleBtn(form, text, active){
    var btn = form.querySelector('button');
    if (!btn) return;
    btn.textContent = text;
    if (active) btn.classList.add('active');
    else btn.classList.remove('active');
  }

  function addCommentHtml(postEl, c, timeFn){
    var commentsDiv = postEl.querySelector('.post-comments');
    if (!commentsDiv) return;
    var div = document.createElement('div');
    div.className = 'comment';
    var t = typeof timeFn === 'function' ? timeFn(c.created_at) : new Date(c.created_at).toLocaleString();
    var sticker = c.body && c.body.indexOf('/uploads/stickers/') !== -1;
    div.innerHTML = '<b>' + esc(c.display_name) + '</b> <span class="post-handle">@' + esc(c.username) + '</span> <span class="post-time">· ' + t + '</span><br>' + (sticker ? '<img src="' + esc(c.body) + '" class="sticker-inline" style="max-width:120px;max-height:120px;vertical-align:middle" alt="sticker">' : esc(c.body));
    var form = commentsDiv.querySelector('.comment-form');
    if (form) commentsDiv.insertBefore(div, form);
    else commentsDiv.appendChild(div);
    // Update comment count in stats.
    var stats = postEl.querySelector('.post-stats');
    if (stats) {
      var spans = stats.querySelectorAll('span');
      for (var i = 0; i < spans.length; i++) {
        var m2 = spans[i].textContent.match(/💬\s*(\d+)/);
        if (m2) {
          spans[i].textContent = '💬 ' + (parseInt(m2[1],10) + 1);
          break;
        }
      }
    }
  }

  function addChatMessage(container, msg){
    var div = document.createElement('div');
    div.className = 'chat-msg own';
    var bubble = document.createElement('div');
    bubble.className = 'chat-bubble';
    var sticker = msg.body && msg.body.indexOf('/uploads/stickers/') !== -1;
    bubble.innerHTML = (msg.key_for_sender ? '🔒' : '') + (sticker ? '<img src="' + esc(msg.body) + '" class="sticker-inline" style="max-width:120px;max-height:120px;vertical-align:middle" alt="sticker">' : esc(msg.body));
    div.appendChild(bubble);
    var time = document.createElement('div');
    time.className = 'muted';
    time.style.cssText = 'font-size:0.7rem;padding:0 4px';
    time.textContent = relTime ? relTime(msg.created_at) : new Date(msg.created_at).toLocaleString();
    div.appendChild(time);
    container.appendChild(div);
  }

  function esc(s){
    var d = document.createElement('div');
    d.appendChild(document.createTextNode(s));
    return d.innerHTML;
  }

  function showToast(msg){
    var el = document.createElement('div');
    el.textContent = msg;
    el.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#333;color:#fff;padding:8px 16px;border-radius:8px;font-size:14px;z-index:9999;opacity:0;transition:opacity .3s';
    document.body.appendChild(el);
    requestAnimationFrame(function(){ el.style.opacity = '1'; });
    setTimeout(function(){ el.style.opacity = '0'; setTimeout(function(){ el.remove(); }, 300); }, 1500);
  }
});
