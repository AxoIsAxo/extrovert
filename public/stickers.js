document.addEventListener('DOMContentLoaded', function(){
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
});
