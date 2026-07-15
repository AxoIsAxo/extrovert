(function() {
  var key = 'extrovert-theme';
  var saved = localStorage.getItem(key);
  var theme = saved || 'dark';
  document.documentElement.dataset.theme = theme;
  updateToggleLabel(theme);

  window.toggleTheme = function() {
    var current = document.documentElement.dataset.theme;
    var next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem(key, next);
    updateToggleLabel(next);
  };

  function updateToggleLabel(t) {
    var btn = document.getElementById('theme-toggle');
    if (!btn) return;
    btn.textContent = t === 'dark' ? '\u2600' : '\u263E';
    btn.title = t === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
  }
})();
