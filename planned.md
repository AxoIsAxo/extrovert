# Extrovert — Planned Features

> Grounded in direct source analysis. File:line citations throughout.
> Status: **planning phase** — nothing here has been implemented yet.

---

## Structure

- **F1. Multi-Account (with account selection at OAuth)**
- **F2. Two-Factor Authentication (2FA)**
- **F3. Passkeys (WebAuthn)**

Each item has a `[PRIORITY]` tag: P0 (blocker / data-loss), P1 (incorrect), P2 (missing UX), P3 (nice-to-have).

Cross-cutting note: every feature below touches the shared session + OAuth flow, so the database
migrations (F1.2, F2.2, F3.2) and the login page rework (F1.3, F2.4, F3.3) should land together to
avoid shipping an intermediate login UX twice.

---

## F1. Multi-Account (with account selection at OAuth)

**Goal:** Let a user of one browser / install sign in to several Extrovert accounts and switch
between them; when an OAuth client asks for authorization, the user picks **which** account
authorizes the app, instead of the server blindly using the session's current account.

### F1.1 Session model: single `userId` → list of signed-in accounts  [P1]

**Where:** `src/routes/auth.js:70-96` (login), `src/routes/auth.js:98-100` (logout), `src/session-store.js` (session persistence).

Today `req.session.userId` is a single integer set on login and destroyed on logout.

**Change:**
- Add `req.session.accountIds` — the ordered list of accounts signed in on this device.
- Keep `req.session.userId` as "the active account" (compat shim: every existing
  `req.session.userId` read site keeps working unchanged).
- Login becomes "add to list + set active" (does not destroy the list). Logout becomes "remove
  from list" — destroy the whole session only when the last account is removed, so switching
  accounts does not invalidate other sessions/tokens.
- `req.session.regenerate()` on login (`auth.js:83`) must be reworked: regenerate the session but
  re-seed `accountIds` from the just-signed-in account instead of wiping state.

### F1.2 Persist account list across restarts (remembered devices)  [P1]

**Where:** `src/session-store.js` (express-session store), `src/db.js:304+` (ALTER TABLE migration pattern).

**Change:**
- New table `account_sessions` (`session_id`, `user_id`, `active INTEGER`, `created_at`) — one row
  per (session, account). This survives server restarts because the session store is DB-backed.
- On login/logout/switch, upsert/delete rows; `active` marks the current account.
- Follow the existing `try { db.exec(...) } catch {}` migration idiom (`db.js:304-323`) — this is
  additive-only, so existing installs upgrade in place.

### F1.3 Account switcher UI  [P2]

**Where:** `src/views/login.ejs`, header layout (in `src/views/`), `src/routes/auth.js`.

**Change:**
- Login page shows "signed in on this device" list + "add another account" (multi-user picker, same
  pattern as GitHub/Google account chooser).
- A switcher menu in the app header lists all `accountIds` accounts with display name + avatar, and
  an "Add account" entry that goes through the login page with a `?next=` that preserves the
  original destination.
- New endpoints: `GET /account/switch` (renders picker), `POST /account/switch` (sets active),
  `POST /account/remove` (removes one account from the list).

### F1.4 OAuth: account selection at authorization time  [P1] — the headline feature

**Where:** `src/routes/api-v1.js:200-250` (GET `/oauth/authorize`), `src/routes/api-v1.js:254+` (POST `/oauth/authorize`).

Today GET `/oauth/authorize` redirects to `/login?next=...` when `!req.session.userId`
(`api-v1.js:201-203`) and otherwise renders the consent page for the session's account.

**Change:**
- If multiple accounts are signed in, GET `/oauth/authorize` renders a **"choose account"** step
  first (or the consent page embeds the account picker): each signed-in account plus "sign in with
  a different account". The chosen `account_id` is carried through to the consent POST.
- POST `/oauth/authorize` takes `account_id` (defaulting to the active account) and issues the
  authorization code **bound to that account** — `authCode.user_id` is the selected account, and
  `/oauth/token` (`api-v1.js:305`) and `/oauth/userinfo` (`api-v1.js:463`) follow automatically
  because they already read `user_id` off the code/token.
- Security rule: the account selector must never let a client bypass consent — the picker only
  changes *which* account, the consent approval step stays mandatory. Guard the picker with the same
  CSRF check already used at `api-v1.js:258`.
- The OIDC `nonce` (stored on `oauth_codes`, `db.js:322`) must be bound to the selected account as
  well, so a code issued for account A can't be replayed against account B.

### F1.5 All other endpoints keep using the active account  [P2]

**Where:** every `req.session.userId` read across `src/routes/*`.

No behavior change: `userId` stays the active account everywhere (API, chat, admin). Switching
accounts atomically swaps `req.session.userId`. Audit that no route accidentally reads the *list*
where it meant the *active* account.

