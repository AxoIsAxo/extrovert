#!/usr/bin/env node
// Fetches self-hosted woff2 font files for Extrovert's display + body faces.
// Run once locally; output (public/fonts/*.woff2) is committed to the repo
// so the Docker image contains the fonts — no runtime network calls, no
// prod-host setup, just re-deploy the image.
//
// Choice rationale:
//   - Display: Fraunces (soft-serif, characterful, warm — "hand of designer")
//   - Body/UI: Hanken Grotesk (clean, friendly, variable — one file covers all
//     weights; Spline Sans was tried first but Google's API serves the same
//     static file for every requested weight, so distinct weights don't render)
// Both are OFL-licensed.

const https = require('https');
const fs = require('fs');
const path = require('path');

const UA_WOFF2 = 'Mozilla/5.0 (Windows NT 6.1; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

const families = [
  { cssName: 'Fraunces', dir: 'fraunces', weights: ['9pt','9pt','9pt'] }, // handled below
];

// Google Fonts CSS API endpoint — variable fonts.
function fetch(url, headers = {}) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(fetch(res.headers.location, headers));
      }
      if (res.statusCode !== 200) return reject(new Error(`${res.statusCode} for ${url}`));
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });
}

// Fraunces variable: opsz 9..144, wght 100..900, plus italic.
// Spline Sans is NOT variable on Google Fonts (static weights only).
const SOURCES = [
  {
    family: 'Fraunces',
    css: 'https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,300..900&display=swap',
  },
  {
    family: 'Hanken Grotesk',
    css: 'https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@300..800&display=swap',
  },
];

async function main() {
  const outDir = path.join(__dirname, '..', 'public', 'fonts');
  fs.mkdirSync(outDir, { recursive: true });
  const manifest = [];
  for (const { family, css } of SOURCES) {
    const cssText = (await fetch(css, { 'User-Agent': UA_WOFF2 })).toString('utf8');
    // Each @font-face block has a src url(...) for a .woff2
    const urlRe = /url\((https:\/\/fonts\.gstatic\.com\/[^)]+\.woff2)\)/g;
    const faceRe = /@font-face\s*{[^}]*}/g;
    const faces = cssText.match(faceRe) || [];
    const urls = [...cssText.matchAll(urlRe)].map((m) => m[1]);
    // De-duplicate by url (variable fonts often expose one url per unicode-range)
    const seen = new Set();
    let i = 0;
    for (const url of urls) {
      if (seen.has(url)) continue;
      seen.add(url);
      const ext = '.woff2';
      const slug = family.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const name = `${slug}-${i}${ext}`;
      const buf = await fetch(url, { 'User-Agent': UA_WOFF2 });
      fs.writeFileSync(path.join(outDir, name), buf);
      console.log(`  wrote ${name} (${buf.length} bytes)`);
      i++;
    }
    // Also save the CSS so the @font-face declarations are available to embed.
    const cssName = family.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    // Rewrite urls in the css to point to local files.
    let localCss = cssText;
    let j = 0;
    const seen2 = new Set();
    localCss = localCss.replace(urlRe, (full, url) => {
      if (seen2.has(url)) return full;
      seen2.add(url);
      const slug = family.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const name = `${slug}-${j}.woff2`;
      j++;
      return `url("/static/fonts/${name}")`;
    });
    fs.writeFileSync(path.join(outDir, `${cssName}.css`), localCss);
    console.log(`  wrote ${cssName}.css`);
    manifest.push(family);
  }
  console.log('Done:', manifest.join(', '));
}

main().catch((e) => { console.error(e); process.exit(1); });
