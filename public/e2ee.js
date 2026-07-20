(function () {
  'use strict';

  var SESSION_KEY = 'extrovert_e2ee_kek';
  var KEY_URL = '/chats/keys';
  var PUBKEY_URL = '/chats/pubkey';

  var myPrivateKey = null;
  var myPublicKeyPem = null;

  function uint8ArrayToBase64(arr) {
    var s = '';
    for (var i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
    return btoa(s);
  }

  function deriveKek(password, username) {
    var enc = new TextEncoder();
    return crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']).then(function (key) {
      return crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt: enc.encode(username.toLowerCase()), iterations: 600000, hash: 'SHA-256' },
        key,
        { name: 'AES-GCM', length: 256 },
        true,
        ['wrapKey', 'unwrapKey', 'encrypt', 'decrypt']
      );
    });
  }

  function wrapPrivateKey(privateKey, kek) {
    var iv = crypto.getRandomValues(new Uint8Array(12));
    return crypto.subtle.exportKey('pkcs8', privateKey).then(function (exported) {
      return crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, kek, exported);
    }).then(function (encrypted) {
      var combined = new Uint8Array(iv.length + encrypted.byteLength);
      combined.set(iv);
      combined.set(new Uint8Array(encrypted), iv.length);
      return uint8ArrayToBase64(combined);
    });
  }

  function generateAndUpload(kek) {
    return crypto.subtle.generateKey(
      { name: 'RSA-OAEP', modulusLength: 4096, publicExponent: new Uint8Array([1,0,1]), hash: 'SHA-256' },
      true, ['encrypt', 'decrypt']
    ).then(function (pair) {
      myPrivateKey = pair.privateKey;
      return crypto.subtle.exportKey('spki', pair.publicKey).then(function (spki) {
        myPublicKeyPem = uint8ArrayToBase64(new Uint8Array(spki));
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

  function csrfToken() {
    var meta = document.querySelector('meta[name="csrf-token"]');
    return meta ? meta.getAttribute('content') : '';
  }

  function csrfHeaders() {
    return { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken() };
  }

  function ensureKeys(kek) {
    if (myPrivateKey) return Promise.resolve();
    return fetch(KEY_URL, { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (data) {
      if (data.publicKey) myPublicKeyPem = data.publicKey;
      if (data.encryptedPrivateKey && kek) {
        var combined = Uint8Array.from(atob(data.encryptedPrivateKey), function (c) { return c.charCodeAt(0); });
        return crypto.subtle.decrypt({ name: 'AES-GCM', iv: combined.slice(0, 12) }, kek, combined.slice(12))
          .then(function (decrypted) {
            return crypto.subtle.importKey('pkcs8', decrypted, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['decrypt']);
          }).then(function (priv) { myPrivateKey = priv; });
      } else if (data.publicKey && !data.encryptedPrivateKey && kek) {
        return generateAndUpload(kek);
      } else if (!data.publicKey && kek) {
        return generateAndUpload(kek);
      }
    });
  }

  function storeKek(password, username) {
    return deriveKek(password, username).then(function (kek) {
      return crypto.subtle.exportKey('jwk', kek);
    }).then(function (jwk) {
      sessionStorage.setItem(SESSION_KEY, btoa(JSON.stringify(jwk)));
    });
  }

  function interceptLoginForm() {
    var form = document.querySelector('form[action^="/login"]');
    if (!form) return;
    var intercepted = false;
    form.addEventListener('submit', function (e) {
      if (intercepted) return;
      var pass = form.querySelector('input[name="password"]');
      var user = form.querySelector('input[name="username"]');
      if (pass && user && pass.value && user.value) {
        e.preventDefault();
        intercepted = true;
        storeKek(pass.value, user.value).then(function () {
          form.submit();
        }).catch(function () {
          form.submit();
        });
      }
    });
  }

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

  function mySpki() {
    if (!myPublicKeyPem) return Promise.reject(new Error('No public key'));
    var bytes = atob(myPublicKeyPem.replace(/\s/g, ''));
    var arr = new Uint8Array(bytes.length);
    for (var i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
    return crypto.subtle.importKey('spki', arr.buffer, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']);
  }

  function encryptMessage(plaintext, recipientPem) {
    var aesKey, iv;
    return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt']).then(function (k) {
      aesKey = k;
      iv = crypto.getRandomValues(new Uint8Array(12));
      return crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, aesKey, new TextEncoder().encode(plaintext));
    }).then(function (ciphertext) {
      var bodyArr = new Uint8Array(iv.length + ciphertext.byteLength);
      bodyArr.set(iv);
      bodyArr.set(new Uint8Array(ciphertext), iv.length);
      var bodyB64 = uint8ArrayToBase64(bodyArr);
      return crypto.subtle.exportKey('raw', aesKey).then(function (rawKey) {
        return Promise.all([
          rsaEncrypt(rawKey, pemToSpki(recipientPem)),
          mySpki().then(function (pub) { return crypto.subtle.encrypt({ name: 'RSA-OAEP' }, pub, rawKey).then(function (enc) { return uint8ArrayToBase64(new Uint8Array(enc)); }); })
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
      .then(function (enc) { return uint8ArrayToBase64(new Uint8Array(enc)); });
  }

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

  function addChatMsg(container, msg) {
    var div = document.createElement('div');
    div.className = 'chat-msg own';
    var bubble = document.createElement('div');
    bubble.className = 'chat-bubble';
    var sticker = msg.body && msg.body.indexOf('/uploads/stickers/') !== -1;
    if (sticker) {
      bubble.innerHTML = '<img src="' + esc(msg.body) + '" class="sticker-inline" style="max-width:120px;max-height:120px;vertical-align:middle" alt="sticker">';
    } else {
      bubble.appendChild(document.createTextNode(msg.body));
    }
    div.appendChild(bubble);
    var time = document.createElement('div');
    time.className = 'muted';
    time.style.cssText = 'font-size:0.7rem;padding:0 4px';
    time.textContent = window.relTime ? window.relTime(msg.created_at) : new Date(msg.created_at).toLocaleString();
    div.appendChild(time);
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
  }

  function esc(s){
    var d = document.createElement('div');
    d.appendChild(document.createTextNode(s));
    return d.innerHTML;
  }

  function showUnlockOverlay() {
    var overlay = document.getElementById('e2ee-unlock-overlay');
    if (!overlay) return;
    overlay.style.display = 'flex';
    var input = document.getElementById('e2ee-password');
    var btn = document.getElementById('e2ee-unlock-btn');
    var error = document.getElementById('e2ee-unlock-error');
    var resetLink = document.getElementById('e2ee-reset-link');
    if (!input || !btn) return;
    input.focus();

    var username = overlay.getAttribute('data-username') || '';

    function resetKeys() {
      var pass = input.value.trim();
      if (!pass) { error.textContent = 'Enter your password first.'; error.style.display = 'block'; input.focus(); return; }
      if (!confirm('This will generate new encryption keys. You will lose access to any previously encrypted messages. Continue?')) return;
      error.style.display = 'none';
      btn.disabled = true;
      btn.textContent = 'Resetting…';
      deriveKek(pass, username).then(function (kek) {
        return generateAndUpload(kek);
      }).then(function () {
        storeKek(pass, username);
        overlay.style.display = 'none';
        initChat();
      }).catch(function () {
        error.textContent = 'Key reset failed. Reload the page and try again.';
        error.style.display = 'block';
        btn.disabled = false;
        btn.textContent = 'Unlock';
      });
    }

    function doUnlock() {
      var pass = input.value.trim();
      if (!pass) return;
      btn.disabled = true;
      btn.textContent = 'Unlocking…';
      deriveKek(pass, username).then(function (kek) {
        return ensureKeys(kek).then(function () {
          if (!myPrivateKey) throw new Error('Wrong password or no keys found');
          storeKek(pass, username);
          overlay.style.display = 'none';
          error.style.display = 'none';
          initChat();
        });
      }).catch(function (err) {
        console.error('E2EE unlock failed:', err);
        error.textContent = 'Could not decrypt your keys. If you forgot your password or this keeps failing, reset your keys below.';
        error.style.display = 'block';
        btn.disabled = false;
        btn.textContent = 'Unlock';
        if (resetLink) resetLink.style.display = 'block';
      });
    }

    btn.onclick = doUnlock;
    if (resetLink) resetLink.onclick = function (e) { e.preventDefault(); resetKeys(); };
    input.onkeydown = function (e) {
      if (e.key === 'Enter') { e.preventDefault(); doUnlock(); }
    };
  }

  function showRecipientNotReady() {
    var notice = document.getElementById('e2ee-recipient-notice');
    if (notice) notice.style.display = 'block';
    var sendForm = document.querySelector('.chat-form');
    if (sendForm) {
      var btn = sendForm.querySelector('button');
      if (btn) btn.disabled = true;
    }
  }

  function initChat() {
    var sendForm = document.querySelector('.chat-form');
    if (!sendForm) return;

    var recipientPem = sendForm.getAttribute('data-pubkey');
    if (!recipientPem) {
      showRecipientNotReady();
      return;
    }

    if (!myPrivateKey || !myPublicKeyPem) return;

    sendForm.addEventListener('submit', function (e) {
      e.stopImmediatePropagation();
      e.preventDefault();
      var input = sendForm.querySelector('input[name="body"]');
      var plaintext = input.value.trim();
      if (!plaintext) return;

      // Stickers are sent as plaintext (they're image paths, not user text)
      if (plaintext.startsWith('/uploads/stickers/')) {
        input.disabled = true;
        var chatMsgDiv = document.querySelector('.chat-messages');
        var usp = new URLSearchParams(Array.from(new FormData(sendForm)));
        fetch(sendForm.getAttribute('action'), {
          method: 'POST',
          headers: { 'X-Requested-With': 'XMLHttpRequest', 'X-CSRF-Token': csrfToken() },
          body: usp,
        }).then(function (r) { return r.json(); }).then(function (data) {
          if (data.error) return;
          if (data.message && chatMsgDiv) {
            addChatMsg(chatMsgDiv, data.message);
          }
          input.value = '';
          input.disabled = false;
        }).catch(function () { input.disabled = false; });
        return;
      }

      input.disabled = true;
      var chatMsgDiv = document.querySelector('.chat-messages');
      encryptMessage(plaintext, recipientPem).then(function (result) {
        var usp = new URLSearchParams(Array.from(new FormData(sendForm)));
        usp.set('body', result.body);
        usp.set('key_for_sender', result.keyForSender);
        usp.set('key_for_recipient', result.keyForRecipient);
        fetch(sendForm.getAttribute('action'), {
          method: 'POST',
          headers: { 'X-Requested-With': 'XMLHttpRequest', 'X-CSRF-Token': csrfToken() },
          body: usp,
        }).then(function (r) { return r.json(); }).then(function (data) {
          if (data.error) return;
          if (data.message && chatMsgDiv) {
            var m = data.message;
            decryptMessage(m.body, m.key_for_sender).then(function (plain) {
              m.body = plain;
              addChatMsg(chatMsgDiv, m);
            }).catch(function () {
              addChatMsg(chatMsgDiv, m);
            });
          }
          input.value = '';
          input.disabled = false;
        }).catch(function () { input.disabled = false; });
      }).catch(function (err) {
        console.error('E2EE encrypt error', err);
        input.disabled = false;
      });
    });

    // Inline DM editing with re-encryption
    document.addEventListener('click', function (e) {
      var editBtn = e.target.closest('.edit-msg-btn');
      if (!editBtn) return;
      e.preventDefault();
      var msgDiv = editBtn.closest('.chat-msg');
      if (!msgDiv || msgDiv.querySelector('.inline-edit-input')) return;
      var bubble = msgDiv.querySelector('.chat-bubble');
      var dataEl = msgDiv.querySelector('.edit-msg-data');
      if (!bubble || !dataEl) return;
      var action = dataEl.dataset.action;
      var csrf = dataEl.dataset.csrf;
      var origText = bubble.textContent;

      var input = document.createElement('input');
      input.type = 'text';
      input.className = 'inline-edit-input chat-bubble-edit';
      input.value = origText;
      bubble.replaceWith(input);
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);

      var btnWrap = document.createElement('span');
      btnWrap.className = 'inline-edit-btns';
      btnWrap.style.cssText = 'display:inline-flex;gap:4px;margin-left:4px;vertical-align:middle';
      var saveBtn = document.createElement('button');
      saveBtn.className = 'btn inline-save-btn';
      saveBtn.textContent = 'Save';
      saveBtn.type = 'button';
      saveBtn.style.cssText = 'font-size:12px;padding:4px 12px;cursor:pointer';
      var cancelBtn = document.createElement('button');
      cancelBtn.className = 'btn ghost inline-cancel-btn';
      cancelBtn.textContent = 'Cancel';
      cancelBtn.type = 'button';
      cancelBtn.style.cssText = 'font-size:12px;padding:4px 12px;cursor:pointer';
      btnWrap.appendChild(saveBtn);
      btnWrap.appendChild(cancelBtn);
      input.parentNode.insertBefore(btnWrap, input.nextSibling);

      function restore(text) {
        var span = document.createElement('div');
        span.className = 'chat-bubble';
        span.textContent = text;
        input.replaceWith(span);
        if (btnWrap.parentNode) btnWrap.remove();
      }

      function doSave() {
        var val = input.value.trim();
        if (!val || val === origText) { restore(origText); return; }

        // Sticker edits — send as-is
        if (val.startsWith('/uploads/stickers/')) {
          saveBtn.disabled = true;
          saveBtn.textContent = 'Saving…';
          fetch(action, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-CSRF-Token': csrf },
            body: 'body=' + encodeURIComponent(val) + '&_csrf=' + encodeURIComponent(csrf),
          }).then(function(r){ return r.json(); }).then(function(d){
            if (d.ok) { restore(val); } else { location.reload(); }
          });
          return;
        }

        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving…';
        encryptMessage(val, recipientPem).then(function (result) {
          fetch(action, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-CSRF-Token': csrf },
            body: 'body=' + encodeURIComponent(result.body) + '&key_for_sender=' + encodeURIComponent(result.keyForSender) + '&key_for_recipient=' + encodeURIComponent(result.keyForRecipient) + '&_csrf=' + encodeURIComponent(csrf),
          }).then(function(r){ return r.json(); }).then(function(d){
            if (d.ok) { restore(val); } else { location.reload(); }
          });
        }).catch(function (err) {
          console.error('E2EE re-encrypt error', err);
          saveBtn.disabled = false;
          saveBtn.textContent = 'Save';
        });
      }

      saveBtn.onclick = doSave;
      cancelBtn.onclick = function () { restore(origText); };
      input.addEventListener('keydown', function (ev) {
        if (ev.key === 'Escape') { restore(origText); ev.preventDefault(); }
        if (ev.key === 'Enter') { doSave(); ev.preventDefault(); }
      });
      input.addEventListener('blur', function () {
        setTimeout(function () { if (!input.parentNode) return; restore(origText); }, 200);
      });
    });

    // Decrypt existing messages
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
  }

  document.addEventListener('DOMContentLoaded', function () {
    interceptLoginForm();
    interceptRegisterForm();

    var isChatPage = document.querySelector('.chat-form') !== null;

    var kekB64 = sessionStorage.getItem(SESSION_KEY);
    var kekPromise;
    if (kekB64) {
      try { var jwk = JSON.parse(atob(kekB64)); } catch (e) { kekPromise = Promise.resolve(null); }
      if (!kekPromise) {
        kekPromise = crypto.subtle.importKey('jwk', jwk, { name: 'AES-GCM', length: 256 }, false, ['wrapKey', 'unwrapKey', 'encrypt', 'decrypt']).catch(function () { return null; });
      }
    } else {
      kekPromise = Promise.resolve(null);
    }

    kekPromise.then(function (kek) {
      return ensureKeys(kek);
    }).then(function () {
      if (isChatPage) {
        if (myPrivateKey) {
          initChat();
        } else {
          showUnlockOverlay();
        }
      }
    }).catch(function () {
      if (isChatPage) showUnlockOverlay();
    });
  });
})();
