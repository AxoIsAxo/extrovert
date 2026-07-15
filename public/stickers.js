document.addEventListener('DOMContentLoaded', function(){
  var csrfMeta = document.querySelector('meta[name="csrf-token"]');
  var csrfToken = csrfMeta ? csrfMeta.getAttribute('content') : '';

  // Sticker picker in comment/chat forms.
  var pickers = document.querySelectorAll('.sticker-btn');
  pickers.forEach(function(btn){
    btn.addEventListener('click', function(e){
      e.preventDefault();
      var targetId = btn.dataset.target;
      var popup = document.getElementById(targetId);
      if (!popup) return;
      if (popup.style.display === 'block') {
        popup.style.display = 'none';
        return;
      }
      if (popup.querySelector('.sticker-grid')) {
        popup.style.display = 'block';
        return;
      }
      fetch('/stickers/mine')
        .then(function(r){ return r.json(); })
        .then(function(stickers){
          var grid = document.createElement('div');
          grid.className = 'sticker-grid';
          grid.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;padding:8px;max-width:260px;max-height:180px;overflow-y:auto';
          if (stickers.length === 0) {
            var p = document.createElement('div');
            p.className = 'muted';
            p.style.cssText = 'font-size:12px;padding:8px';
            p.textContent = 'No stickers \u2014 upload some!';
            grid.appendChild(p);
          } else {
            stickers.forEach(function(s){
              var img = document.createElement('img');
              img.src = s.file_path;
              img.alt = 'sticker';
              img.style.cssText = 'width:60px;height:60px;object-fit:contain;border-radius:var(--radius);cursor:pointer;background:var(--surface-2)';
              img.addEventListener('click', function(){
                var input = document.getElementById(targetId.replace('popup','input'));
                var form = input ? input.closest('form') : null;
                if (input) input.value = s.file_path;
                popup.style.display = 'none';
                if (form) form.submit();
              });
              grid.appendChild(img);
            });
          }
          popup.appendChild(grid);
          popup.style.display = 'block';
        });
    });
    document.addEventListener('click', function(e){
      var popup = document.getElementById(btn.dataset.target);
      if (!popup) return;
      if (!btn.contains(e.target) && !popup.contains(e.target)) {
        popup.style.display = 'none';
      }
    });
  });

  // Click any sticker to see option to add to your collection.
  document.querySelectorAll('.sticker-inline').forEach(function(img){
    img.addEventListener('click', function(e){
      e.stopPropagation();
      // Remove any existing menu first.
      document.querySelectorAll('.sticker-add-menu').forEach(function(m){ m.remove(); });
      var path = img.getAttribute('src');
      if (!path) return;
      var pos = img.getBoundingClientRect();
      var menu = document.createElement('div');
      menu.className = 'sticker-add-menu';
      menu.style.cssText = 'position:fixed;top:'+(pos.bottom+4)+'px;left:'+Math.max(4,pos.left)+'px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-lg);box-shadow:0 4px 16px rgba(0,0,0,.4);z-index:999;overflow:hidden;font-size:13px;min-width:140px';
      var btn = document.createElement('button');
      btn.textContent = 'Add to my stickers';
      btn.style.cssText = 'display:block;width:100%;padding:10px 18px;border:none;background:none;color:var(--text);cursor:pointer;text-align:left;white-space:nowrap';
      btn.addEventListener('click', function(ev){
        ev.stopPropagation();
        menu.remove();
        fetch('/stickers/add', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
          body: JSON.stringify({ path: path }),
        }).then(function(r){
          if (r.ok) showToast('Sticker added!');
          else showToast('Failed to add sticker');
        }).catch(function(){
          showToast('Failed to add sticker');
        });
      });
      menu.appendChild(btn);
      document.body.appendChild(menu);
    });
  });
  document.addEventListener('click', function(e){
    if (!e.target.classList.contains('sticker-inline')) {
      document.querySelectorAll('.sticker-add-menu').forEach(function(m){ m.remove(); });
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
