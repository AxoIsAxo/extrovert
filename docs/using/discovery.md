# Discovery & search

The only way to meet people is the **Discover** page (`/discover`) and the search box on the feed.

## Discover page

Two sections:

1. **Search** — search by username or display name. Exact username matches sort first, then prefix matches, then substring matches.
2. **Suggested for you** — friends-of-friends you don't follow yet, up to 12 suggestions ("expand your network"). These are people two hops away via your existing follow graph; following them grows your visible world.

Search results exclude yourself and banned accounts.

### Search rules

- Matches are case-insensitive substring matches on `username` or `display_name`.
- A length heuristic (`len(query) / 0.15`) keeps results sane.
- **User search is not network-bound** — you can look up any username, so you can find someone to follow by name. Post search *is* network-bound (below).

## Searching posts

The search box on the feed and the API endpoint `GET /api/v1/search?type=statuses` search **post bodies and author display names** — but only among authors in your visible set (you + friends + friends-of-friends). Posts outside your network simply never appear.

## The feed's "suggested" sidebar

The home page also shows the same friends-of-friends suggestions, plus your discovery search results inline.

## Direct links

Any user can be reached directly at `/u/<username>` and any post at `/posts/<id>` — but only users who can see the content (network check) will see it; everyone else gets redirected or a 404.

## Search API

See [API endpoint reference](../developers/endpoints.md#search) for `GET /api/v1/search` (`type=accounts`, `type=statuses`, or both by default).
