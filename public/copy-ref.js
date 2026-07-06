(function(){
  document.addEventListener('DOMContentLoaded', function(){
    var btns = document.querySelectorAll('.copy-ref');
    for(var i=0;i<btns.length;i++){
      btns[i].addEventListener('click', function(){
        var url = this.getAttribute('data-link');
        var btn = this;
        if(navigator.clipboard){
          navigator.clipboard.writeText(url).then(function(){
            var orig = btn.textContent;
            btn.textContent = 'Copied!';
            setTimeout(function(){btn.textContent=orig},2000);
          }).catch(function(){
            showInput(btn, url);
          });
        } else {
          showInput(btn, url);
        }
      });
    }
    function showInput(btn, url){
      var parent = btn.parentNode;
      var input = document.createElement('input');
      input.type = 'text';
      input.value = url;
      input.readOnly = true;
      input.className = 'copy-input-fallback';
      parent.replaceChild(input, btn);
      input.focus();
      input.select();
      setTimeout(function(){
        parent.replaceChild(btn, input);
      }, 5000);
    }
  });
})();
