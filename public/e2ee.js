(function () {
  'use strict';

  var STORAGE_KEY = 'extrovert_e2ee_key';
  var UPLOADED_KEY = 'extrovert_e2ee_uploaded';

  /* ---- RSA key pair generation / loading ---- */
  function loadOrGenerateKey() {
    var stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      if (!localStorage.getItem(UPLOADED_KEY)) tryUploadExisting();
      return crypto.subtle.importKey(
        'jwk', JSON.parse(stored),
        { name: 'RSA-OAEP', hash: 'SHA-256' },
        true, ['decrypt']
      );
    }
    return generateAndUpload();
  }

  function tryUploadExisting() {
    var stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return;
    try {
      var jwk = JSON.parse(stored);
      var pub = {};
      ['kty','n','e'].forEach(function(k) { pub[k] = jwk[k]; });
      pub.key_ops = ['encrypt'];
      pub.ext = true;
      crypto.subtle.importKey('jwk', pub, { name: 'RSA-OAEP', hash: 'SHA-256' }, true, ['encrypt'])
        .then(function (p) { return crypto.subtle.exportKey('spki', p); })
        .then(function (buf) {
          var pem = btoa(String.fromCharCode.apply(null, new Uint8Array(buf)));
          return fetch('/chats/pubkey', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ publicKey: pem }),
            credentials: 'same-origin'
          });
        })
        .then(function (r) { if (r.ok) localStorage.setItem(UPLOADED_KEY, '1'); })
        .catch(function () {});
    } catch(e) {}
  }

  function generateAndUpload() {
    return crypto.subtle.generateKey(
      { name: 'RSA-OAEP', modulusLength: 4096, publicExponent: new Uint8Array([1,0,1]), hash: 'SHA-256' },
      true, ['encrypt', 'decrypt']
    ).then(function (pair) {
      return crypto.subtle.exportKey('jwk', pair.privateKey).then(function (jwk) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(jwk));
        localStorage.removeItem(UPLOADED_KEY);
        var pub = {};
        ['kty','n','e'].forEach(function(k) { pub[k] = jwk[k]; });
        pub.key_ops = ['encrypt'];
        pub.ext = true;
        return crypto.subtle.importKey('jwk', pub, { name: 'RSA-OAEP', hash: 'SHA-256' }, true, ['encrypt'])
          .then(function (p) { return crypto.subtle.exportKey('spki', p); })
          .then(function (buf) {
            var pem = btoa(String.fromCharCode.apply(null, new Uint8Array(buf)));
            return fetch('/chats/pubkey', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ publicKey: pem }),
              credentials: 'same-origin'
            });
          })
          .then(function (r) { if (r.ok) localStorage.setItem(UPLOADED_KEY, '1'); })
          .then(function () { return pair.privateKey; });
      });
    });
  }

  /* ---- PEM decode ---- */
  function pemToArrayBuffer(pem) {
    var b64 = pem.replace(/-----BEGIN PUBLIC KEY-----/g,'').replace(/-----END PUBLIC KEY-----/g,'').replace(/\s/g,'');
    var bytes = atob(b64);
    var arr = new Uint8Array(bytes.length);
    for (var i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
    return arr.buffer;
  }

  /* ---- Encrypt a plaintext for a recipient PEM ---- */
  function encryptMessage(plaintext, recipientPem, ownPubKeyPromise) {
    var aesKey, iv;
    return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt']).then(function (k) {
      aesKey = k;
      iv = crypto.getRandomValues(new Uint8Array(12));
      var enc = new TextEncoder();
      return crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, aesKey, enc.encode(plaintext));
    }).then(function (ciphertext) {
      var bodyArr = new Uint8Array(iv.length + ciphertext.length);
      bodyArr.set(iv);
      bodyArr.set(new Uint8Array(ciphertext), iv.length);
      var bodyB64 = btoa(String.fromCharCode.apply(null, bodyArr));

      return crypto.subtle.exportKey('raw', aesKey).then(function (rawKey) {
        return Promise.all([
          encryptAesKeyWithRsa(rawKey, pemToArrayBuffer(recipientPem)),
          ownPubKeyPromise.then(function (ownBuf) {
            return encryptAesKeyWithRsa(rawKey, ownBuf);
          })
        ]).then(function (keys) {
          return { body: bodyB64, keyForRecipient: keys[0], keyForSender: keys[1] };
        });
      });
    });
  }

  function encryptAesKeyWithRsa(rawKey, spkiBuf) {
    return crypto.subtle.importKey('spki', spkiBuf, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt'])
      .then(function (pub) {
        return crypto.subtle.encrypt({ name: 'RSA-OAEP' }, pub, rawKey);
      })
      .then(function (enc) {
        return btoa(String.fromCharCode.apply(null, new Uint8Array(enc)));
      });
  }

  /* ---- Decrypt a message body given which key to use ---- */
  function decryptMessage(bodyB64, keyB64) {
    var ownJwk = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!ownJwk) return Promise.reject(new Error('No private key'));
    return crypto.subtle.importKey('jwk', ownJwk, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['decrypt'])
      .then(function (priv) {
        var encKey = Uint8Array.from(atob(keyB64), function (c) { return c.charCodeAt(0); });
        return crypto.subtle.decrypt({ name: 'RSA-OAEP' }, priv, encKey);
      })
      .then(function (rawKey) {
        return crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, false, ['decrypt']);
      })
      .then(function (aesKey) {
        var data = Uint8Array.from(atob(bodyB64), function (c) { return c.charCodeAt(0); });
        var iv = data.slice(0, 12);
        var ct = data.slice(12);
        return crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv }, aesKey, ct);
      })
      .then(function (plain) {
        return new TextDecoder().decode(plain);
      });
  }

  /* ---- Page logic ---- */
  var privKeyPromise = loadOrGenerateKey();
  var ownPubKeyPromise = privKeyPromise.then(function (priv) {
    return crypto.subtle.exportKey('jwk', priv).then(function (jwk) {
      var pub = {};
      ['kty','n','e'].forEach(function(k) { pub[k] = jwk[k]; });
      pub.key_ops = ['encrypt'];
      pub.ext = true;
      return crypto.subtle.importKey('jwk', pub, { name: 'RSA-OAEP', hash: 'SHA-256' }, true, ['encrypt'])
        .then(function (p) { return crypto.subtle.exportKey('spki', p); });
    });
  });

  /* ---- Intercept chat forms ---- */
  document.addEventListener('DOMContentLoaded', function () {
    var sendForm = document.querySelector('.chat-form');
    var recipientPem = sendForm ? sendForm.getAttribute('data-pubkey') : null;

    if (sendForm && recipientPem) {
      sendForm.addEventListener('submit', function (e) {
        e.preventDefault();
        var input = sendForm.querySelector('input[name="body"]');
        var plaintext = input.value.trim();
        if (!plaintext) return;
        input.disabled = true;
        encryptMessage(plaintext, recipientPem, ownPubKeyPromise).then(function (result) {
          sendForm.querySelector('input[name="body"]').removeAttribute('name');
          var ef = document.createElement('input');
          ef.type = 'hidden'; ef.name = 'body'; ef.value = result.body;
          sendForm.appendChild(ef);
          var kfr = document.createElement('input');
          kfr.type = 'hidden'; kfr.name = 'key_for_recipient'; kfr.value = result.keyForRecipient;
          sendForm.appendChild(kfr);
          var kfs = document.createElement('input');
          kfs.type = 'hidden'; kfs.name = 'key_for_sender'; kfs.value = result.keyForSender;
          sendForm.appendChild(kfs);
          sendForm.submit();
        }).catch(function (err) {
          console.error('E2EE encrypt error', err);
          input.disabled = false;
        });
      });
    }

    /* ---- Decrypt existing messages ---- */
    var msgEls = document.querySelectorAll('.chat-msg');
    if (msgEls.length) {
      msgEls.forEach(function (el) {
        var bodyB64 = el.getAttribute('data-body');
        var keyForSender = el.getAttribute('data-key-sender');
        var keyForRecipient = el.getAttribute('data-key-recipient');
        var isOwn = el.classList.contains('own');
        var keyB64 = isOwn ? keyForSender : keyForRecipient;
        if (bodyB64 && keyB64) {
          decryptMessage(bodyB64, keyB64).then(function (plain) {
            var bubble = el.querySelector('.chat-bubble');
            if (bubble) bubble.textContent = plain;
          }).catch(function () {});
        }
      });
    }
  });
})();
