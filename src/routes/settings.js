'use strict';

const express = require('express');
const { getUserTheme, setUserTheme, getCustomization, setCustomization } = require('../db');

const router = express.Router();

const DARK_HTML = `<div class="ev-banner">
  <h2>Welcome to my profile</h2>
  <p>This is my customizable space on Extrovert. I can edit this HTML and the
  page CSS however I like — no JavaScript allowed.</p>
</div>
<div class="ev-posts-wrap">
  <!--POSTS-->
</div>`;

const DARK_CSS = `.ev-banner {
  padding: 32px;
  background: #2a2347;
  color: #d8ccff;
  border: 1px solid #7c5cff;
  border-radius: 18px;
  margin-bottom: 22px;
}
.ev-banner h2 { margin: 0 0 8px; color: #fff; }
.ev-banner p { margin: 0; opacity: .85; }
.ev-posts-wrap { display: flex; flex-direction: column; gap: 16px; }`;

const NEO_HTML = `<div class="ev-banner">
  <h2>👋 Welcome to my profile</h2>
  <p>This is my customizable space on Extrovert. I can edit this HTML and the
  page CSS however I like — no JavaScript allowed.</p>
</div>
<div class="ev-posts-wrap">
  <!--POSTS-->
</div>`;

const NEO_CSS = `.ev-banner {
  padding: 32px;
  background: #fef9ef;
  color: #1a1a1a;
  border: 4px solid #111;
  box-shadow: 6px 6px 0 #111;
  margin-bottom: 22px;
}
.ev-banner h2 { margin: 0 0 8px; color: #ff4500; font-family: "Courier New", monospace; text-transform: uppercase; letter-spacing: 1px; }
.ev-banner p { margin: 0; }
.ev-posts-wrap { display: flex; flex-direction: column; gap: 16px; }`;

router.get('/', (req, res) => {
  const user = res.locals.currentUser;
  if (!user) return res.redirect('/login');
  const theme = getUserTheme(user.id);
  res.render('settings', { theme });
});

router.post('/', (req, res) => {
  const user = res.locals.currentUser;
  if (!user) return res.redirect('/login');
  const theme = req.body.theme === 'neobrutalism' ? 'neobrutalism' : 'default';
  setUserTheme(user.id, theme);

  const custom = getCustomization(user.id);
  const oldHtml = (custom.html || '').trim();
  const oldCss = (custom.css || '').trim();

  const newHtml = oldHtml === DARK_HTML.trim() ? NEO_HTML
    : oldHtml === NEO_HTML.trim() ? DARK_HTML
    : null;
  const newCss = oldCss === DARK_CSS.trim() ? NEO_CSS
    : oldCss === NEO_CSS.trim() ? DARK_CSS
    : null;

  if (newHtml || newCss) {
    setCustomization(user.id, newHtml || custom.html, newCss || custom.css);
  }

  res.redirect('/');
});

module.exports = router;
