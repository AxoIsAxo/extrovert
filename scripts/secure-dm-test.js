// Additional Security mode for DMs — end-to-end test.
// Covers: mutual opt-in toggle (web + API), secure-flagging on send, server-side
// deletion only after BOTH sides have acknowledged receipt, no deletion when the
// mode is not active, and authz (third parties cannot ack/delete).
// Run: node scripts/secure-dm-test.js
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const bcrypt = require('bcryptjs');

const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'extrovert-securedm-'));
process.env.EXTV_DB_PATH = path.join(TEST_DIR, 'extrovert.db');
process.env.EXTV_SESSION_DB_PATH = path.join(TEST_DIR, 'sessions.db');
process.env.SESSION_SECRET = 'secure-dm-test-secret';
process.env.SECRET = 'secure-dm-test-secret';
process.env.PORT = String(33000 + Math.floor(Math.random() * 1000));

const app = require('../src/server');
const db = require('../src/db');

let failures = 0;
function ok(cond, msg) { console.log((cond ? '  [OK]   ' : '  [FAIL] ') + msg); if (!cond) failures++; }

async function main() {
  const base = 'http://localhost:' + process.env.PORT;

  // alice + bob (mutual followers), carol (outsider).
  const aliceId = db.createUser({ username: 'alice', passwordHash: bcrypt.hashSync('pw1', 10), displayName: 'Alice' });
  const bobId = db.createUser({ username: 'bob', passwordHash: bcrypt.hashSync('pw2', 10), displayName: 'Bob' });
  db.createUser({ username: 'carol', passwordHash: bcrypt.hashSync('pw3', 10), displayName: 'Carol' });
  db.follow(aliceId, bobId);
  db.follow(bobId, aliceId);
  db.follow(aliceId, db.getUserByUsername('carol').id);
  db.follow(db.getUserByUsername('carol').id, aliceId);

  // OAuth tokens for the API.
  function makeToken(userId, username, scopes) {
    db.createOAuthApp({ name: 't-' + username, description: '', website: '', redirectUris: 'https://x/cb', clientId: 'c-' + username, clientSecret: 's', scopes: 'read write follow read:direct write:direct', ownerId: userId });
    const tok = crypto.randomBytes(32).toString('hex');
    db.createOAuthToken(tok, null, db.getOAuthAppByClientId('c-' + username).id, userId, scopes, Date.now() + 86400000);
    return tok;
  }
  const aliceToken = makeToken(aliceId, 'alice', 'read:direct write:direct');
  const bobToken = makeToken(bobId, 'bob', 'read:direct write:direct');
  const carolToken = makeToken(db.getUserByUsername('carol').id, 'carol', 'read:direct write:direct');

  // Web sessions (one per user).
  async function makeWebSession(username, password) {
    const jar = {};
    async function withCookie(url, opts = {}) {
      const headers = { ...(opts.headers || {}) };
      if (jar.cookie) headers['Cookie'] = jar.cookie;
      const r = await fetch(base + url, { ...opts, headers, redirect: 'manual' });
      const sc = r.headers.get('set-cookie');
      if (sc) {
        const sid = sc.split(';')[0];
        jar.cookie = sid; // replace: login regenerates the session, old cookie is stale
      }
      return r;
    }
    const loginPage = await withCookie('/login');
    const csrfMatch = (await loginPage.text()).match(/name="_csrf" value="([^"]+)"/);
    const csrf = csrfMatch ? csrfMatch[1] : '';
    await withCookie('/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `username=${username}&password=${password}&_csrf=${encodeURIComponent(csrf)}`,
    });
    // Login regenerates the session, so re-read the fresh CSRF token from a page.
    const postLogin = await withCookie('/chats');
    const fresh = (await postLogin.text()).match(/name="csrf-token" content="([^"]+)"/);
    const sessionCsrf = fresh ? fresh[1] : csrf;
    return {
      csrf: sessionCsrf,
      get: (url) => withCookie(url).then(r => r.text()),
      jsonPost: (url, body) => withCookie(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': sessionCsrf },
        body: JSON.stringify(body),
      }).then(r => r.json()),
      formPost: (url, fields) => withCookie(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-CSRF-Token': sessionCsrf, 'X-Requested-With': 'XMLHttpRequest' },
        body: new URLSearchParams({ ...fields, _csrf: sessionCsrf }).toString(),
      }).then(r => r.json()),
    };
  }
  const bob = await makeWebSession('bob', 'pw2');
  const alice = await makeWebSession('alice', 'pw1');

  async function apiJson(url, token, body) {
    const r = await fetch(base + url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify(body || {}),
    });
    return { status: r.status, data: await r.json() };
  }

  function msgCount() { return db.db.prepare(`SELECT COUNT(*) AS n FROM messages`).get().n; }
  function getMsg(id) { return db.db.prepare(`SELECT * FROM messages WHERE id = ?`).get(id); }

  console.log('\nTEST 1: mutual opt-in — mode is NOT active until both users enable it (web)');
  let d = await bob.jsonPost('/chats/alice/security', { enabled: true });
  ok(d.ok && d.security.mine === true && d.security.theirs === false && d.security.active === false,
    'bob enables only on his side: mine=true, theirs=false, active=false');
  ok((await bob.get('/chats/alice')).includes('waiting for Alice'), 'chat page shows "waiting for Alice" state');

  console.log('\nTEST 2: mutual opt-in via API (alice side)');
  let r = await apiJson('/api/v1/conversations/bob/security', aliceToken, { enabled: true });
  ok(r.status === 200 && r.data.data.active === true, 'alice enables too -> active=true via API');

  console.log('\nTEST 3: secure send + deletion only after BOTH sides ack (web)');
  const before = msgCount();
  // Sticker-path body skips the E2EE validation on the server.
  const sendRes = await bob.formPost('/chats/alice/send', { body: '/uploads/stickers/x.png' });
  ok(!!sendRes.message, 'bob sends a message');
  const mid = Number(sendRes.message.id);
  ok(sendRes.message.secure === 1, 'message is flagged secure=1 in the response');
  ok(msgCount() === before + 1, 'message stored on server');

  // Sender (bob) acks its own receipt.
  d = await bob.jsonPost('/chats/alice/received', { message_ids: [mid] });
  ok(d.ok && d.deleted === 0, 'sender ack alone does NOT delete (recipient has not received)');
  ok(getMsg(mid) !== undefined, 'message still present after sender ack');

  // Recipient (alice) fetches history — message must still be served.
  let html = await alice.get('/chats/bob');
  ok(html.includes('data-msg-id="' + mid + '"'), 'recipient history still serves the pending secure message');
  ok(html.includes('data-secure="1"'), 'rendered message carries data-secure="1"');

  // Recipient acks receipt -> both received -> server deletes.
  d = await alice.jsonPost('/chats/bob/received', { message_ids: [mid] });
  ok(d.ok && d.deleted === 1, 'recipient ack triggers deletion (deleted=1)');
  ok(getMsg(mid) === undefined, 'message row removed from the server');
  html = await alice.get('/chats/bob');
  ok(!html.includes('data-msg-id="' + mid + '"'), 'history no longer serves the deleted message');

  console.log('\nTEST 4: without the mode, acks never delete (new messages only)');
  // Turn bob's side off -> mode inactive (alice still has it on).
  d = await bob.jsonPost('/chats/alice/security', { enabled: false });
  ok(d.ok && d.security.active === false, 'mode inactive once either side disables');
  const sendRes2 = await bob.formPost('/chats/alice/send', { body: '/uploads/stickers/y.png' });
  const mid2 = Number(sendRes2.message.id);
  ok(sendRes2.message.secure === 0, 'message sent while inactive is secure=0');
  await bob.jsonPost('/chats/alice/received', { message_ids: [mid2] });
  await alice.jsonPost('/chats/bob/received', { message_ids: [mid2] });
  ok(getMsg(mid2) !== undefined, 'non-secure message survives both acks');

  console.log('\nTEST 5: third parties cannot ack or delete (authz)');
  const before5 = msgCount();
  r = await apiJson('/api/v1/conversations/bob/received', carolToken, { message_ids: [mid2] });
  ok(r.status === 403, 'carol (not a participant) gets 403 on /received');
  r = await apiJson('/api/v1/conversations/bob/security', carolToken, { enabled: true });
  ok(r.status === 403, 'carol (not mutual with bob) gets 403 on /security');
  ok(msgCount() === before5, 'no rows touched by third-party acks');

  console.log('\nTEST 6: API history shows secure flag + conversation security_active');
  const hist = await fetch(base + '/api/v1/conversations/bob', { headers: { Authorization: 'Bearer ' + aliceToken } }).then(r => r.json());
  ok(Array.isArray(hist.data) && hist.data.length >= 1, 'alice sees API history');
  ok(hist.data.some(m => Number(m.id) === mid2 && m.secure === false), 'API history includes secure=false for the non-secure message');
  const convs = await fetch(base + '/api/v1/conversations', { headers: { Authorization: 'Bearer ' + aliceToken } }).then(r => r.json());
  const bobConv = (convs.data || []).find(c => c.username === 'bob');
  ok(!!bobConv && bobConv.security_active === false, 'API conversation list reports security_active=false when off');
  // Re-enable both sides and confirm security_active flips to true.
  await apiJson('/api/v1/conversations/bob/security', aliceToken, { enabled: true });
  await bob.jsonPost('/chats/alice/security', { enabled: true });
  const convs2 = await fetch(base + '/api/v1/conversations', { headers: { Authorization: 'Bearer ' + aliceToken } }).then(r => r.json());
  const bobConv2 = (convs2.data || []).find(c => c.username === 'bob');
  ok(!!bobConv2 && bobConv2.security_active === true, 'API conversation list reports security_active=true when both enabled');

  // Sanity: the earlier secure message is still gone and the sticker remains readable in bob's API history.
  const hist2 = await fetch(base + '/api/v1/conversations/alice', { headers: { Authorization: 'Bearer ' + bobToken } }).then(r => r.json());
  ok(Array.isArray(hist2.data) && !hist2.data.some(m => Number(m.id) === mid), 'deleted secure message absent from sender API history too');

  console.log('\nTEST 7: ack deletion is scoped to the conversation pair (db-level)');
  // A message with both receipt flags set (crash-window state: flags written but
  // row not yet swept) must only be deletable by the conversation pair's ack.
  const carolMsg3 = db.sendMessage(aliceId, db.getUserByUsername('carol').id, 'ct3', null, null, 'olm', 'sc', true);
  db.db.prepare(`UPDATE messages SET received_by_sender = ?, received_by_recipient = ? WHERE id = ?`).run(Date.now(), Date.now(), carolMsg3);
  ok(getMsg(carolMsg3) !== undefined, 'message with both flags set is still present (crash window)');
  const r7 = db.ackMessagesReceived(aliceId, bobId, [carolMsg3]); // ack in the WRONG pair
  ok(r7.deleted === 0 && getMsg(carolMsg3) !== undefined, 'alice<->bob ack cannot delete an alice<->carol message');
  const r7b = db.ackMessagesReceived(aliceId, db.getUserByUsername('carol').id, [carolMsg3]); // ack in the owning pair
  ok(r7b.deleted === 1 && getMsg(carolMsg3) === undefined, 'the owning pair ack sweeps the flagged row');

  console.log(failures ? '\nSOME TESTS FAILED' : '\nALL TESTS PASSED');
  process.exit(failures ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(1); });
