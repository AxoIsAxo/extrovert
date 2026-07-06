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
              img.style.cssText = 'width:60px;height:60px;object-fit:contain;border-radius:6px;cursor:pointer;background:var(--bg2)';
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

  // Click any sticker to add to your collection.
  document.querySelectorAll('.sticker-inline').forEach(function(img){
    img.addEventListener('click', function(e){
      e.stopPropagation();
      var path = img.getAttribute('src');
      if (!path) return;
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
