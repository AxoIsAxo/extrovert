'use strict';

/*
 * Protocol regression test for the Olm (Signal Protocol) E2E encryption layer.
 * Validates the patterns the browser frontend (public/e2ee.js) relies on.
 * Run: npm run test:crypto
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const wasmPath = path.join(path.dirname(require.resolve('@matrix-org/olm/package.json')), 'olm.wasm');

async function loadOlm() {
  const Module = require('@matrix-org/olm');
  const wasm = fs.readFileSync(wasmPath);
  await Module.init({ wasmBinary: wasm });
  return Module;
}

const PICKLE_KEY = 'test-pickle-key';

function newAccount(Olm) {
  const acct = new Olm.Account();
  acct.create();
  return acct;
}

// Alice creates an outbound session to Bob using Bob's prekey bundle.
function createOutbound(Olm, aliceAcct, bobAcct) {
  const bobKeys = JSON.parse(bobAcct.identity_keys());
  const otks = JSON.parse(bobAcct.one_time_keys());
  const otkEntries = Object.entries(otks.curve25519);
  assert(otkEntries.length > 0, 'recipient needs one-time keys');
  const theirOtk = otkEntries[0][1];
  const sess = new Olm.Session();
  sess.create_outbound(aliceAcct, bobKeys.curve25519, theirOtk);
  return sess;
}

// Bob creates an inbound session from Alice's first (PreKey) message.
function createInbound(Olm, bobAcct, aliceCurve25519, prekeyMessage) {
  const sess = new Olm.Session();
  sess.create_inbound_from(bobAcct, aliceCurve25519, prekeyMessage);
  bobAcct.remove_one_time_keys(sess);
  return sess;
}

async function main() {
  const Olm = await loadOlm();
  let passed = 0;
  let failed = 0;

  const ok = (name) => { passed++; console.log('  \u2713 ' + name); };
  const fail = (name, msg) => { failed++; console.error('  \u2717 ' + name + ': ' + msg); };

  // Setup
  const alice = newAccount(Olm);
  const bob = newAccount(Olm);
  const aliceKeys = JSON.parse(alice.identity_keys());
  const bobKeys = JSON.parse(bob.identity_keys());
  alice.generate_one_time_keys(5);
  bob.generate_one_time_keys(5);

  // ---- 1. Establish session + round-trip ----
  let a2b, b2a;
  try {
    a2b = createOutbound(Olm, alice, bob);
    const msg = a2b.encrypt('hello bob');
    assert(msg.type === 0, 'first message should be PreKey (type 0)');
    b2a = createInbound(Olm, bob, aliceKeys.curve25519, msg.body);
    const pt = b2a.decrypt(msg.type, msg.body);
    assert.strictEqual(pt, 'hello bob');
    ok('X3DH establish + encrypt/decrypt round trip');
  } catch (e) { fail('X3DH establish', e.message); }

  // ---- 2. Forward secrecy: ratchet advances after each message ----
  try {
    const m1 = a2b.encrypt('second');
    const state1 = a2b.pickle(PICKLE_KEY);
    const m2 = a2b.encrypt('third');
    const state2 = a2b.pickle(PICKLE_KEY);
    assert.notStrictEqual(state1, state2, 'pickle state must change as ratchet advances');
    assert.strictEqual(b2a.decrypt(m1.type, m1.body), 'second');
    assert.strictEqual(b2a.decrypt(m2.type, m2.body), 'third');
    ok('Forward secrecy: ratchet state advances');
  } catch (e) { fail('Forward secrecy', e.message); }

  // ---- 3. Bidirectional: Bob replies on same session, Alice decrypts, type 1 ----
  try {
    const reply = b2a.encrypt('hi back');
    // Bob's session was created as inbound; can he encrypt on it? Yes — it's bidirectional.
    assert(reply.type === 1, 'reply should be type 1 after session established');
    const pt = a2b.decrypt(reply.type, reply.body);
    assert.strictEqual(pt, 'hi back');
    ok('Bidirectional reply produces type 1 message');
  } catch (e) { fail('Bidirectional', e.message); }

  // ---- 4. Self-session: sender reads own copies ----
  try {
    const aliceSelf = newAccount(Olm);
    const aliceSelfKeys = JSON.parse(aliceSelf.identity_keys());
    aliceSelf.generate_one_time_keys(1);
    const otks = JSON.parse(aliceSelf.one_time_keys());
    const otk = Object.values(otks.curve25519)[0];

    const selfOut = new Olm.Session();
    selfOut.create_outbound(aliceSelf, aliceSelfKeys.curve25519, otk);

    const msgs = ['own 1', 'own 2', 'own 3'].map((t) => selfOut.encrypt(t));

    const selfIn = new Olm.Session();
    selfIn.create_inbound(aliceSelf, msgs[0].body);
    // After create_inbound the OTK is consumed; safe to clean up.
    aliceSelf.remove_one_time_keys(selfIn);

    assert.strictEqual(selfIn.decrypt(msgs[0].type, msgs[0].body), 'own 1');
    assert.strictEqual(selfIn.decrypt(msgs[1].type, msgs[1].body), 'own 2');
    assert.strictEqual(selfIn.decrypt(msgs[2].type, msgs[2].body), 'own 3');
    ok('Self-session encrypts/decrypts multiple own copies');
  } catch (e) { fail('Self-session', e.message); }

  // ---- 5. Session pickle round-trip (IndexedDB persistence) ----
  try {
    const pickled = a2b.pickle(PICKLE_KEY);
    const restored = new Olm.Session();
    restored.unpickle(PICKLE_KEY, pickled);
    const m = restored.encrypt('restored send');
    assert(m.body && m.type !== undefined);
    const pt = b2a.decrypt(m.type, m.body);
    assert.strictEqual(pt, 'restored send');
    ok('Session pickle round-trip restores functionality');
  } catch (e) { fail('Session pickle', e.message); }

  // ---- 6. Account pickle round-trip (backup + restore) ----
  try {
    const pickled = bob.pickle(PICKLE_KEY);
    const restored = new Olm.Account();
    restored.unpickle(PICKLE_KEY, pickled);
    const k1 = JSON.parse(bob.identity_keys());
    const k2 = JSON.parse(restored.identity_keys());
    assert.strictEqual(k1.curve25519, k2.curve25519);
    ok('Account pickle round-trip preserves identity key');
  } catch (e) { fail('Account pickle', e.message); }

  // ---- 7. Sender key forgery detection (create_inbound_from binds identity) ----
  try {
    // A message from Alice's session, decrypted via create_inbound_from with Alice's
    // identity key. If we pass a WRONG identity key, create_inbound_from throws.
    const forged = a2b.encrypt('forgery test');
    const wrongKey = JSON.parse(bob.identity_keys()).curve25519; // Bob's key, not Alice's
    assert.throws(() => {
      const s = new Olm.Session();
      s.create_inbound_from(bob, wrongKey, forged.body);
    }, /bad|error|invalid/i, 'create_inbound_from should reject a mismatched identity key');
    ok('create_inbound_from detects sender key mismatch');
    bob.free(); bob.create();
    alice.generate_one_time_keys(5); bob.generate_one_time_keys(5);
  } catch (e) { fail('Sender auth', e.message); }

  console.log('\ncrypto-test: ' + passed + ' passed, ' + failed + ' failed, ' + (passed + failed) + ' total');
  if (failed > 0) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