---

## F2. Two-Factor Authentication (2FA)

**Goal:** TOTP-based second factor on login (and optionally on sensitive actions), with recovery
codes so users are never locked out.

### F2.1 Dependencies  [P1]

**Where:** `package.json`.

No 2FA support exists today (only `bcryptjs`). Add:
- `otplib` (TOTP generation/verification) — or implement HOTP/TOTP directly (RFC 6238) with the
  existing `crypto` module to avoid a new dependency.
- Optional: `qrcode` for the enrollment QR.

### F2.2 Database: `two_factor` columns + `recovery_codes` table  [P1]

**Where:** `src/db.js:17` (users table), `src/db.js:304+` (migration idiom).

**Change** (additive, in the existing try/catch style):
- `users.totp_secret TEXT` — encrypted at rest (see F2.3), NULL = 2FA not enrolled.
- `users.totp_enabled INTEGER NOT NULL DEFAULT 0`.
- `users.totp_confirmed_at INTEGER` — set after a successful verification code proves enrollment.
- New table `recovery_codes (id, user_id, code_hash TEXT, used_at INTEGER, UNIQUE(user_id, code_hash))`
  — store **hashes** (bcrypt or sha256+pepper), never plaintext codes, so a DB leak doesn't leak
  working codes.
- New accessors in `db.js` next to `getUserByUsername` (`db.js:467`) / `getUserById` (`db.js:471`):
  `getRecoveryCodes`, `consumeRecoveryCode`, `setTOTPSecret`.

### F2.3 Secret encryption at rest  [P1]

**Where:** `src/db.js`, config in `.env.example`.

TOTP secrets are equivalent to passwords — store them encrypted with a server-side key from env
(`TOTP_ENCRYPTION_KEY`), consistent with how the app already treats other credential material.
Reject plaintext storage.

### F2.4 Login flow: second step  [P1]

**Where:** `src/routes/auth.js:70-96` (POST `/login`).

**Change:**
- After the password/bcrypt check (`auth.js:77`): if `user.totp_enabled`, **do not** set
  `req.session.userId` yet. Instead set a short-lived `req.session.pending2fa = { userId, next }`
  (with a TTL, e.g. 5 minutes) and render a "enter 6-digit code or recovery code" step.
- Verify with `otplib` against `user.totp_secret`; on success run the existing session-regenerate
  logic (`auth.js:83-95`) and clear the pending flag.
- Brute-force guard: rate-limit the 2FA step (per `pending2fa` + IP) using the existing
  `express-rate-limit` dependency, and lock out after N failures.
- Failed 2FA must not reveal *whether* the account has 2FA — return the same generic error.
- Add a "remember this device for N days" trusted-device cookie (signed, stores a device token
  table row) to avoid re-prompting 2FA on every login.

### F2.5 2FA also enforced for OAuth device authorizations  [P1]

**Where:** `src/routes/api-v1.js:200` (GET `/oauth/authorize`).

Because OAuth tokens grant API access, an OAuth authorization from a device that isn't
2FA-trusted must complete the same second-factor step before consent (`api-v1.js:240`) is shown.
This reuses the F2.4 pending-2FA machinery; the `?next=` redirect at `api-v1.js:202` already
round-trips the original OAuth request.

### F2.6 Enrollment + management UI  [P2]

**Where:** `src/routes/settings.js`, views in `src/views/`, `src/routes/auth.js`.

**Change:**
- Settings → Security: "Set up 2FA" — generate secret server-side, show QR / manual entry,
  require one valid code to confirm (sets `totp_confirmed_at`), then reveal one-time recovery codes.
- "Disable 2FA" requires the current TOTP code or a recovery code (never just the password alone).
- Regenerate recovery codes; list remaining unused codes with `used_at` timestamps.
- Warn during enrollment that recovery codes are shown once.

### F2.7 Session bootstrap of new accounts  [P2]

First login after enrollment must not leave the old (pre-2FA) session alive — enforce the same
session-regenerate step used at `auth.js:83` whenever 2FA state changes, so an attacker holding a
pre-enrollment session cookie is cut off.

---

## F3. Passkeys (WebAuthn)

**Goal:** Passwordless sign-in and 2FA-class authentication using platform/roaming passkeys
(WebAuthn), including a first-passkey enrollment bootstrap so new accounts can register a passkey
at signup.

### F3.1 Dependencies  [P1]

**Where:** `package.json`.

Add `@simplewebauthn/server` (or implement the WebAuthn ceremony verification directly with
`crypto`): handles attestation/assertion parsing, challenge verification, origin/RP-ID checks,
counter replay protection.

### F3.2 Database: credentials table  [P1]

