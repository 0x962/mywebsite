# Excalidraw+ Publishing Pipeline — Design

**Date:** 2026-06-09
**Status:** Approved

## Summary

Stop self-hosting Excalidraw. Posts are authored in Excalidraw+ (excalidraw.com's
hosted product); the site renders each post as a full-viewport iframe of its
read-only share link. Post metadata lives in a single JSON object in Cloudflare
R2. A React admin SPA behind the existing Cloudflare Access gate manages
create/edit/publish/delete. All in-repo Excalidraw code, the KV namespace, and
the MDX post collection are removed.

## Goals

- Author posts entirely in Excalidraw+; publish from the website's admin UI.
- Replace KV with R2 as the only storage.
- Keep Cloudflare Access auth exactly as-is.
- Delete the vendored Excalidraw fork (~1GB submodule) and every dependency
  that existed only to serve it.
- Import the first post ("plot") pointing at its existing read-only link.

## Non-goals

- Scene history / versioning (Excalidraw+ keeps versions on its side).
- Storing `.excalidraw` scene files (Excalidraw+ is the source of truth; local
  exports are the author's personal backup).
- Multi-author support, comments, or any editing on the site itself.

## Architecture

```
Excalidraw+ (authoring, versioning, hosting of readonly embeds)
        │  readonly link, e.g.
        │  https://link.excalidraw.com/readonly/<id>?darkMode=true
        ▼
Admin SPA (/admin, React, behind CF Access) ──writes──► /api/posts* ──► R2 posts.json
                                                                          │
Public pages (/, /post/<slug>, /rss.xml) ◄──────────reads─────────────────┘
```

Rendering is an `<iframe>` of the stored embed URL. Verified 2026-06-09: the
readonly link serves no `X-Frame-Options` or CSP `frame-ancestors`, so
embedding works.

## Data model

R2 bucket `nvdk-posts`, binding `POSTS`. Single object key `posts.json`:

```json
[
  {
    "slug": "plot",
    "title": "Plot",
    "summary": "A living wishlist of features for SuperSet / Conductor.",
    "embedUrl": "https://link.excalidraw.com/readonly/psnMm8Nsg0mNNkHKQwi3?darkMode=true",
    "createdAt": "2026-06-09T...",
    "updatedAt": "2026-06-09T...",
    "published": true
  }
]
```

- Single object = one R2 GET serves homepage, RSS, post pages, and admin list.
- Writes are read-modify-write of the whole array. Single admin, tiny scale —
  no concurrency control needed.
- `slug` is immutable after creation (it is the URL). `embedUrl` must match
  `https://link.excalidraw.com/readonly/...`; query params (e.g. `darkMode`)
  travel with it verbatim.

## API (Astro server endpoints)

| Route | Method | Auth | Behavior |
|---|---|---|---|
| `/api/posts` | GET | admin | Full list including drafts |
| `/api/posts` | POST | admin | Create `{slug,title,summary?,embedUrl,published?}`; 409 on duplicate slug |
| `/api/posts/[slug]` | PATCH | admin | Update any of `title`, `summary`, `embedUrl`, `published` |
| `/api/posts/[slug]` | DELETE | admin | Remove from `posts.json` |

Auth: unchanged `src/lib/auth.ts` — Cloudflare Access JWT (`Cf-Access-Jwt-Assertion`)
verified against team JWKS, `aud` = `CF_ACCESS_AUD`, email in `ADMIN_EMAILS`.
`LOCAL_DEV_BYPASS_AUTH=true` still works for local dev.
`scripts/setup-access.mjs` updated: the consolidated Access app covers `/admin`
and `/api/posts*` only (drop `/api/scenes/*`).

A new `src/lib/posts.ts` owns all R2 access (read list, write list, find by
slug) — the only module that touches the `POSTS` binding. Replaces `scenes.ts`.

## Admin SPA

`/src/pages/admin/index.astro` stays a thin SSR shell (server-side auth check,
404-style rejection for non-admins) and mounts one client-only React app,
`src/components/admin/AdminApp.tsx`:

- **List view** — all posts, published/draft badge, publish toggle (PATCH),
  edit and delete (with confirm) actions, link to public page.
- **Create / edit form** — title, slug (create only), summary, embed URL with
  validation (`link.excalidraw.com/readonly/` prefix), and a live iframe
  preview of the embed before saving.
- Plain React state + fetch; no router or state library — it is one screen
  with a form panel.

`HistoryView.tsx` and `/admin/history/*` are deleted.

## Public pages

- **`/post/[slug].astro`** (SSR): reads `posts.json`; 404 if missing or
  unpublished; renders SEO head (title, summary, canonical, OG tags) and a
  full-viewport iframe of `embedUrl`.
- **Homepage**: keeps the sticky-note canvas look (rough.js `PostIt`
  components); the post list now comes from `posts.json` (published only,
  newest first) instead of `getCollection('posts')` + KV overrides.
- **RSS** (`/rss.xml`): same R2 source; item links go to `/post/<slug>/`.
- **Redirect**: `/wip/plot` → 301 `/post/plot` (the only old canvas URL that
  shipped).

## Removals

- `vendor/excalidraw` submodule; Vite aliases + `messageChannelPolyfill` in
  `astro.config.mjs`; React dedupe config if no longer needed.
- `src/components/excalidraw/` (Canvas + Post wrapper), `src/lib/excalidraw-libs.ts`,
  `src/lib/scenes.ts`.
- Endpoints: `/api/scenes/[slug]`, `/api/history/[slug]`, `/data/scenes/[slug]`,
  `/data/meta/[slug]`.
- `src/content/posts/` MDX collection and `/wip/*` pages.
- KV: `SCENES` binding in `wrangler.toml`, `scripts/seed-kv.mjs`, `seed-kv`
  npm script.
- Admin history UI.

**Kept:** `src/components/canvas/` (homepage/About visuals — rough.js, not
Excalidraw), `auth.ts`, Access setup script, Pages deploy flow, `@astrojs/react`.

## Provisioning & import

1. Create R2 bucket `nvdk-posts` (`wrangler r2 bucket create`), add binding to
   `wrangler.toml`, remove KV binding.
2. Seed `posts.json` with the "plot" post (embed URL above, `published: true`)
   via a one-shot `scripts/seed-posts.mjs` or a direct `wrangler r2 object put`.
3. Re-run `setup-access.mjs` so the Access app paths match the new API surface.

## Error handling

- Missing/corrupt `posts.json` → treated as empty list on reads; admin create
  re-initializes it.
- R2 write failure → API returns 500; admin surfaces the error inline.
- Invalid embed URL → 400 from API + client-side validation in the form.
- Unpublished post requested publicly → 404 (no information leak).

## Testing

- Local: `astro dev` with `LOCAL_DEV_BYPASS_AUTH=true` and a local R2
  simulation (wrangler/miniflare binding via `astro dev` platform proxy);
  exercise create → preview → publish → homepage/RSS/post page → unpublish →
  delete.
- Build: `npm run build` must pass with the submodule gone.
- Deploy: `npm run deploy`, then verify `/post/plot` renders the embed, `/`
  lists it, `/admin` gated by Access, write APIs reject unauthenticated PUTs.
