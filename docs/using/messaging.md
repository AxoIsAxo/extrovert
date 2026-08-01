# Direct messages (E2EE)

Direct messages are **end-to-end encrypted**, and — consistent with the network-first design — you can only DM **mutual followers** (both of you follow each other).

## Where DMs live

- Web: `/chats` (conversation list) and `/chats/<username>` (thread).
- API: `/api/v1/conversations*` endpoints (scopes `read:direct` / `write:direct`) — same crypto, same routes, Bearer auth. See the [endpoint reference](../developers/endpoints.md#direct-messages).

## Encryption model

Two generations of message protocol, stored per message in the `proto` column:

| proto | Scheme | Ciphertext columns |
|---|---|---|
| `rsa` | Legacy: per-message RSA wrapping | `key_for_sender`, `key_for_recipient` |
| `olm` | Signal-style Olm (current) | `sender_ciphertext` |

The server **enforces** encryption: any non-sticker message that isn't Olm-encrypted is rejected (`End-to-end encryption required. All messages must be Olm-encrypted.`). The server only ever stores ciphertext for Olm messages.

### Your key material (server only stores public parts)

| Concept | Stored where | Contents |
|---|---|---|
| RSA public key + encrypted private key | `user_public_keys` | Legacy keypair; the private key is stored **encrypted** (client-encrypted) so the server can't use it. |
| Olm identity | `olm_identity` | Curve25519 `identity_key`, `ed25519_key` (for safety numbers), a `fallback_key`, and an optional client-encrypted `backup`. |
| One-time prekeys | `olm_prekeys` | Published Curve25519 public prekeys; **claimed (marked used) atomically** when someone fetches your bundle. |

Your private halves (account, identity, session states) always live client-side. The only exception is the *encrypted* RSA private key, which the server stores but can never read.

### Key lifecycle

- **Publish:** your client uploads its identity + prekey bundle (`POST /chats/prekeys` web, or `POST /api/v1/conversations/prekeys` API). The server responds with how many one-time prekeys remain available (`available`).
- **Fetch a peer's bundle:** `GET /chats/<username>/bundle` (or the API twin) — returns their identity key, ed25519 key, fallback key, and **one claimed one-time prekey**. Claiming consumes the prekey, forcing peers to publish fresh ones.
- **Backup / recovery:** the client can upload a password-encrypted account backup (`backup` in `prekeys`) and download it later (`GET /chats/prekeys/backup`) to recover a new browser session.
- **Safety numbers:** `GET /chats/<username>/safety` returns both users' ed25519 + curve25519 keys so clients can render a compare-and-verify safety number.

## Conversation features

| Feature | Notes |
|---|---|
| List | `/chats` — last message preview, unread counts, **online presence** per conversation, and the peer's curve25519 key |
| History | Oldest-first thread; API returns newest-first with a cursor for backward pagination |
| Send | Body ≤ 5,000 chars; must be Olm-encrypted unless it's a sticker path |
| Stickers | A message whose body starts with `/uploads/stickers/` is allowed as a plaintext sticker path (see [Stickers](stickers.md)) |
| Edit | Author only, up to 5,000 chars, re-encrypted; recorded in edit history, marked "(edited)" |
| Delete | API: `DELETE /api/v1/messages/:id`; the record (including ciphertext) is removed |
| Read state | Unread counts per conversation; opening a thread marks it read |
| Live delivery | New messages are pushed in realtime over the WebSocket `new_dm` event to **every open tab** of the recipient (ciphertext only) |

## Live notifications

Sending a DM creates a `message` notification for the recipient (inbox + SSE + badge). Live ciphertext delivery is handled by the signaling WebSocket — see [Realtime](../developers/realtime.md).

## Sending messages via API

Example (Olm protocol):

```
POST /api/v1/conversations/alice/messages
Authorization: Bearer <token>
Content-Type: application/json

{
  "body": "ciphertext…",                // or the raw body for sticker paths
  "proto": "olm",
  "sender_ciphertext": "…",
  "key_for_sender": "…",                // optional legacy fields
  "key_for_recipient": "…"
}
```

Both participants must be mutual followers or the server returns `403`.

## Migration & legacy data

Older messages created under the RSA scheme remain readable by clients that support `proto: rsa`. New messages default to Olm. The `messages` table carries `proto`, `sender_ciphertext`, and `edited_at` columns via automatic migration.

## Client-side notes (for implementers)

- The web client implements the Olm flows in `public/e2ee.js`; the Olm library is bundled as `public/lib/olm.js` + `olm.wasm` (no external CDN).
- The self-session design: the client persists its self-inbound session at creation baseline so history ratchets are stable across reloads (guarded by `scripts/self-session-test.js` and `scripts/session-reload-test.js`).
- Protocol regression tests: `scripts/crypto-test.js` (Olm), `scripts/megolm-room-test.js` (group), `scripts/live-dm-test.js` (WS delivery).
