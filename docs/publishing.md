# Publishing posts

Posts are authored in **Excalidraw+** (excalidraw.com). The site stores only
metadata — title, summary, publish state, and the readonly share link — in a
single `posts.json` object in the `nvdk-posts` R2 bucket. Post pages render
the share link in a full-viewport iframe.

## Workflow

1. Draw the post in Excalidraw+.
2. Share → copy the **read-only link** (`https://link.excalidraw.com/readonly/...`).
   Append `?darkMode=true` to match the site theme.
3. Open `https://nvdk.co/admin` (Cloudflare Access challenge → email allowlist).
4. **new post** → slug, title, summary, paste the embed url (live preview
   renders below the form) → save → **publish**.

Edits to the drawing are live immediately — the iframe always shows the
current state of the Excalidraw+ scene. Version history lives in Excalidraw+.

## Where things live

| Thing | Place |
|---|---|
| Scene content + history | Excalidraw+ |
| Post metadata (`posts.json`) | R2 bucket `nvdk-posts` (binding `POSTS`) |
| Store module | `src/lib/posts.ts` (only code touching the bucket) |
| Admin SPA | `src/components/admin/AdminApp.tsx`, shell at `src/pages/admin/index.astro` |
| Write API | `src/pages/api/posts/index.ts`, `src/pages/api/posts/[slug].ts` |
| Public pages | `/` (sticky notes), `/post/<slug>` (iframe), `/rss.xml` |
| Auth | Cloudflare Access JWT (`src/lib/auth.ts`); app managed by `scripts/setup-access.mjs` |

## Operational notes

- Local dev: `npm run dev` with `LOCAL_DEV_BYPASS_AUTH=true` in `.dev.vars`;
  the R2 binding is simulated locally. `npm run seed-posts` seeds the local
  bucket (`--remote` targets production, `--force` overwrites).
- A draft may have an empty embed url; publishing requires a valid one.
- Deleting a post only removes the `posts.json` entry — the Excalidraw+
  scene is untouched.
- Old `/wip/<slug>` URLs 301 to `/post/<slug>` (configured in `astro.config.mjs`).
