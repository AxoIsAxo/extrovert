document.addEventListener('DOMContentLoaded', function(){
  var csrfMeta = document.querySelector('meta[name="csrf-token"]');
  var csrfToken = csrfMeta ? csrfMeta.getAttribute('content') : '';
  var relTime = window.relTime || function(t){ return new Date(t).toLocaleString(); };

  document.addEventListener('submit', function(e){
    var form = e.target;
    var confirmMsg = form.getAttribute('data-confirm');
    if (confirmMsg && !confirm(confirmMsg)) { e.preventDefault(); return; }
    var action = form.getAttribute('action') || '';
    var m = action.match(/^\/posts\/(\d+)\/(like|share|repost|follow-from|comment|delete)$/);
    var chatM = action.match(/^\/chats\/([^/]+)\/send$/);
    if (!m && !chatM) return;

    if (chatM) {
      e.preventDefault();
      var chatMsgDiv = document.querySelector('.chat-messages');
      if (!chatMsgDiv) return;
      var input = form.querySelector('input[name="body"]');
      if (!input || !input.value.trim()) return;

      fetch(action, {
        method: 'POST',
        headers: { 'X-Requested-With': 'XMLHttpRequest', 'X-CSRF-Token': csrfToken },
        body: new URLSearchParams(Array.from(new FormData(form))),
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
    e.preventDefault();

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
    var form = commentsDiv.querySelector('.comment-form');
    var postIdMatch = form ? form.getAttribute('action').match(/\/posts\/(\d+)/) : null;
    var postIdVal = postIdMatch ? postIdMatch[1] : '';
    var div = document.createElement('div');
    div.className = 'comment';
    div.dataset.commentId = c.id;
    var t = typeof timeFn === 'function' ? timeFn(c.created_at) : new Date(c.created_at).toLocaleString();
    var sticker = c.body && c.body.indexOf('/uploads/stickers/') !== -1;
    var editedHtml = c.edited_at ? ' <a href="/posts/' + c.id + '/history?type=comment&post_id=' + postIdVal + '" class="edited-link">(edited)</a>' : '';
    var ownEditHtml = ' <button class="btn ghost edit-comment-btn" style="font-size:11px;padding:1px 6px">Edit</button>';
    var deleteFormHtml = '<form method="post" action="/posts/' + postIdVal + '/comments/' + c.id + '/delete" class="delete-comment-form" style="display:inline"><input type="hidden" name="_csrf" value="' + csrfToken + '"><button class="btn ghost delete-comment-btn" type="submit" style="font-size:11px;padding:1px 6px;color:#c33">Delete</button></form>';
    div.innerHTML = '<b>' + esc(c.display_name) + '</b> <span class="post-handle">@' + esc(c.username) + '</span> <span class="post-time">· ' + t + '</span>' + editedHtml + '<br><span class="comment-body">' + (sticker ? '<img src="' + esc(c.body) + '" class="sticker-inline" style="max-width:120px;max-height:120px;vertical-align:middle" alt="sticker">' : esc(c.body)) + '</span>' + ownEditHtml + deleteFormHtml + '<form class="edit-comment-form" method="post" action="/posts/' + postIdVal + '/comments/' + c.id + '/edit" style="display:none;margin-top:4px"><input type="hidden" name="_csrf" value="' + csrfToken + '"><input type="text" name="body" value="' + esc(c.body) + '" maxlength="1000" style="width:80%"><button class="btn" type="submit" style="font-size:11px;padding:2px 8px">Save</button><button class="btn ghost cancel-edit-comment" type="button" style="font-size:11px;padding:2px 8px">Cancel</button></form>';
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

  // Edit post / comment / chat message toggles
  document.addEventListener('click', function(e){
    var editPostBtn = e.target.closest('.edit-post-btn');
    if (editPostBtn) {
      e.preventDefault();
      var postEl = editPostBtn.closest('.post');
      var form = postEl ? postEl.querySelector('.edit-post-form') : null;
      if (form) form.style.display = form.style.display === 'none' ? 'block' : 'none';
      return;
    }
    var cancelEditPost = e.target.closest('.cancel-edit-post');
    if (cancelEditPost) {
      var form = cancelEditPost.closest('.edit-post-form');
      if (form) form.style.display = 'none';
      return;
    }
    var editCommentBtn = e.target.closest('.edit-comment-btn');
    if (editCommentBtn) {
      e.preventDefault();
      var commentDiv = editCommentBtn.closest('.comment');
      var form = commentDiv ? commentDiv.querySelector('.edit-comment-form') : null;
      if (form) form.style.display = form.style.display === 'none' ? 'block' : 'none';
      return;
    }
    var cancelEditComment = e.target.closest('.cancel-edit-comment');
    if (cancelEditComment) {
      var form = cancelEditComment.closest('.edit-comment-form');
      if (form) form.style.display = 'none';
      return;
    }
    var deleteCommentBtn = e.target.closest('.delete-comment-btn');
    if (deleteCommentBtn) {
      e.preventDefault();
      if (!confirm('Delete this comment?')) return;
      var form = deleteCommentBtn.closest('.delete-comment-form');
      var commentDiv = deleteCommentBtn.closest('.comment');
      var postEl = commentDiv ? commentDiv.closest('.post') : null;
      fetch(form.getAttribute('action'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-CSRF-Token': csrfToken },
        body: new URLSearchParams(Array.from(new FormData(form))),
      }).then(function(r){ return r.json(); }).then(function(d){
        if (d.ok) {
          if (commentDiv) commentDiv.remove();
          var stats = postEl ? postEl.querySelector('.post-stats') : null;
          if (stats) {
            var spans = stats.querySelectorAll('span');
            for (var i = 0; i < spans.length; i++) {
              var m2 = spans[i].textContent.match(/💬\s*(\d+)/);
              if (m2) {
                spans[i].textContent = '💬 ' + Math.max(0, parseInt(m2[1],10) - 1);
                break;
              }
            }
          }
        }
      });
      return;
    }
    var editMsgBtn = e.target.closest('.edit-msg-btn');
    if (editMsgBtn) {
      e.preventDefault();
      var msgDiv = editMsgBtn.closest('.chat-msg');
      var form = msgDiv ? msgDiv.querySelector('.edit-msg-form') : null;
      if (form) form.style.display = form.style.display === 'none' ? 'block' : 'none';
      return;
    }
    var cancelEditMsg = e.target.closest('.cancel-edit-msg');
    if (cancelEditMsg) {
      var form = cancelEditMsg.closest('.edit-msg-form');
      if (form) form.style.display = 'none';
      return;
    }
  });

  // XHR submit for edit forms
  document.addEventListener('submit', function(e){
    var form = e.target;
    if (form.classList.contains('edit-post-form')) {
      e.preventDefault();
      var action = form.getAttribute('action');
      var textarea = form.querySelector('textarea');
      if (!textarea || !textarea.value.trim()) return;
      fetch(action, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-CSRF-Token': csrfToken },
        body: new URLSearchParams(Array.from(new FormData(form))),
      }).then(function(r){ return r.json(); }).then(function(d){
        if (d.ok) location.reload();
      });
    } else if (form.classList.contains('edit-comment-form')) {
      e.preventDefault();
      var action = form.getAttribute('action');
      var input = form.querySelector('input[name="body"]');
      if (!input || !input.value.trim()) return;
      fetch(action, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-CSRF-Token': csrfToken },
        body: new URLSearchParams(Array.from(new FormData(form))),
      }).then(function(r){ return r.json(); }).then(function(d){
        if (d.ok) location.reload();
      });
    } else if (form.classList.contains('edit-msg-form')) {
      e.preventDefault();
      var action = form.getAttribute('action');
      var input = form.querySelector('input[name="body"]');
      if (!input || !input.value.trim()) return;
      fetch(action, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-CSRF-Token': csrfToken },
        body: new URLSearchParams(Array.from(new FormData(form))),
      }).then(function(r){ return r.json(); }).then(function(d){
        if (d.ok) location.reload();
      });
    }
  });

  function showToast(msg){
    var el = document.createElement('div');
    el.textContent = msg;
    el.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#333;color:#fff;padding:8px 16px;border-radius:8px;font-size:14px;z-index:9999;opacity:0;transition:opacity .3s';
    document.body.appendChild(el);
    requestAnimationFrame(function(){ el.style.opacity = '1'; });
    setTimeout(function(){ el.style.opacity = '0'; setTimeout(function(){ el.remove(); }, 300); }, 1500);
  }
});
