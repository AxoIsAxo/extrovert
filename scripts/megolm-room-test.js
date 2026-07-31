// Megolm room encryption round-trip test.
// Simulates: Alice creates a room OutboundGroupSession, shares the session key to
// Bob via a 1:1 Olm session, Bob imports it as an InboundGroupSession, then both
// Alice (sender) and Bob (recipient) can decrypt messages — including a rotation
// scenario where a new member joins and history must NOT be readable.
// Run: node scripts/megolm-room-test.js
const fs = require('fs');
const Olm = require('@matrix-org/olm');

const WASM = fs.readFileSync('/Users/lea/extrovert/node_modules/@matrix-org/olm/olm.wasm');

function b64(buf) { return Buffer.from(buf).toString('base64'); }

let failures = 0;
function ok(cond, msg) { console.log((cond ? '  [OK]   ' : '  [FAIL] ') + msg); if (!cond) failures++; }

function identityKeys(account) {
  const k = JSON.parse(account.identity_keys());
  return { curve25519: k.curve25519, ed25519: k.ed25519 };
}
function oneTimeKeys(account) {
  const k = JSON.parse(account.one_time_keys());
  return Object.keys(k.curve25519).map(id => ({ id, key: k.curve25519[id] }));
}

async function main() {
  await Olm.init({ wasmBinary: WASM });

  // Two full accounts: Alice and Bob.
  const alice = new Olm.Account(); alice.create();
  const bob = new Olm.Account(); bob.create();
  alice.generate_one_time_keys(5); bob.generate_one_time_keys(5);
  alice.generate_fallback_key(); bob.generate_fallback_key();
  const aliceId = identityKeys(alice), bobId = identityKeys(bob);
  const aliceOTK = oneTimeKeys(alice)[0], bobOTK = oneTimeKeys(bob)[0];

  // --- 1:1 session Alice -> Bob (X3DH), for wrapping the group key ---
  const a2b = new Olm.Session();
  a2b.create_outbound(alice, bobId.curve25519, bobOTK.key);

  // --- Alice's Megolm OutboundGroupSession for the room ---
  const outbound = new Olm.OutboundGroupSession();
  outbound.create();
  const roomSessionId = 'room-42';
  const megolmKey = outbound.session_key();

  // Alice wraps the Megolm key in her 1:1 session to Bob.
  const wrapped = a2b.encrypt(megolmKey);
  ok(wrapped.type === 0, 'wrapped Megolm key is a PreKey message (type 0)');

  // --- Bob receives the wrapped key, establishes inbound 1:1 + inbound group ---
  const b2a = new Olm.Session();
  b2a.create_inbound(bob, wrapped.body);
  bob.remove_one_time_keys(b2a);
  const receivedKey = b2a.decrypt(wrapped.type, wrapped.body);
  ok(receivedKey === megolmKey, 'Bob recovered the exact Megolm session key');

  const inbound = new Olm.InboundGroupSession();
  inbound.create(receivedKey);

  // --- Alice encrypts a room message with the outbound session ---
  const m1 = outbound.encrypt('hello room');
  const plain1 = inbound.decrypt(m1).plaintext;
  ok(plain1 === 'hello room', 'Bob decrypts Alice\'s first room message');

  // --- Bob has only an inbound session; as a recipient he cannot encrypt (correct) ---
  // (InboundGroupSession has no encrypt — Megolm is one-way. Alice remains sender.)

  // --- Multiple messages ratchet forward ---
  const m2 = outbound.encrypt('second message');
  const m3 = outbound.encrypt('third message');
  ok(inbound.decrypt(m2).plaintext === 'second message', 'Bob decrypts second message');
  ok(inbound.decrypt(m3).plaintext === 'third message', 'Bob decrypts third message (ratchet advanced)');

  // --- Out-of-order decryption within the ratchet window ---
  const m4 = outbound.encrypt('fourth');
  ok(inbound.decrypt(m4).plaintext === 'fourth', 'in-order decrypt OK');
  ok(inbound.decrypt(m2).plaintext === 'second message', 're-decrypt earlier message (within window) OK');

  // --- Pickle / restore round-trip (IndexedDB persistence simulation) ---
  const pickleKey = 'extrovert-pickle-v1';
  const outP = outbound.pickle(pickleKey);
  const out2 = new Olm.OutboundGroupSession(); out2.unpickle(pickleKey, outP);
  ok(out2.session_id() === outbound.session_id(), 'outbound group session restores with same id');
  const m5 = out2.encrypt('after restore');
  ok(inbound.decrypt(m5).plaintext === 'after restore', 'recipient decrypts message from restored sender session');

  const inP = inbound.pickle(pickleKey);
  const in2 = new Olm.InboundGroupSession(); in2.unpickle(pickleKey, inP);
  ok(in2.decrypt(m1).plaintext === 'hello room', 'restored inbound session decrypts first message');

  // --- Rotation: new member Carol joins; Alice rotates so Carol cannot read history ---
  const carol = new Olm.Account(); carol.create();
  carol.generate_one_time_keys(5); carol.generate_fallback_key();
  const carolId = identityKeys(carol), carolOTK = oneTimeKeys(carol)[0];

  const a2c = new Olm.Session();
  a2c.create_outbound(alice, carolId.curve25519, carolOTK.key);
  const freshOut = new Olm.OutboundGroupSession();
  freshOut.create();
  const freshKey = freshOut.session_key();
  const freshWrapped = a2c.encrypt(freshKey);

  const c2a = new Olm.Session();
  c2a.create_inbound(carol, freshWrapped.body);
  carol.remove_one_time_keys(c2a);
  const carolKey = c2a.decrypt(freshWrapped.type, freshWrapped.body);
  const carolIn = new Olm.InboundGroupSession();
  carolIn.create(carolKey);

  const newMsg = freshOut.encrypt('post-rotation message');
  ok(carolIn.decrypt(newMsg).plaintext === 'post-rotation message', 'Carol decrypts post-rotation message');
  // Carol should NOT be able to decrypt pre-rotation history (different session)
  let carolHistory = null;
  try { carolIn.decrypt(m1); carolHistory = 'decrypted (BAD)'; } catch { carolHistory = 'failed (GOOD)'; }
  ok(carolHistory === 'failed (GOOD)', 'Carol cannot read pre-rotation history (session rotation works)');

  // --- Cleanup ---
  [alice, bob, carol, a2b, b2a, a2c, c2a, outbound, out2, inbound, in2, freshOut, carolIn].forEach(o => o.free());

  console.log(failures ? '\nSOME TESTS FAILED' : '\nALL MEGOLM CHECKS PASSED');
  process.exit(failures ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(1); });
