(function(){
  var tabs = document.querySelectorAll('#typeTabs button');
  var field = document.getElementById('typeField');
  var wrap = document.getElementById('mediaWrap');
  if (!tabs.length || !field || !wrap) return;
  tabs.forEach(function(b){
    b.addEventListener('click', function(){
      tabs.forEach(function(x){ x.classList.remove('active'); });
      b.classList.add('active');
      field.value = b.dataset.type;
      wrap.style.display = (b.dataset.type === 'text') ? 'none' : 'block';
    });
  });
})();
