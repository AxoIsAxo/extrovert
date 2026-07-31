// Self-session reload test: verifies that a sender's OWN sent messages remain
// decryptable across multiple page reloads, and that sending continues after a
// reload. The client persists the self-INBOUND session at its creation baseline
// (never its advanced state) so every reload re-derives the full history ratchet.
// Guards against '[unable to decrypt]' on sent messages after reload.
// Run: node scripts/self-session-test.js
const fs = require('fs');
const Olm = require('@matrix-org/olm');

const WASM = fs.readFileSync(require.resolve('@matrix-org/olm/olm.wasm'));

let failures = 0;
function ok(cond, msg) { console.log((cond ? '  [OK]   ' : '  [FAIL] ') + msg); if (!cond) failures++; }

async function main() {
  await Olm.init({ wasmBinary: WASM });
  const KEY = 'extrovert-pickle-v1';

  function newSelfSessions() {
    const acc = new Olm.Account(); acc.create();
    acc.generate_one_time_keys(10);
    const myId = JSON.parse(acc.identity_keys());
    const otks = JSON.parse(acc.one_time_keys());
    const out = new Olm.Session();
    out.create_outbound(acc, myId.curve25519, otks.curve25519[Object.keys(otks.curve25519)[0]]);
    const init = out.encrypt('__e2ee_self_init__');
    const inn = new Olm.Session();
    inn.create_inbound(acc, init.body);
    acc.remove_one_time_keys(inn);
    return { acc, out, inn };
  }

  // --- Browser session 1: create self sessions, send 4 messages ---
  let s = newSelfSessions();
  const baselineIn = s.inn.pickle(KEY); // persisted baseline, never advances
  const stored = []; // [{ t, b }]
  let outPickle;
  for (let i = 1; i <= 4; i++) {
    const m = s.out.encrypt('hello ' + i);
    stored.push({ t: m.type, b: m.body });
    outPickle = s.out.pickle(KEY); // outbound advances + persists
  }

  // --- Reload 1: restore outbound (advanced) + inbound (baseline), decrypt history ---
  s.out = new Olm.Session(); s.out.unpickle(KEY, outPickle);
  s.inn = new Olm.Session(); s.inn.unpickle(KEY, baselineIn);
  let allOk = true;
  stored.forEach((env, i) => {
    try {
      const p = s.inn.decrypt(env.t, env.b);
      if (p !== 'hello ' + (i + 1)) allOk = false;
    } catch { allOk = false; }
  });
  ok(allOk, 'messages 1-4 decrypt after reload 1');

  // --- Continue sending after reload (inbound advanced in memory, baseline persists) ---
  const m5 = s.out.encrypt('hello 5');
  stored.push({ t: m5.type, b: m5.body });
  outPickle = s.out.pickle(KEY); // outbound persists; baseline unchanged

  // --- Reload 2: again restore inbound from the baseline -> full history decrypts ---
  const out2 = new Olm.Session(); out2.unpickle(KEY, outPickle);
  const inn2 = new Olm.Session(); inn2.unpickle(KEY, baselineIn);
  let all2 = true;
  stored.forEach((env, i) => {
    try {
      const p = inn2.decrypt(env.t, env.b);
      if (p !== 'hello ' + (i + 1)) all2 = false;
    } catch { all2 = false; }
  });
  ok(all2, 'all 5 sent messages decrypt after reload 2 (baseline re-derives history)');

  [s.acc, s.out, s.inn, out2, inn2].forEach(o => { try { o.free(); } catch {} });

  console.log(failures ? '\nSOME TESTS FAILED' : '\nALL SELF-SESSION CHECKS PASSED');
  process.exit(failures ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(1); });
