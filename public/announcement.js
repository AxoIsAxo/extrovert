// Announcement popover — opens below the pill, closes on outside click / Esc.
(function () {
  'use strict';
  const ann = document.getElementById('ann');
  if (!ann) return;
  const pill = document.getElementById('ann-pill');
  const pop = document.getElementById('ann-popover');
  if (!pill || !pop) return;

  function open() {
    pop.hidden = false;
    pill.setAttribute('aria-expanded', 'true');
    requestAnimationFrame(() => pop.classList.add('open'));
  }
  function close() {
    pop.classList.remove('open');
    pill.setAttribute('aria-expanded', 'false');
    setTimeout(() => { pop.hidden = true; }, 180);
  }
  function toggle() { pop.hidden ? open() : close(); }

  pill.addEventListener('click', (e) => { e.preventDefault(); toggle(); });
  pop.addEventListener('click', (e) => { if (e.target.closest('.ann-close')) close(); });
  document.addEventListener('click', (e) => {
    if (!ann.contains(e.target)) close();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
})();