'use strict';
// Regression test: recipient can decrypt messages from MULTIPLE sender chains,
// and their replies still work — the "unable to decrypt" bug.
//
// Browser behavior locked in (public/e2ee.js decryptOlm incoming path): every
// message this olm build emits is a PreKey message (type 0), and each PreKey is
// self-contained — the recipient derives an inbound session from it rather than
// feeding it into a stale baseline. Feeding a PreKey from a SECOND sender
// identity/chain into the OLD baseline fails with BAD_MESSAGE_MAC (the bug).
// Run: npm run test:multidevice

const fs = require('fs');
const path = require('path');

const wasmPath = path.join(path.dirname(require.resolve('@matrix-org/olm/package.json')), 'olm.wasm');

let failures = 0;
function ok(cond, msg) { console.log((cond ? '  [OK]   ' : '  [FAIL] ') + msg); if (!cond) failures++; }

async function main() {
  const Module = require('@matrix-org/olm');
  await Module.init({ wasmBinary: fs.readFileSync(wasmPath) });

  const newAccount = () => { const a = new Module.Account(); a.create(); a.generate_one_time_keys(10); return a; };
  const senderA = newAccount(); // sender device A
  const senderB = newAccount(); // sender device B (separate identity)
  const recipient = newAccount();
  const recipientKeys = JSON.parse(recipient.identity_keys());
  const otkOf = (acct) => Object.entries(JSON.parse(acct.one_time_keys()).curve25519)[0][1];

  // Simulate the browser's decryptOlm incoming path: derive a fresh inbound
  // session from every PreKey message (the fix); non-PreKey would use baseline.
  let baseline = null;
  function decryptIncoming(msg) {
    if (msg.type === 0) {
      const ns = new Module.Session();
      ns.create_inbound(recipient, msg.body);
      baseline = ns;
      return ns.decrypt(msg.type, msg.body);
    }
    if (!baseline) throw new Error('No session for sender and message is not a PreKey.');
    return baseline.decrypt(msg.type, msg.body);
  }

  console.log('\nTEST 1: single device — first and follow-up messages decrypt');
  const outA = new Module.Session();
  outA.create_outbound(senderA, recipientKeys.curve25519, otkOf(recipient));
  const m1 = outA.encrypt('hi from A');
  const m2 = outA.encrypt('second from A');
  const m3 = outA.encrypt('third from A');
  ok(m1.type === 0, 'messages are PreKey (type 0) — self-contained in this olm build');
  ok(decryptIncoming(m1) === 'hi from A', 'recipient derives inbound session from m1 and decrypts');
  ok(decryptIncoming(m2) === 'second from A', 'm2 (new PreKey from same chain) decrypts');
  ok(decryptIncoming(m3) === 'third from A', 'm3 decrypts');

  console.log('\nTEST 2: recipient replies still reach the sender');
  const reply = baseline.encrypt('reply to A');
  let senderSide = null;
  try { senderSide = outA.decrypt(reply.type, reply.body); } catch (e) { senderSide = 'ERR:' + (e.message || e); }
  ok(senderSide === 'reply to A', 'sender\'s outbound session decrypts the recipient\'s reply');

  console.log('\nTEST 3: second sender device — new chain must NOT fail');
  // Old (buggy) behavior: feeding B's PreKey into A's baseline -> BAD_MESSAGE_MAC.
  const staleBaseline = new Module.Session();
  staleBaseline.create_inbound(recipient, m1.body);
  const outB = new Module.Session();
  outB.create_outbound(senderB, recipientKeys.curve25519, otkOf(recipient));
  const mB1 = outB.encrypt('hi from B');
  const mB2 = outB.encrypt('second from B');
  let staleFailed = false;
  try { staleBaseline.decrypt(mB1.type, mB1.body); } catch (e) { staleFailed = /MAC/.test(e.message || e); }
  ok(staleFailed, 'old behavior reproduces the bug: A-baseline rejects B\'s PreKey (BAD_MESSAGE_MAC)');
  // Fixed behavior: derive a new inbound session from B's PreKey.
  ok(decryptIncoming(mB1) === 'hi from B', 'recipient derives a new inbound session from B\'s PreKey and decrypts');
  ok(decryptIncoming(mB2) === 'second from B', 'B\'s follow-up decrypts through the (new) session');

  console.log('\nTEST 4: full history replay in order re-derives each chain correctly');
  baseline = null;
  const replay = [m1, m2, m3, mB1, mB2].map((m) => decryptIncoming(m));
  ok(JSON.stringify(replay) === JSON.stringify(['hi from A', 'second from A', 'third from A', 'hi from B', 'second from B']),
    'history replay (A chain then B chain) decrypts in order');

  console.log(failures ? '\nSOME TESTS FAILED' : '\nALL TESTS PASSED');
  process.exitCode = failures ? 1 : 0;
}

main().catch(err => { console.error(err); process.exit(1); });