**Where:** `src/db.js` (new table next to existing schema), migration idiom `src/db.js:304+`.

**Change:**
- New table `passkeys`:
  - `id INTEGER PRIMARY KEY`, `user_id INTEGER REFERENCES users(id)`
  - `credential_id TEXT UNIQUE NOT NULL` — base64url credential ID from the authenticator
  - `public_key TEXT NOT NULL` — CBOR-encoded COSE public key (stored as-is from the authenticator)
  - `counter INTEGER NOT NULL DEFAULT 0` — signature counter; reject replay / cloned-device use if
    the new counter is lower
  - `device_name TEXT`, `transports TEXT`, `created_at INTEGER`, `last_used_at INTEGER`
- Index on `user_id`.
- Foreign key + `ON DELETE CASCADE` so deleting an account removes its passkeys.

### F3.3 Authentication ceremony (login)  [P1]

**Where:** `src/routes/auth.js` (login flow), `src/routes/api-auth.js` or a new `src/routes/webauthn.js`.

**Change:**
- `POST /auth/webauthn/begin` — given a username (or discoverable-credential "passkey-first"
  mode), return `{ challenge, allowCredentials, rpId, timeout, userVerification }`. Challenge is a
  random 32-byte value stored in a short-lived session field (never in the DB) with a TTL.
- `POST /auth/webauthn/complete` — verify the assertion: signature over `clientDataJSON ||
  authData` against the stored public key, check `rpIdHash`, `challenge` equality, origin, and the
  counter. On success, run the F1-style add-account logic and `req.session.regenerate()`
  (`auth.js:83`).
- Passkeys and the existing password login (`auth.js:70`) coexist on the same login page.

### F3.4 Registration ceremony (enrollment)  [P1]

**Where:** `src/routes/auth.js` (register), `src/routes/settings.js` (Security → Passkeys).

**Change:**
- `POST /auth/webauthn/register/begin` (requires an authenticated session) → options with
  `rp.id` derived from the request host (same-origin rule), `user.id` = stable random
  base64url per user, `excludeCredentials` = existing passkey IDs to prevent duplicates.
- `POST /auth/webauthn/register/complete` — verify attestation, store the credential row (F3.2),
  enforce at most N passkeys per user (configurable, default e.g. 10).
- Optionally use a passkey as a **second factor** (F2.5-style pending-2FA step) in addition to
  passwordless-first-factor mode — this is the "passkeys can be 2FA-class" posture.

### F3.5 First-passkey bootstrap at signup  [P3]

**Where:** `src/routes/auth.js:17-63` (POST `/register`).

On account creation, offer "create a passkey now" so the user can enroll during onboarding rather
than hunting through settings later. Register endpoint must enforce: registration only allowed for
the just-created account (bound to the new session), never cross-account.

### F3.6 Recovery / UX guardrails  [P1]

**Where:** `src/routes/settings.js`, login view.

- A user who deletes all passkeys falls back to password + 2FA (F2) — never an empty credential
  set with no recovery path.
- Show per-device list (name, last used) with remove buttons; removing the *last* passkey for a
  user who has no password/2FA fallback is blocked with an explanatory error.
- 2FA + passkey interaction: document and enforce one of two models (choose at implementation:
  passkey *replaces* TOTP as the second factor, or passkey is passwordless-first-factor and TOTP
  still applies). Do not implement both semantics ambiguously.

### F3.7 Attestation policy  [P3]

**Where:** new `src/routes/webauthn.js`.

Decide and configure: `none` attestation (privacy-preserving, recommended default) vs. platform
attestation verification for enterprise trust. This is a config flag, not a code fork.

---

## Security review checklist (applies to all three features)

- **Side channels:** 2FA/passkey failures return identical generic errors; no user enumeration via
  "this account has 2FA" messages (F2.4).
- **Credential hygiene:** TOTP secrets encrypted at rest (F2.3); recovery codes hashed (F2.2);
  passkey private keys never leave the authenticator (by construction).
- **Replay:** passkey counters (F3.2), challenge TTLs, code-bound-to-account (F1.4), OAuth code
  binding (F1.4, `api-v1.js:322`).
- **CSRF:** all new session-cookie endpoints follow the existing CSRF-token enforcement shown at
  `api-v1.js:258` and `auth.js` POST handlers.
- **Rate limiting:** reuse the existing `express-rate-limit` dependency for 2FA attempts (F2.4)
  and passkey ceremonies.
- **Session fixation:** every auth-state change re-runs `req.session.regenerate()` (F1.1, F2.4,
  F3.3) — never mutate a session in place across an auth boundary.
- **Lockout safety:** recovery codes (F2.2) and password fallback (F3.6) guarantee a user can
  always get back in; admin accounts get the same recovery paths (no special-case bypass).
