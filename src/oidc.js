'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const KEY_FILE = path.join(DATA_DIR, 'oidc-keys.json');
const ISSUER = process.env.OIDC_ISSUER || 'https://extrovert.redforged.eu';

let keyPair = null;

function loadOrGenerateKeys() {
  if (keyPair) return keyPair;

  try {
    if (fs.existsSync(KEY_FILE)) {
      const raw = fs.readFileSync(KEY_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      keyPair = {
        publicKey: crypto.createPublicKey(parsed.publicKeyPem),
        privateKey: crypto.createPrivateKey(parsed.privateKeyPem),
        kid: parsed.kid,
      };
      return keyPair;
    }
  } catch {}

  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  const kid = crypto.randomBytes(8).toString('hex');
  const keyData = {
    kid,
    publicKeyPem: publicKey,
    privateKeyPem: privateKey,
    generatedAt: Date.now(),
  };

  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(KEY_FILE, JSON.stringify(keyData, null, 2), 'utf8');

  keyPair = {
    publicKey: crypto.createPublicKey(publicKey),
    privateKey: crypto.createPrivateKey(privateKey),
    kid,
  };
  return keyPair;
}

function getJwks() {
  const { publicKey, kid } = loadOrGenerateKeys();
  const jwk = publicKey.export({ format: 'jwk' });
  return {
    keys: [{
      kty: jwk.kty,
      kid,
      use: 'sig',
      alg: 'RS256',
      n: jwk.n,
      e: jwk.e,
    }],
  };
}

function signIdToken(payload) {
  const { privateKey, kid } = loadOrGenerateKeys();
  const header = {
    alg: 'RS256',
    typ: 'JWT',
    kid,
  };

  const now = Math.floor(Date.now() / 1000);
  const tokenPayload = {
    iss: ISSUER,
    iat: now,
    exp: now + 3600,
    ...payload,
  };

  const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const headerB64 = b64(header);
  const payloadB64 = b64(tokenPayload);
  const signature = crypto.sign('RSA-SHA256', Buffer.from(`${headerB64}.${payloadB64}`), privateKey);
  const signatureB64 = signature.toString('base64url');

  return `${headerB64}.${payloadB64}.${signatureB64}`;
}

module.exports = { loadOrGenerateKeys, getJwks, signIdToken, ISSUER };
