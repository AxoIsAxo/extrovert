# Realtime: WebSocket, SSE, push

Three realtime channels, one server (`src/server.js` upgrades `/ws` to a `ws` WebSocketServer; signaling logic in `src/webrtc-signaling.js`):

| Channel | For | Auth |
|---|---|---|
| `/ws` — signaling | presence, 1:1 calls, voice channels, live DM delivery | session cookie or `?token=<access_token>` |
| `/ws` — push channel | native/mobile call wake-ups | same |
| `GET /api/v1/notifications/stream` | notification SSE | Bearer (`notifications`) |
| Web Push (VAPID) | browser call notifications | subscription-based |

## WebSocket (`/ws`)

### Connecting & auth

- Browsers send their session cookie automatically.
- Native clients connect as `wss://host/ws?token=<oauth_access_token>`.
- Unauthenticated connections are closed with code `4001`.

### Roles: signaling vs push channel

The **first message** decides the connection's role:

- `{"type":"push_register"}` → *push channel*: the native app's foreground service. The user stays **offline** for calls (so the pending-call flow still runs), but receives `call`, `missed_call`, and `push_registered` payloads. Multiple push connections per user are allowed.
- anything else (typically `{"type":"ping"}`) → *signaling client*. One per user (last connection wins; older connections close with `4002`). Receives presence, call signaling, and live DMs.

### Client → server messages

| Type | Payload | Purpose |
|---|---|---|
| `ping` | — | Keepalive; server replies `pong`. |
| `push_register` | — | Register as a native push channel. |
| `call_request` | `{to}` | Ask about calling `to`. Replies: `callee_available` / `user_busy` / `calling_offline` / `user_offline` (not mutual). |
| `call_offer` | `{to, sdp}` or `{to, channel_id, sdp}` | Offer to a user (1:1) or a member of a voice channel. |
| `call_answer` | `{to, sdp}` / `{to, channel_id, sdp}` | Answer. |
| `ice_candidate` | `{to, candidate}` / `{to, channel_id, candidate}` | Trickle ICE. |
| `call_end` | `{to}` / `{channel_id}` | Hang up. |
| `call_decline` | `{to}` / `{channel_id}` | Decline. |
| `call_cancel` | — | Cancel an offline-call wait. |
| `join_channel` | `{channel_id}` | Enter a room voice channel. |
| `leave_channel` | `{channel_id}` | Leave a room voice channel. |

### Server → client messages

| Type | Payload | Meaning |
|---|---|---|
| `pong` | — | Reply to ping. |
| `push_registered` | — | Push channel accepted. |
| `user_online` / `user_offline` | `{username, display_name}` | A mutual follower connected/disconnected (broadcast to mutuals). |
| `callee_available` | `{to}` | Callee is online and free — proceed with the offer. |
| `user_busy` | `{from}` / `{to}` | Callee in a call (or already has a pending call). |
| `calling_offline` | `{to, expires_at}` | Callee offline; pending call queued (120 s TTL). |
| `user_offline` | `{from}` | Call target unreachable. |
| `incoming_call` | `{from, from_display, sdp?}` | Ring. With `sdp` it's a forwarded offer (1:1 or voice channel with `channel_id`). |
| `callee_ringing` | `{to}` | Callee reconnected and is being rung. |
| `call_answered` | `{from, from_display, sdp}` | Call accepted. |
| `call_ended` | `{from}` | Peer hung up. |
| `call_declined` | `{from}` | Peer declined. |
| `call_unanswered` | `{from, to}` | Offline call timed out. |
| `new_dm` | `{message: {…ciphertext…}, sender_curve, from_username, from_display}` | Live DM ciphertext to **every open tab** of the recipient. |
| `channel_joined` | `{channel_id, self, members}` | Voice channel join ack. |
| `user_joined_channel` / `user_left_channel` | `{channel_id, username, display_name?}` | Room voice-channel membership changes. |
| `call` (push channel) | `{type:"call", from, from_display, cancel_token}` | Native call wake-up. |
| `missed_call` (push channel) | `{type:"missed_call", from, from_display}` | Native missed-call notification. |

## Notification SSE

`GET /api/v1/notifications/stream` with `Authorization: Bearer <token>` (scope `notifications`):

```
event: connected
data: {}

event: notification
data: {"id":12,"type":"like","actor_id":7,"post_id":21,"created_at":1750000000000}

: heartbeat
```

- One `notification` event per new notification, pushed in-process the moment it's created (`src/notif-broadcaster.js`).
- Heartbeat comment lines every 15 s keep proxies happy; `X-Accel-Buffering: no` is set.
- Close the connection to stop receiving.

## Web Push (browsers)

1. Server must be configured with `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT`.
2. The browser fetches `GET /api/v1/push/vapid-public`, calls `pushManager.subscribe`, and registers via `POST /api/v1/push/subscribe` (`{platform:"web", endpoint, p256dh, auth}`).
3. Payloads delivered by the server (via `web-push`, urgency high, TTL 120):

   | Payload | When |
   |---|---|
   | `{type:"call", from, from_display, cancel_token}` | Incoming offline call → service worker shows a ringing notification with **Answer** / **Decline** actions. |
   | `{type:"missed_call", from, from_display}` | The pending call timed out. |

4. **Answer** opens the chat page; the server rings on WS reconnect. **Decline** POSTs `{cancel_token}` to `/push/cancel-pending` — no session needed, the unguessable token is the credential.
5. Dead subscriptions (HTTP 400/404/410) are deleted automatically.

## Native push channel

Instead of web-push, the native app's foreground service keeps a WebSocket open and sends `push_register`. The server delivers `call` / `missed_call` payloads over that socket (see above). This avoids third-party push relays entirely.

## Presence API

- `GET /api/v1/calls/presence` → online **mutual followers** `[{id, username, display_name, in_call}]`
- `GET /api/v1/calls/presence/:username` → `{online, in_call}`

These read the in-memory signaling registry (`getOnlineUsers` / `getUserPresence` in `src/webrtc-signaling.js`).
