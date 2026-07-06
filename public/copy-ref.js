(function(){
  document.addEventListener('DOMContentLoaded', function(){
    var btns = document.querySelectorAll('.copy-ref');
    for(var i=0;i<btns.length;i++){
      btns[i].addEventListener('click', function(){
        var url = this.getAttribute('data-link');
        var btn = this;
        if(navigator.clipboard){
          navigator.clipboard.writeText(url).then(function(){
            btn.textContent = 'Copied!';
            setTimeout(function(){btn.textContent='Copy Referral'},2000);
          }).catch(function(e){
            fallback(url,btn);
          });
        } else {
          fallback(url,btn);
        }
      });
    }
    function fallback(text,btn){
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      ta.style.top = '-9999px';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      try { document.execCommand('copy'); } catch(e){ console.error('copy fallback failed',e); }
      document.body.removeChild(ta);
      btn.textContent = 'Copied!';
      setTimeout(function(){btn.textContent='Copy Referral'},2000);
    }
  });
})();
