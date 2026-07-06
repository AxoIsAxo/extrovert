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
          }).catch(function(){});
        }
      });
    }
  });
})();
