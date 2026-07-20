// Live character counter + preview sync for the admin announcement editor.
(function () {
  'use strict';
  const ta = document.getElementById('ann-body');
  const counter = document.getElementById('ann-counter');
  const previewPillText = document.querySelector('.ann-admin-preview-pill .ann-pill-text');
  if (ta && counter) {
    ta.addEventListener('input', () => {
      counter.textContent = ta.value.length + '/280';
      if (previewPillText) previewPillText.textContent = ta.value || 'Preview will appear here…';
    });
  }
})();