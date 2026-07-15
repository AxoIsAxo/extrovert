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
    var ownMenuHtml = '<div class="comment-menu-container"><button class="comment-menu-btn">⋮</button><div class="comment-menu" style="display:none"><button class="edit-comment-btn">Edit</button><form method="post" action="/posts/' + postIdVal + '/comments/' + c.id + '/delete" class="delete-comment-form"><input type="hidden" name="_csrf" value="' + csrfToken + '"><button class="delete-comment-btn">Delete</button></form></div></div>';
    var dataHtml = '<input type="hidden" class="edit-comment-data" value="' + esc(c.body) + '" data-csrf="' + csrfToken + '" data-action="/posts/' + postIdVal + '/comments/' + c.id + '/edit">';
    div.innerHTML = '<div class="comment-head"><div><b>' + esc(c.display_name) + '</b> <span class="post-handle">@' + esc(c.username) + '</span> <span class="post-time">· ' + t + '</span>' + editedHtml + '</div>' + ownMenuHtml + '</div><span class="comment-body">' + (sticker ? '<img src="' + esc(c.body) + '" class="sticker-inline" style="max-width:120px;max-height:120px;vertical-align:middle" alt="sticker">' : esc(c.body)) + '</span>' + dataHtml;
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

  // Close all comment menus
  function closeCommentMenus() {
    document.querySelectorAll('.comment-menu').forEach(function(m){ m.style.display = 'none'; });
  }

  // Inline editing helpers
  function replaceWithInput(el, className, multiline, saveFn, cancelFn) {
    var origText = el.textContent;
    var input;
    if (multiline) {
      input = document.createElement('textarea');
    } else {
      input = document.createElement('input');
      input.type = 'text';
    }
    input.className = 'inline-edit-input ' + className;
    input.value = origText;
    input.className = 'inline-edit-input';
    el.replaceWith(input);
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);

    function finish(save) {
      if (save) {
        var val = input.value.trim();
        if (val && val !== origText) {
          saveFn(val, function() {
            var span = document.createElement(el.tagName);
            span.className = el.className;
            span.textContent = val;
            input.replaceWith(span);
          }, function() {
            input.value = origText;
            cancel();
          });
          return;
        }
      }
      cancel();
    }

    function cancel() {
      var span = document.createElement(el.tagName);
      span.className = el.className;
      span.textContent = origText;
      input.replaceWith(span);
      if (cancelFn) cancelFn();
    }

    input.addEventListener('keydown', function(ev) {
      if (ev.key === 'Escape') { finish(false); ev.preventDefault(); }
      if (ev.key === 'Enter' && !multiline) { finish(true); ev.preventDefault(); }
    });
    input.addEventListener('blur', function() {
      setTimeout(function() { if (!input.parentNode) return; finish(false); }, 200);
    });
    return { input, finish, cancel };
  }

  // Edit post / comment / chat message toggles
  document.addEventListener('click', function(e){
    // Close menus on outside click
    if (!e.target.closest('.comment-menu-container')) {
      closeCommentMenus();
    }

    var commentMenuBtn = e.target.closest('.comment-menu-btn');
    if (commentMenuBtn) {
      e.preventDefault();
      e.stopPropagation();
      var menu = commentMenuBtn.parentNode.querySelector('.comment-menu');
      if (!menu) return;
      var isOpen = menu.style.display !== 'none';
      closeCommentMenus();
      menu.style.display = isOpen ? 'none' : 'block';
      return;
    }

    // --- Inline post editing ---
    var editPostBtn = e.target.closest('.edit-post-btn');
    if (editPostBtn) {
      e.preventDefault();
      var postEl = editPostBtn.closest('.post');
      if (!postEl || postEl.querySelector('.inline-edit-input')) return;
      var bodyEl = postEl.querySelector('.post-body');
      var dataEl = postEl.querySelector('.edit-post-data');
      if (!bodyEl || !dataEl) return;
      var action = dataEl.dataset.action;
      var csrf = dataEl.dataset.csrf;
      editPostBtn.textContent = 'Saving…';
      editPostBtn.disabled = true;

      replaceWithInput(bodyEl, 'post-body-edit', true,
        function(val, onSuccess) {
          fetch(action, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-CSRF-Token': csrf },
            body: 'body=' + encodeURIComponent(val) + '&_csrf=' + encodeURIComponent(csrf),
          }).then(function(r){ return r.json(); }).then(function(d){
            editPostBtn.textContent = 'Edit';
            editPostBtn.disabled = false;
            if (d.ok) { onSuccess(); } else { location.reload(); }
          });
        },
        function() {
          editPostBtn.textContent = 'Edit';
          editPostBtn.disabled = false;
        }
      );
      return;
    }

    // --- Inline comment editing ---
    var editCommentBtn = e.target.closest('.edit-comment-btn');
    if (editCommentBtn) {
      e.preventDefault();
      closeCommentMenus();
      var commentDiv = editCommentBtn.closest('.comment');
      if (!commentDiv || commentDiv.querySelector('.inline-edit-input')) return;
      var bodyEl = commentDiv.querySelector('.comment-body');
      var dataEl = commentDiv.querySelector('.edit-comment-data');
      if (!bodyEl || !dataEl) return;
      var action = dataEl.dataset.action;
      var csrf = dataEl.dataset.csrf;
      var origText = bodyEl.textContent;

      var r = replaceWithInput(bodyEl, 'comment-body-edit', false,
        function(val, onSuccess) {
          fetch(action, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-CSRF-Token': csrf },
            body: 'body=' + encodeURIComponent(val) + '&_csrf=' + encodeURIComponent(csrf),
          }).then(function(r){ return r.json(); }).then(function(d){
            if (d.ok) { onSuccess(); } else { r.cancel(); }
          });
        }
      );
      return;
    }

    // --- Delete comment ---
    var deleteCommentBtn = e.target.closest('.delete-comment-btn');
    if (deleteCommentBtn) {
      e.preventDefault();
      closeCommentMenus();
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

    // --- Inline DM editing ---
    var editMsgBtn = e.target.closest('.edit-msg-btn');
    if (editMsgBtn) {
      e.preventDefault();
      var msgDiv = editMsgBtn.closest('.chat-msg');
      if (!msgDiv || msgDiv.querySelector('.inline-edit-input')) return;
      var bubble = msgDiv.querySelector('.chat-bubble');
      var dataEl = msgDiv.querySelector('.edit-msg-data');
      if (!bubble || !dataEl) return;
      var action = dataEl.dataset.action;
      var csrf = dataEl.dataset.csrf;
      var origText = bubble.textContent;
      editMsgBtn.textContent = 'Saving…';
      editMsgBtn.disabled = true;

      replaceWithInput(bubble, 'chat-bubble-edit', false,
        function(val, onSuccess) {
          fetch(action, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-CSRF-Token': csrf },
            body: 'body=' + encodeURIComponent(val) + '&_csrf=' + encodeURIComponent(csrf),
          }).then(function(r){ return r.json(); }).then(function(d){
            editMsgBtn.textContent = 'Edit';
            editMsgBtn.disabled = false;
            if (d.ok) { onSuccess(); } else { location.reload(); }
          });
        },
        function() {
          editMsgBtn.textContent = 'Edit';
          editMsgBtn.disabled = false;
        }
      );
      return;
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
