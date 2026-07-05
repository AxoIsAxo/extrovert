# Security Audit — Fixes Applied

| # | Vulnerability | Fix |
|---|--------------|-----|
| 1 | **No CSRF protection** | Per-session CSRF token validated on all POST/PUT/PATCH/DELETE requests; token embedded in every form as `_csrf` |
| 2 | **Open redirect** via Referer | `back()` functions now reject `//evil.com` protocol-relative URLs; login `next` uses `safeRedirect()` |
| 3 | **File upload MIME spoofing** | Whitelist-based extension validation server-side (`.jpg`, `.png`, `.mp4`, etc.) — MIME type alone is no longer trusted |
| 4 | **`data:` URI on `<img>` → SVG XSS** | Removed `data` from `allowedSchemesByTag.img` in sanitize-html config |
| 5 | **No rate limiting** | `express-rate-limit` added: 10 req/min on auth, 60 req/min on all POST endpoints |
| 6 | **No security headers** | `helmet` added with CSP (no inline scripts), `X-Frame-Options`, `X-Content-Type-Options`, etc. |
| 7 | **Weak session secret** | `SESSION_SECRET` env var is now **required** — server exits at startup if unset; `.env.example` added |
| 8 | **Missing `secure`/`sameSite` cookie flags** | `sameSite: 'lax'`, `secure: true` in production |
| 9 | **CSS injection (data exfiltration)** | `sanitizeCSS()` now strips all `url(http://...)` and `url(https://...)` in addition to previous filters |
| 10 | **70MB body parser limit** | Reduced to `1mb` for both urlencoded and JSON parsers |
| 11 | **Username enumeration** | Registration error changed to generic `"Username unavailable"` instead of `"That username is taken"` |
| 12 | **No password max length** | Added 128-char max on registration and login |
| 13 | **Upload MIME sniffing** | `X-Content-Type-Options: nosniff` set on `/uploads` static file serving |
| 14 | **E2EE key upload without CSRF** | `e2ee.js` now reads CSRF token from `<meta>` tag and sends it as `X-CSRF-Token` header |
