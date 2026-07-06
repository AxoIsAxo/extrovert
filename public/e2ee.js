(function () {
  'use strict';

  var SESSION_KEY = 'extrovert_e2ee_kek';
  var KEY_URL = '/chats/keys';
  var PUBKEY_URL = '/chats/pubkey';

  var myPrivateKey = null;
  var myPublicKeyPem = null;

  /* ---- Derive a key-encryption key from password + username ---- */
  function deriveKek(password, username) {
    var enc = new TextEncoder();
    return crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']).then(function (key) {
      return crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt: enc.encode(username.toLowerCase()), iterations: 600000, hash: 'SHA-256' },
        key,
        { name: 'AES-GCM', length: 256 },
        true,
        ['wrapKey', 'unwrapKey']
      );
    });
  }

  /* ---- Wrap an RSA private key with a KEK (exportable KEK) ---- */
  function wrapPrivateKey(privateKey, kek) {
    var iv = crypto.getRandomValues(new Uint8Array(12));
    return crypto.subtle.wrapKey('pkcs8', privateKey, kek, { name: 'AES-GCM', iv: iv }).then(function (wrapped) {
      var combined = new Uint8Array(iv.length + wrapped.length);
      combined.set(iv);
      combined.set(new Uint8Array(wrapped), iv.length);
      return btoa(String.fromCharCode.apply(null, combined));
    });
  }

  /* ---- Generate RSA key pair and upload -- uses an already-derived KEK ---- */
  function generateAndUpload(kek) {
    return crypto.subtle.generateKey(
      { name: 'RSA-OAEP', modulusLength: 4096, publicExponent: new Uint8Array([1,0,1]), hash: 'SHA-256' },
      true, ['encrypt', 'decrypt']
    ).then(function (pair) {
      myPrivateKey = pair.privateKey;
      return crypto.subtle.exportKey('spki', pair.publicKey).then(function (spki) {
        myPublicKeyPem = btoa(String.fromCharCode.apply(null, new Uint8Array(spki)));
        return wrapPrivateKey(pair.privateKey, kek);
      }).then(function (encPriv) {
        return fetch(PUBKEY_URL, {
          method: 'POST',
          headers: csrfHeaders(),
          body: JSON.stringify({ publicKey: myPublicKeyPem, encryptedPrivateKey: encPriv }),
          credentials: 'same-origin'
        });
      });
    });
  }

  /* ---- Read CSRF token from page meta ---- */
  function csrfToken() {
    var meta = document.querySelector('meta[name="csrf-token"]');
    return meta ? meta.getAttribute('content') : '';
  }

  function csrfHeaders() {
    return { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken() };
  }

  /* ---- Fetch keys from server, unwrap private key with KEK ---- */
  function ensureKeys(kek) {
    if (myPrivateKey) return Promise.resolve();
    return fetch(KEY_URL, { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (data) {
      if (data.publicKey) myPublicKeyPem = data.publicKey;
      if (data.encryptedPrivateKey && kek) {
        var combined = Uint8Array.from(atob(data.encryptedPrivateKey), function (c) { return c.charCodeAt(0); });
        return crypto.subtle.unwrapKey('pkcs8', combined.slice(12), kek, { name: 'AES-GCM', iv: combined.slice(0, 12) },
          { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['decrypt'])
          .then(function (priv) { myPrivateKey = priv; });
      } else if (!data.publicKey && kek) {
        // No keys exist yet (existing user before E2EE) — generate on the spot
        return generateAndUpload(kek);
      }
    });
  }

  /* ---- Derive KEK and store in sessionStorage ---- */
  function storeKek(password, username) {
    return deriveKek(password, username).then(function (kek) {
      return crypto.subtle.exportKey('jwk', kek);
    }).then(function (jwk) {
      sessionStorage.setItem(SESSION_KEY, btoa(JSON.stringify(jwk)));
    });
  }

  /* ---- Intercept login form ---- */
  function interceptLoginForm() {
    var form = document.querySelector('form[action^="/login"]');
    if (!form) return;
    form.addEventListener('submit', function () {
      var pass = form.querySelector('input[name="password"]');
      var user = form.querySelector('input[name="username"]');
      if (pass && user && pass.value && user.value) {
        storeKek(pass.value, user.value).catch(function () {});
      }
    });
  }

  /* ---- Intercept register form ---- */
  function interceptRegisterForm() {
    var form = document.querySelector('form[action^="/register"]');
    if (!form) return;
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var pass = form.querySelector('input[name="password"]');
      var user = form.querySelector('input[name="username"]');
      if (!pass || !user || !pass.value || !user.value) return;
      deriveKek(pass.value, user.value).then(function (kek) {
        return generateAndUpload(kek).then(function () {
          return crypto.subtle.exportKey('jwk', kek);
        }).then(function (jwk) {
          sessionStorage.setItem(SESSION_KEY, btoa(JSON.stringify(jwk)));
        });
      }).then(function () {
        form.submit();
      }).catch(function (err) {
        console.error('E2EE setup failed', err);
      });
    });
  }

  /* ---- My own SPKI for encrypting AES keys for ourselves ---- */
  function mySpki() {
    if (!myPublicKeyPem) return Promise.reject(new Error('No public key'));
    var bytes = atob(myPublicKeyPem.replace(/\s/g, ''));
    var arr = new Uint8Array(bytes.length);
    for (var i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
    return crypto.subtle.importKey('spki', arr.buffer, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']);
  }

  /* ---- Encrypt ---- */
  function encryptMessage(plaintext, recipientPem) {
    var aesKey, iv;
    return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt']).then(function (k) {
      aesKey = k;
      iv = crypto.getRandomValues(new Uint8Array(12));
      return crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, aesKey, new TextEncoder().encode(plaintext));
    }).then(function (ciphertext) {
      var bodyArr = new Uint8Array(iv.length + ciphertext.length);
      bodyArr.set(iv);
      bodyArr.set(new Uint8Array(ciphertext), iv.length);
      var bodyB64 = btoa(String.fromCharCode.apply(null, bodyArr));
      return crypto.subtle.exportKey('raw', aesKey).then(function (rawKey) {
        return Promise.all([
          rsaEncrypt(rawKey, pemToSpki(recipientPem)),
          mySpki().then(function (pub) { return rsaEncrypt(rawKey, pub); })
        ]).then(function (keys) {
          return { body: bodyB64, keyForRecipient: keys[0], keyForSender: keys[1] };
        });
      });
    });
  }

  function pemToSpki(pem) {
    var b64 = pem.replace(/-----BEGIN PUBLIC KEY-----/g,'').replace(/-----END PUBLIC KEY-----/g,'').replace(/\s/g,'');
    var bytes = atob(b64);
    var arr = new Uint8Array(bytes.length);
    for (var i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
    return arr.buffer;
  }

  function rsaEncrypt(rawKey, spkiBuf) {
    return crypto.subtle.importKey('spki', spkiBuf, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt'])
      .then(function (pub) { return crypto.subtle.encrypt({ name: 'RSA-OAEP' }, pub, rawKey); })
      .then(function (enc) { return btoa(String.fromCharCode.apply(null, new Uint8Array(enc))); });
  }

  /* ---- Decrypt ---- */
  function decryptMessage(bodyB64, keyB64) {
    if (!myPrivateKey) return Promise.reject(new Error('No private key loaded'));
    var encKey = Uint8Array.from(atob(keyB64), function (c) { return c.charCodeAt(0); });
    return crypto.subtle.decrypt({ name: 'RSA-OAEP' }, myPrivateKey, encKey).then(function (rawKey) {
      return crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, false, ['decrypt']);
    }).then(function (aesKey) {
      var data = Uint8Array.from(atob(bodyB64), function (c) { return c.charCodeAt(0); });
      return crypto.subtle.decrypt({ name: 'AES-GCM', iv: data.slice(0, 12) }, aesKey, data.slice(12));
    }).then(function (plain) { return new TextDecoder().decode(plain); });
  }

  /* ---- Clipboard fallback for copy-ref buttons ---- */
  function copyToClip(text, btn) {
    function done() { btn.textContent = 'Copied!'; setTimeout(function(){ btn.textContent = 'Copy Referral'; }, 2000); }
    function fallback() {
      var i = document.createElement('input');
      i.value = text; document.body.appendChild(i); i.select();
      document.execCommand('copy'); document.body.removeChild(i);
      done();
    }
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(done).catch(fallback);
    } else { fallback(); }
  }

  /* ---- Init on every page load ---- */
  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('.copy-ref').forEach(function(b){
      b.addEventListener('click', function(e){
        copyToClip(this.getAttribute('data-link'), this);
      });
    });
    interceptLoginForm();
    interceptRegisterForm();

    var kekB64 = sessionStorage.getItem(SESSION_KEY);
    var kekPromise = kekB64 ? crypto.subtle.importKey('jwk', JSON.parse(atob(kekB64)), { name: 'AES-GCM', length: 256 }, false, ['unwrapKey']).catch(function () { return null; }) : Promise.resolve(null);

    kekPromise.then(function (kek) {
      return ensureKeys(kek);
    }).then(function () {
      if (!myPrivateKey) return;

      // ---- Chat form interception ----
      var sendForm = document.querySelector('.chat-form');
      var recipientPem = sendForm ? sendForm.getAttribute('data-pubkey') : null;
      if (sendForm && recipientPem) {
        sendForm.addEventListener('submit', function (e) {
          e.preventDefault();
          var input = sendForm.querySelector('input[name="body"]');
          var plaintext = input.value.trim();
          if (!plaintext) return;
          input.disabled = true;
          encryptMessage(plaintext, recipientPem).then(function (result) {
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

      // ---- Decrypt existing messages ----
      document.querySelectorAll('.chat-msg').forEach(function (el) {
        var bodyB64 = el.getAttribute('data-body');
        var keyB64 = el.classList.contains('own')
          ? el.getAttribute('data-key-sender')
          : el.getAttribute('data-key-recipient');
        if (bodyB64 && keyB64) {
          decryptMessage(bodyB64, keyB64).then(function (plain) {
            var bubble = el.querySelector('.chat-bubble');
            if (bubble) {
              bubble.innerHTML = '';
              bubble.appendChild(document.createTextNode(plain));
            }
          }).catch(function () {});
        }
      });
    });
  });
})();
