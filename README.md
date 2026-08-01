# Extrovert

A social network where you can **only discover content from friends and friends-of-friends**. You cannot see anything from people you aren't connected to — there is no public timeline, no firehose, no algorithm mining the whole internet. Just your network.

The signature motif is three concentric rings: **you** (inner), your **friends** (middle), and your **friends-of-friends** (outer).

```
┌───────────────────────────────────────────┐
│   o o o o o o o o o o   friends-of-friends │  visible content
│   o  ┌─────────────────┐  o               │
│   o  │ o o o o o o o   │  o   friends     │  visible content
│   o  │ o  ┌─────────┐  │  o               │
│   o  │ o  │   you   │  │  o               │  your own content
│   o  │ o  └─────────┘  │  o               │
│   o  │ o o o o o o o   │  o               │
│   o  └─────────────────┘  o               │
│   o o o o o o o o o o   │                  │
└──────────────────────────┘                  │
    everyone else: invisible                 │
```

## Feature overview

| Area | What you get |
|---|---|
| **Posts** | Text, photo, or video posts; reposts; comment threads; edit history; full deletion |
| **Feed** | A deterministic, explained ranking algorithm over your network only (see [Feed](docs/using/feed.md)) |
| **Profiles** | Fully customizable profile pages — every user can write their own **HTML and CSS** (no JavaScript) |
| **Social** | Follow, like, comment, share, repost, "follow because of a post" |
| **Discovery** | [Discover](docs/using/discovery.md) page: search users, friend-of-friend suggestions, network-bound post search |
| **Messaging** | End-to-end-encrypted direct messages between mutual followers (Signal-style Olm) |
| **Rooms** | Group spaces with channels (text + voice), role-based permissions, E2EE group chat (Megolm), voice calls |
| **Calls** | Peer-to-peer WebRTC calls with presence, offline-call rings, and push wake-ups |
| **Notifications** | Inbox, unread badges, realtime SSE stream, web push |
| **Stickers** | Personal sticker packs usable in posts, comments, and messages |
| **Admin** | Bans, user deletion, promotions, room moderation, reports queue, server-wide announcement |
| **API** | Full REST API (OAuth 2.0 + OpenID Connect, PKCE) with an OpenAPI spec and Swagger UI |

## Quick start

```bash
npm install
npm start          # http://localhost:3000
```

You must set a `SESSION_SECRET` environment variable before the server will start. See [Getting started](docs/getting-started.md) and [Configuration](docs/configuration.md).

## Documentation index

**Basics**

- [Overview & concepts](docs/overview.md) — the network model, terminology
- [Getting started](docs/getting-started.md) — install, first run, day-one usage
- [Configuration](docs/configuration.md) — environment variables, Docker, reverse proxy, push keys

**Using Extrovert**

- [Posts & the feed algorithm](docs/using/feed.md)
- [Profiles & customization](docs/using/profiles.md)
- [Discovery & search](docs/using/discovery.md)
- [Notifications](docs/using/notifications.md)
- [Direct messages (E2EE)](docs/using/messaging.md)
- [Rooms & voice channels](docs/using/rooms.md)
- [Calls & presence](docs/using/calls.md)
- [Stickers](docs/using/stickers.md)
- [Settings & account](docs/using/settings.md)
- [Admin guide](docs/using/admin.md)

**For developers**

- [REST API overview](docs/developers/api-overview.md)
- [API endpoint reference](docs/developers/endpoints.md)
- [OAuth 2.0 & OpenID Connect](docs/developers/oauth-oidc.md)
- [Realtime: WebSocket, SSE, push](docs/developers/realtime.md)

**Reference**

- [Security model](docs/security.md)
- [Development & testing](docs/development.md)
- [FAQ](docs/faq.md)

## License

Extrovert is free software: you can redistribute it and/or modify it under the terms of the **GNU General Public License, version 3 or any later version** — see [LICENSE](LICENSE) for the full text. It is distributed in the hope that it will be useful, but **without any warranty**; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GPLv3 for details.

The app includes bundled third-party software under their own licenses (e.g. [`@matrix-org/olm`](https://gitlab.matrix.org/matrix-org/olm) under the Apache-2.0 license).
