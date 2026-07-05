# Extrovert

A social network where you can **only discover content from friends and friends-of-friends**. You cannot see anything from people you aren't connected to.

## Features

- **Network-bound discovery.** Your feed only contains posts by you, people you follow (your *friends*), and people they follow (your *friends-of-friends*). Everyone else is invisible.
- **Posts:** text, photos, or videos (uploads stored on disk).
- **Profile pages you can fully customize.** Every user can edit the **HTML and CSS** of their own profile page — **no JavaScript allowed** (scripts, `on*` handlers, `javascript:` URLs, `expression()`, etc. are stripped on save). Put `<!--POSTS-->` in your HTML to choose where your posts render.
- **Social actions:** follow, like, comment, share, repost.
- **A custom feed algorithm** built around how engagement boosts content (see below).

## The feed algorithm

Candidates are pulled only from your network (self + friends + friends-of-friends). Each candidate is scored:

```
score = recencyBase + engagementBoosts + viewerBoosts
```

Boost rules (constants in `src/feed.js`):

| Action | Effect |
|---|---|
| **Follow someone *because of a post*** (the "Follow from post" button) | **BIG boost** to that post (`+1000`) |
| **Share** a post | a little more than a like (`+60`) |
| **Like** a post | small boost (`+30`) |
| **Comment** *and* like a post | small boost to the post (`+30`) |
| **Comment *without* liking** | **no boost to that post at all** — instead the poster's *other* content is boosted, **only for the commenter** (`+50`) |

Engagement always targets the underlying original content (a repost just surfaces content into a new network and never splits engagement). The same original surfacing both directly and via a repost is de-duplicated to its highest-ranked appearance.

Recency base: `400 * exp(-ageHours / 48)`, so fresh content starts high and decays.

## Getting started

```bash
npm install
npm start          # http://localhost:3000
```

Then sign up, find someone by username on the **Discover** page, follow them, and your feed fills with their content and their friends' content.

## Project layout

```
src/
  server.js        Express app, session, route mounting
  db.js            SQLite schema + query helpers (node:sqlite)
  network.js       friends / friends-of-friends visibility rules
  feed.js          the feed algorithm (scoring + boost rules)
  sanitize.js      profile HTML/CSS sanitization (no JS)
  auth.js          auth middleware
  routes/          auth, pages, posts, profile, social
  views/           EJS templates
  public/app.css   default styles
scripts/
  test.js          algorithm + sanitization unit tests (npm test)
  smoke.sh         HTTP end-to-end smoke test
  smoke_media.sh   upload + repost smoke test
```

## Notes

- Storage is SQLite via Node's built-in `node:sqlite` (no native compile needed).
- Profile customization is sanitized server-side with `sanitize-html` plus CSS vector stripping; the sanitized result is also re-checked on render.
- To reset everything: delete `data/extrovert.db` and the `uploads/` directory.
