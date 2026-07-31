// Full two-party DM session test: validates that after page reloads on BOTH
// sides, the whole conversation history still decrypts and sending continues.
// Models the browser's baseline-session design (baseline for history, live
// session for sending). Guards against '[unable to decrypt]' regressions.
// Run: node scripts/session-reload-test.js
const fs = require('fs');
const Olm = require('@matrix-org/olm');

const WASM = fs.readFileSync(require.resolve('@matrix-org/olm/olm.wasm'));

let failures = 0;
function ok(cond, msg) { console.log((cond ? '  [OK]   ' : '  [FAIL] ') + msg); if (!cond) failures++; }

async function main() {
  await Olm.init({ wasmBinary: WASM });
  const KEY = 'extrovert-pickle-v1';

  // Two Olm accounts: alice (sender) + bob (recipient).
  const alice = new Olm.Account(); alice.create(); alice.generate_one_time_keys(10);
  const bob = new Olm.Account(); bob.create(); bob.generate_one_time_keys(10);
  const aliceId = JSON.parse(alice.identity_keys());
  const bobId = JSON.parse(bob.identity_keys());
  const bobOtks = JSON.parse(bob.one_time_keys());
  const bobOtkId = Object.keys(bobOtks.curve25519)[0];

  // --- Alice creates the outbound session to Bob (message 1 is PreKey) ---
  const aLive = new Olm.Session();
  aLive.create_outbound(alice, bobId.curve25519, bobOtks.curve25519[bobOtkId]);
  const aBaseline = aLive.pickle(KEY); // baseline persisted once at creation

  const m1 = aLive.encrypt('hi bob');
  aLivePickle = aLive.pickle(KEY);

  // --- Bob receives m1, creates inbound session, saves baseline + live ---
  const bIn = new Olm.Session();
  bIn.create_inbound(bob, m1.body);
  bob.remove_one_time_keys(bIn);
  const bBaseline = bIn.pickle(KEY);
  const bLivePickle1 = bIn.pickle(KEY);
  ok(bIn.decrypt(m1.type, m1.body) === 'hi bob', 'bob decrypts alice\'s first message');

  // --- Alice sends m2, m3 (live session advances; baseline unchanged) ---
  const m2 = aLive.encrypt('msg 2');
  const m3 = aLive.encrypt('msg 3');
  const aLivePickle2 = aLive.pickle(KEY);

  // --- Simulate ALICE reload: restore baseline for history + live for sending ---
  const aHist = new Olm.Session(); aHist.unpickle(KEY, aBaseline);
  const aLive2 = new Olm.Session(); aLive2.unpickle(KEY, aLivePickle2);

  // Alice sends m4 AFTER her reload (live session continues).
  const m4 = aLive2.encrypt('msg 4');
  const aLivePickle3 = aLive2.pickle(KEY);

  // --- Bob decrypts m1-m4 from his baseline (history) ---
  const bHist = new Olm.Session(); bHist.unpickle(KEY, bBaseline);
  [m1, m2, m3, m4].forEach((m, i) => {
    try {
      const p = bHist.decrypt(m.type, m.body);
      const expected = ['hi bob', 'msg 2', 'msg 3', 'msg 4'][i];
      ok(p === expected, 'bob decrypts alice message ' + (i + 1) + ' from baseline');
    } catch (e) {
      ok(false, 'bob decrypts alice message ' + (i + 1) + ' from baseline (' + e.message + ')');
    }
  });

  // --- Bob replies using his live session ---
  const bLive = new Olm.Session(); bLive.unpickle(KEY, bLivePickle1);
  const r1 = bLive.encrypt('hey alice');
  const bLivePickle2 = bLive.pickle(KEY);

  // --- Alice receives Bob's reply; her baseline must decrypt it ---
  const aHist2 = new Olm.Session(); aHist2.unpickle(KEY, aBaseline);
  let replyOk = true;
  try {
    const p = aHist2.decrypt(r1.type, r1.body);
    ok(p === 'hey alice', 'alice decrypts bob\'s reply from her baseline');
  } catch (e) {
    ok(false, 'alice decrypts bob\'s reply from her baseline (' + e.message + ')');
  }

  // --- Bob reloads: baseline decrypts the whole alice history again ---
  const bHist2 = new Olm.Session(); bHist2.unpickle(KEY, bBaseline);
  let all = true;
  [m1, m2, m3, m4].forEach(m => {
    try { if (bHist2.decrypt(m.type, m.body) === null) all = false; } catch { all = false; }
  });
  ok(all, 'bob re-decrypts full alice history after his own reload');

  [alice, bob, aLive, aLive2, bIn, bLive, aHist, aHist2, bHist, bHist2].forEach(o => { try { o.free(); } catch {} });

  console.log(failures ? '\nSOME TESTS FAILED' : '\nALL SESSION-RELOAD CHECKS PASSED');
  process.exit(failures ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(1); });
