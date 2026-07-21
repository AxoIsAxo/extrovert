#!/usr/bin/env node
'use strict';

// Generates a VAPID key pair for Web Push (set as VAPID_PUBLIC_KEY and
// VAPID_PRIVATE_KEY in your environment / .env file).
//
// Usage: node scripts/generate-vapid-keys.js

const webpush = require('web-push');
const keys = webpush.generateVAPIDKeys();
console.log('VAPID keys generated. Add these to your environment:\n');
console.log('VAPID_PUBLIC_KEY=' + keys.publicKey);
console.log('VAPID_PRIVATE_KEY=' + keys.privateKey);
console.log('\nOptionally set VAPID_SUBJECT (mailto:admin@yourhost.example) — defaults to mailto:admin@extrovert.local');
