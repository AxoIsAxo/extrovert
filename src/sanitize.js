'use strict';

const sanitizeHtml = require('sanitize-html');

// CSS that can execute script (old IE) or load script-bearing resources is
// neutralized. Modern CSS alone cannot run JavaScript, so this is mostly about
// legacy vectors and keeping profiles self-contained.
function sanitizeCSS(css) {
  if (!css) return '';
  let out = css;
  out = out.replace(/expression\s*\(/gi, 'expression-disabled(');
  out = out.replace(/url\s*\(\s*['"]?\s*javascript:[^)]*\)/gi, 'url()');
  out = out.replace(/url\s*\(\s*['"]?\s*data:text\/html[^)]*\)/gi, 'url()');
  out = out.replace(/-moz-binding\s*:/gi, 'disabled-binding:');
  out = out.replace(/behavior\s*:/gi, 'disabled-behavior:');
  out = out.replace(/@import[^;]+;/gi, '');
  out = out.replace(/<\/?script[^>]*>/gi, '');
  // Prevent breaking out of the <style> element.
  out = out.replace(/<\/style/gi, '<\\/style');
  return out;
}

const ALLOWED_TAGS = [
  'div', 'span', 'p', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'a', 'img', 'b', 'i', 'em', 'strong', 'u', 's', 'strike', 'small', 'mark',
  'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'blockquote', 'pre', 'code',
  'table', 'thead', 'tbody', 'tr', 'th', 'td', 'caption', 'colgroup', 'col',
  'section', 'article', 'header', 'footer', 'nav', 'aside', 'main', 'figure', 'figcaption',
  'details', 'summary', 'abbr', 'address', 'cite', 'q', 'sub', 'sup', 'time', 'kbd', 'var',
];

const ALLOWED_ATTRS = {
  '*': ['class', 'id', 'style', 'title', 'dir', 'lang'],
  a: ['href', 'name', 'target', 'rel'],
  img: ['src', 'alt', 'width', 'height', 'loading'],
  td: ['colspan', 'rowspan'],
  th: ['colspan', 'rowspan'],
  col: ['span'],
  colgroup: ['span'],
  time: ['datetime'],
};

function sanitizeProfileHTML(html) {
  if (!html) return '';
  let clean = sanitizeHtml(html, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: ALLOWED_ATTRS,
    allowedSchemes: ['http', 'https', 'mailto'],
    allowedSchemesByTag: { img: ['http', 'https', 'data'] },
    // No <script>, no on* handlers, no javascript: URLs — enforce hard.
    disallowedTagsMode: 'discard',
  });
  // Belt-and-suspenders: scrub inline style="" contents for CSS vectors.
  clean = clean.replace(/\bstyle\s*=\s*"([^"]*)"/gi, (m, body) =>
    `style="${sanitizeCSS(body).replace(/"/g, '&quot;')}"`
  );
  clean = clean.replace(/\bstyle\s*=\s*'([^']*)'/gi, (m, body) =>
    `style="${sanitizeCSS(body).replace(/"/g, '&quot;')}"`
  );
  return clean;
}

module.exports = { sanitizeProfileHTML, sanitizeCSS };
