# Notifications

The bell in the navigation opens your inbox (`/inbox`) and shows an unread badge.

## What generates a notification

| Type | Trigger |
|---|---|
| `follow` | Someone follows you |
| `like` | Someone likes one of your posts |
| `comment` | Someone comments on one of your posts |
| `share` | Someone shares one of your posts |
| `message` | Someone sends you a DM |
| `missed_call` | Someone tried to call you while you were offline |

Notifications about your own actions are suppressed. Opening the inbox marks everything as read (the badge comes from `countUnreadNotifications`).

## Web inbox

- `/inbox` shows the 100 most recent notifications, newest first, then marks them read.
- The nav badge (and the rooms badge for pending reports on the admin nav) updates per request.

## API

All endpoints require the `notifications` scope:

| Endpoint | Purpose |
|---|---|
| `GET /api/v1/notifications` | List, newest first, cursor-paginated (`limit` default 20, max 40). Each item carries `type`, `created_at`, `read`, the actor `account`, and the related `post_id`. |
| `POST /api/v1/notifications/clear` | Mark all as read. |
| `GET /api/v1/notifications/unread_count` | `{ "data": { "count": N } }` — for badges on native clients. |
| `GET /api/v1/notifications/stream` | **Server-sent events** — push live notifications to the client (see below). |

### SSE stream

`GET /api/v1/notifications/stream` (Bearer token, `notifications` scope) keeps an open SSE connection:

```
event: connected
data: {}

event: notification
data: {"id":1,"type":"like","actor_id":5,"post_id":9,"created_at":…}

: heartbeat          (every 15 s)
```

The server pushes each new notification the moment it is created (in-process event emitter, `src/notif-broadcaster.js`). Heartbeats keep proxies from closing the connection. See [Realtime](../developers/realtime.md) for details.

## Web push

Browsers with push enabled (VAPID configured, service worker active) get system notifications for **incoming calls** — ringing, with Answer / Decline actions — and **missed calls**. See [Calls](calls.md) and [Realtime](../developers/realtime.md).

## Rooms moderation notifications

Admins see a pending-reports badge in the nav (`/admin` shows the queue). See [Admin](admin.md).
