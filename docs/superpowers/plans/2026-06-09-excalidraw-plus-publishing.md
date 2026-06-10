# Excalidraw+ Publishing Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Posts are authored in Excalidraw+ and rendered as readonly iframe embeds; metadata lives in one `posts.json` object in R2; a React admin SPA behind the existing Cloudflare Access gate manages them; all in-repo Excalidraw code, KV, and the MDX collection are removed.

**Architecture:** `src/lib/posts.ts` is the only module touching the `POSTS` R2 binding. Astro API endpoints (`/api/posts*`) wrap it with the existing Access-JWT auth. Public pages (`/`, `/post/[slug]`, `/rss.xml`) read the same list server-side. The admin page is a thin SSR auth shell mounting a client-only React app.

**Tech Stack:** Astro 5 (SSR, `@astrojs/cloudflare`), React 19 island, Cloudflare R2 + Pages + Access, Vitest for unit tests.

**Spec:** `docs/superpowers/specs/2026-06-09-excalidraw-plus-publishing-design.md`

---

## Reference: the seed data

Three existing posts migrate. Only `plot` has an Excalidraw+ embed; the other two stay drafts (empty `embedUrl`) until recreated in Excalidraw+.

```json
[
  {
    "slug": "plot",
    "title": "Plot: My wishlist for SuperSet",
    "summary": "A living wishlist for the agent tools I use all day. Make the diff the main surface and let me comment on it. Show me the change in plain English with a reason on every edit. Treat context like git. And surface the to-do list the agent already keeps.",
    "embedUrl": "https://link.excalidraw.com/readonly/psnMm8Nsg0mNNkHKQwi3?darkMode=true",
    "createdAt": "2026-05-28T00:00:00.000Z",
    "updatedAt": "2026-06-09T00:00:00.000Z",
    "published": true
  },
  {
    "slug": "prompt",
    "title": "PromptHub",
    "summary": "",
    "embedUrl": "",
    "createdAt": "2026-05-28T00:00:00.000Z",
    "updatedAt": "2026-06-09T00:00:00.000Z",
    "published": false
  },
  {
    "slug": "browser-plugin-for-ui-design",
    "title": "Two ways to change a UI",
    "summary": "Two ways to spin up modified versions of our UI fast with AI — copy the frontend and edit the copy, or edit the real product live in the browser — and what each would actually take.",
    "embedUrl": "",
    "createdAt": "2026-05-27T00:00:00.000Z",
    "updatedAt": "2026-06-09T00:00:00.000Z",
    "published": false
  }
]
```

---

### Task 1: Vitest setup

**Files:**
- Modify: `package.json` (add devDep + script)

- [ ] **Step 1: Install vitest**

```bash
npm install -D vitest
```

- [ ] **Step 2: Add test script to package.json** — in `"scripts"`, add:

```json
"test": "vitest run"
```

- [ ] **Step 3: Verify it runs (no tests yet = exit 1 with "No test files found", that's expected)**

Run: `npm test`
Expected: "No test files found"

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add vitest"
```

### Task 2: `src/lib/posts.ts` (R2 post store) — TDD

**Files:**
- Create: `src/lib/posts.test.ts`
- Create: `src/lib/posts.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/posts.test.ts
import { describe, expect, it } from 'vitest';
import {
  isEmbedUrl,
  isSlug,
  POSTS_KEY,
  publishedPosts,
  readAllPosts,
  writeAllPosts,
  type Post,
} from './posts';

/** Minimal in-memory stand-in for the two R2Bucket methods posts.ts uses. */
function fakeBucket(initial?: string) {
  const store = new Map<string, string>();
  if (initial !== undefined) store.set(POSTS_KEY, initial);
  return {
    store,
    async get(key: string) {
      const v = store.get(key);
      return v === undefined ? null : { text: async () => v };
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
  } as unknown as R2Bucket & { store: Map<string, string> };
}

const post = (over: Partial<Post> = {}): Post => ({
  slug: 'plot',
  title: 'Plot',
  summary: '',
  embedUrl: 'https://link.excalidraw.com/readonly/psnMm8Nsg0mNNkHKQwi3?darkMode=true',
  createdAt: '2026-05-28T00:00:00.000Z',
  updatedAt: '2026-06-09T00:00:00.000Z',
  published: true,
  ...over,
});

describe('isSlug', () => {
  it('accepts kebab slugs', () => expect(isSlug('plot-2')).toBe(true));
  it('rejects uppercase/slashes/empty', () => {
    expect(isSlug('Plot')).toBe(false);
    expect(isSlug('a/b')).toBe(false);
    expect(isSlug('')).toBe(false);
    expect(isSlug(42)).toBe(false);
  });
});

describe('isEmbedUrl', () => {
  it('accepts readonly excalidraw links incl. query params', () => {
    expect(isEmbedUrl('https://link.excalidraw.com/readonly/abc123?darkMode=true')).toBe(true);
    expect(isEmbedUrl('https://link.excalidraw.com/readonly/abc123')).toBe(true);
  });
  it('rejects other urls', () => {
    expect(isEmbedUrl('https://link.excalidraw.com/l/abc/def')).toBe(false);
    expect(isEmbedUrl('https://evil.com/readonly/abc')).toBe(false);
    expect(isEmbedUrl('')).toBe(false);
    expect(isEmbedUrl(null)).toBe(false);
  });
});

describe('readAllPosts', () => {
  it('returns [] when object missing', async () => {
    expect(await readAllPosts(fakeBucket())).toEqual([]);
  });
  it('returns [] on corrupt json', async () => {
    expect(await readAllPosts(fakeBucket('{nope'))).toEqual([]);
  });
  it('round-trips through writeAllPosts and drops malformed entries', async () => {
    const b = fakeBucket();
    await writeAllPosts(b, [post()]);
    b.store.set(POSTS_KEY, JSON.stringify([...JSON.parse(b.store.get(POSTS_KEY)!), { junk: true }]));
    expect(await readAllPosts(b)).toEqual([post()]);
  });
});

describe('publishedPosts', () => {
  it('filters drafts and sorts newest first', () => {
    const a = post({ slug: 'a', createdAt: '2026-01-01T00:00:00.000Z' });
    const b = post({ slug: 'b', createdAt: '2026-02-01T00:00:00.000Z' });
    const d = post({ slug: 'd', published: false });
    expect(publishedPosts([a, d, b]).map((p) => p.slug)).toEqual(['b', 'a']);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — cannot resolve `./posts`

- [ ] **Step 3: Implement `src/lib/posts.ts`**

```ts
/**
 * R2-backed post store. Posts are authored in Excalidraw+; we keep only
 * metadata + the readonly embed URL, all in a single `posts.json` object.
 * This module is the only code that touches the POSTS bucket.
 */

export interface Post {
  slug: string;
  title: string;
  summary: string;
  /** Excalidraw+ readonly link. Empty string allowed while unpublished. */
  embedUrl: string;
  createdAt: string; // ISO
  updatedAt: string; // ISO
  published: boolean;
}

export const POSTS_KEY = 'posts.json';

const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const isSlug = (s: unknown): s is string => typeof s === 'string' && SLUG.test(s);

const EMBED = /^https:\/\/link\.excalidraw\.com\/readonly\/[A-Za-z0-9_-]+(\?.*)?$/;
export const isEmbedUrl = (u: unknown): u is string => typeof u === 'string' && EMBED.test(u);

function isPost(p: unknown): p is Post {
  if (typeof p !== 'object' || p === null) return false;
  const x = p as Record<string, unknown>;
  return (
    isSlug(x.slug) &&
    typeof x.title === 'string' &&
    typeof x.summary === 'string' &&
    typeof x.embedUrl === 'string' &&
    typeof x.createdAt === 'string' &&
    typeof x.updatedAt === 'string' &&
    typeof x.published === 'boolean'
  );
}

/** Missing or corrupt posts.json reads as an empty list — never throws. */
export async function readAllPosts(bucket: R2Bucket): Promise<Post[]> {
  const obj = await bucket.get(POSTS_KEY);
  if (!obj) return [];
  try {
    const arr = JSON.parse(await obj.text());
    return Array.isArray(arr) ? arr.filter(isPost) : [];
  } catch {
    return [];
  }
}

export async function writeAllPosts(bucket: R2Bucket, posts: Post[]): Promise<void> {
  await bucket.put(POSTS_KEY, JSON.stringify(posts, null, 2), {
    httpMetadata: { contentType: 'application/json' },
  });
}

export const publishedPosts = (posts: Post[]): Post[] =>
  posts.filter((p) => p.published).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS (all)

- [ ] **Step 5: Commit**

```bash
git add src/lib/posts.ts src/lib/posts.test.ts
git commit -m "feat: R2-backed post store (posts.json)"
```

### Task 3: Swap the runtime binding (KV → R2)

**Files:**
- Modify: `src/lib/auth.ts:41-47` (RuntimeEnv)
- Modify: `wrangler.toml`

- [ ] **Step 1: In `src/lib/auth.ts`, replace the `RuntimeEnv` interface**

```ts
export interface RuntimeEnv {
  POSTS: R2Bucket;
  ADMIN_EMAILS?: string;
  CF_ACCESS_TEAM_DOMAIN?: string;
  CF_ACCESS_AUD?: string;
  LOCAL_DEV_BYPASS_AUTH?: string;
}
```

- [ ] **Step 2: Create the production bucket**

Run: `npx wrangler r2 bucket create nvdk-posts`
Expected: "Created bucket 'nvdk-posts'"

- [ ] **Step 3: In `wrangler.toml`, replace the `[[kv_namespaces]]` block (and its "Scene storage" comment) with**

```toml
# Post storage. Single object "posts.json" in R2 — the full list of posts
# (slug, title, summary, Excalidraw+ readonly embed URL, publish state).
[[r2_buckets]]
binding = "POSTS"
bucket_name = "nvdk-posts"
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/auth.ts wrangler.toml
git commit -m "feat: POSTS R2 binding replaces SCENES KV"
```

(The build is broken until Tasks 4–6 land — endpoints/pages still import `scenes.ts`. That's fine; commits stay small and the suite at the end of Task 6 verifies the whole.)

### Task 4: Rewrite `/api/posts` endpoints over R2

**Files:**
- Rewrite: `src/pages/api/posts/index.ts`
- Rewrite: `src/pages/api/posts/[slug].ts`

- [ ] **Step 1: Replace `src/pages/api/posts/index.ts` entirely with**

```ts
import type { APIRoute } from 'astro';
import { authenticate, requireAdmin, type RuntimeEnv } from '../../../lib/auth';
import { isEmbedUrl, isSlug, readAllPosts, writeAllPosts, type Post } from '../../../lib/posts';

export const prerender = false;

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

function env(locals: App.Locals): RuntimeEnv {
  const runtime = (locals as { runtime?: { env: RuntimeEnv } }).runtime;
  if (!runtime?.env?.POSTS) throw new Error('POSTS R2 binding missing');
  return runtime.env;
}

// GET: admin-only full list (drafts included).
export const GET: APIRoute = async ({ request, locals }) => {
  const e = env(locals);
  const denied = await requireAdmin(request, e);
  if (denied) return denied;
  return json({ posts: await readAllPosts(e.POSTS) });
};

// POST: admin-only create.
// Body { slug, title, summary?, embedUrl?, published? }. A published post
// must carry a valid Excalidraw+ readonly embedUrl; drafts may leave it ''.
export const POST: APIRoute = async ({ request, locals }) => {
  const e = env(locals);
  const auth = await authenticate(request, e);
  if ('denied' in auth) return auth.denied;

  let body: unknown;
  try { body = await request.json(); } catch { return json({ error: 'invalid json' }, 400); }
  const b = body as Record<string, unknown>;

  if (!isSlug(b.slug)) return json({ error: 'slug must be [a-z0-9-]' }, 400);
  if (typeof b.title !== 'string' || !b.title.trim()) return json({ error: 'title required' }, 400);
  const embedUrl = b.embedUrl === undefined || b.embedUrl === '' ? '' : b.embedUrl;
  if (embedUrl !== '' && !isEmbedUrl(embedUrl)) {
    return json({ error: 'embedUrl must be a https://link.excalidraw.com/readonly/... link' }, 400);
  }
  const published = b.published === true;
  if (published && embedUrl === '') return json({ error: 'published post needs an embedUrl' }, 400);

  const posts = await readAllPosts(e.POSTS);
  if (posts.some((p) => p.slug === b.slug)) return json({ error: 'slug taken' }, 409);

  const now = new Date().toISOString();
  const post: Post = {
    slug: b.slug,
    title: b.title.trim(),
    summary: typeof b.summary === 'string' ? b.summary.trim() : '',
    embedUrl,
    createdAt: now,
    updatedAt: now,
    published,
  };
  await writeAllPosts(e.POSTS, [...posts, post]);
  return json({ ok: true, post }, 201);
};
```

- [ ] **Step 2: Replace `src/pages/api/posts/[slug].ts` entirely with**

```ts
import type { APIRoute } from 'astro';
import { authenticate, type RuntimeEnv } from '../../../lib/auth';
import { isEmbedUrl, isSlug, readAllPosts, writeAllPosts, type Post } from '../../../lib/posts';

/**
 * Per-post admin actions.
 *   PATCH  /api/posts/<slug>  { title?, summary?, embedUrl?, published? }
 *   DELETE /api/posts/<slug>
 */
export const prerender = false;

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

function env(locals: App.Locals): RuntimeEnv {
  const runtime = (locals as { runtime?: { env: RuntimeEnv } }).runtime;
  if (!runtime?.env?.POSTS) throw new Error('POSTS R2 binding missing');
  return runtime.env;
}

export const PATCH: APIRoute = async ({ params, request, locals }) => {
  if (!isSlug(params.slug)) return json({ error: 'bad slug' }, 400);
  const e = env(locals);
  const auth = await authenticate(request, e);
  if ('denied' in auth) return auth.denied;

  let body: Record<string, unknown>;
  try { body = (await request.json()) as typeof body; } catch { return json({ error: 'invalid json' }, 400); }

  const posts = await readAllPosts(e.POSTS);
  const i = posts.findIndex((p) => p.slug === params.slug);
  if (i === -1) return json({ error: 'post not found' }, 404);

  const next: Post = { ...posts[i] };
  if (body.title !== undefined) {
    if (typeof body.title !== 'string' || !body.title.trim()) return json({ error: 'title must be non-empty' }, 400);
    next.title = body.title.trim();
  }
  if (body.summary !== undefined) {
    if (typeof body.summary !== 'string') return json({ error: 'summary must be a string' }, 400);
    next.summary = body.summary.trim();
  }
  if (body.embedUrl !== undefined) {
    if (body.embedUrl !== '' && !isEmbedUrl(body.embedUrl)) {
      return json({ error: 'embedUrl must be a https://link.excalidraw.com/readonly/... link' }, 400);
    }
    next.embedUrl = body.embedUrl as string;
  }
  if (body.published !== undefined) {
    if (typeof body.published !== 'boolean') return json({ error: 'published must be boolean' }, 400);
    next.published = body.published;
  }
  if (next.published && next.embedUrl === '') {
    return json({ error: 'published post needs an embedUrl' }, 400);
  }
  next.updatedAt = new Date().toISOString();

  const updated = [...posts];
  updated[i] = next;
  await writeAllPosts(e.POSTS, updated);
  return json({ ok: true, post: next });
};

export const DELETE: APIRoute = async ({ params, request, locals }) => {
  if (!isSlug(params.slug)) return json({ error: 'bad slug' }, 400);
  const e = env(locals);
  const auth = await authenticate(request, e);
  if ('denied' in auth) return auth.denied;

  const posts = await readAllPosts(e.POSTS);
  if (!posts.some((p) => p.slug === params.slug)) return json({ error: 'post not found' }, 404);
  await writeAllPosts(e.POSTS, posts.filter((p) => p.slug !== params.slug));
  return json({ ok: true });
};
```

- [ ] **Step 3: Commit**

```bash
git add src/pages/api/posts/index.ts "src/pages/api/posts/[slug].ts"
git commit -m "feat: /api/posts CRUD over R2 posts.json"
```

### Task 5: Public pages — post page, homepage, RSS, redirects

**Files:**
- Rewrite: `src/pages/post/[slug].astro`
- Modify: `src/pages/index.astro` (data source + post-it hrefs; remove `/data/meta` script)
- Rewrite: `src/pages/rss.xml.ts`
- Modify: `astro.config.mjs` (redirects)

- [ ] **Step 1: Replace `src/pages/post/[slug].astro` entirely with**

```astro
---
/**
 * /post/<slug> — a post authored in Excalidraw+, rendered as a full-viewport
 * iframe of its readonly share link. Metadata comes from posts.json in R2.
 */
export const prerender = false;

import '../../styles/global.css';
import '@fontsource/caveat/400.css';
import '@fontsource/caveat/600.css';
import TopBar from '../../components/TopBar.astro';
import { isSlug, readAllPosts } from '../../lib/posts';

const slug = Astro.params.slug;
if (!isSlug(slug)) return new Response('not found', { status: 404 });

const posts = await readAllPosts(Astro.locals.runtime.env.POSTS);
const post = posts.find((p) => p.slug === slug);
// Unpublished posts 404 publicly — same response as missing, no info leak.
if (!post || !post.published || !post.embedUrl) return new Response('not found', { status: 404 });

const canonical = new URL(`/post/${slug}/`, Astro.site);
const ogImage = new URL('/og-default.png', Astro.site);
const pageTitle = `${post.title} — Navid Khan — WIP`;
---
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="generator" content={Astro.generator} />
    <meta name="author" content="Navid Khan" />
    <meta name="theme-color" content="#0a0a0b" />
    <link rel="icon" type="image/png" href="/favicon.png" />
    <link rel="canonical" href={canonical.toString()} />
    <title>{pageTitle}</title>
    <meta name="description" content={post.summary} />
    <meta property="og:type" content="article" />
    <meta property="og:title" content={pageTitle} />
    <meta property="og:description" content={post.summary} />
    <meta property="og:url" content={canonical.toString()} />
    <meta property="og:image" content={ogImage.toString()} />
    <style>
      html, body { margin: 0; height: 100%; background: #0a0a0b; }
      .post-embed {
        position: fixed;
        top: var(--topbar-height, 56px);
        left: 0; right: 0; bottom: 0;
        width: 100%;
        height: calc(100% - var(--topbar-height, 56px));
        border: 0;
        display: block;
      }
    </style>
  </head>
  <body>
    <TopBar />
    <iframe
      class="post-embed"
      src={post.embedUrl}
      title={post.title}
      loading="eager"
      allowfullscreen
    ></iframe>
  </body>
</html>
```

- [ ] **Step 2: Update `src/pages/index.astro`** — three changes:

(a) Replace the imports + post loading block (lines 10–28: the `getCollection`/`readManyOverrides` imports and the `allPosts`/`overrides`/`posts` consts) with:

```ts
import { publishedPosts, readAllPosts } from '../lib/posts';

const posts = publishedPosts(await readAllPosts(Astro.locals.runtime.env.POSTS));
```

(b) Replace the posts `.map()` JSX (the block rendering `Place`+`PostIt` per post) with — note `post.slug` replaces the `.mdx` id munging and the href moves to `/post/`:

```jsx
{posts.map((post, i) => {
  const s = slotFor(i);
  const layoutId = `post-${post.slug}`;
  return (
    <Place
      id={layoutId} saved={layout[layoutId]}
      x={s.desktop.x} y={s.desktop.y} rotate={s.desktop.rotate} z={s.desktop.z} w={s.desktop.w}
      tablet={s.tablet}
      mobile={s.mobile}
    >
      <PostIt
        href={`/post/${post.slug}/`}
        title={post.title}
        summary={post.summary || undefined}
        date={fmtDate(new Date(post.createdAt))}
        color={s.color}
        slug={post.slug}
      />
    </Place>
  );
})}
```

(c) Delete the whole `<script is:inline>` block (the "edited X ago" hydrator — `/data/meta/` is gone; edits now happen in Excalidraw+ where we can't see timestamps).

- [ ] **Step 3: Replace `src/pages/rss.xml.ts` entirely with**

```ts
// SSR so publish toggles apply without a rebuild.
export const prerender = false;

import rss from '@astrojs/rss';
import type { APIContext } from 'astro';
import { publishedPosts, readAllPosts } from '../lib/posts';

export async function GET(context: APIContext) {
  const posts = publishedPosts(await readAllPosts(context.locals.runtime.env.POSTS));

  return rss({
    title: 'Navid Khan — WIP',
    description: 'Work-in-progress notes, essays, and rough drafts by Navid Khan.',
    site: context.site!,
    items: posts.map((post) => ({
      title: post.title,
      pubDate: new Date(post.createdAt),
      description: post.summary,
      link: `/post/${post.slug}/`,
    })),
    customData: `<language>en-us</language>`,
  });
}
```

- [ ] **Step 4: Add redirects in `astro.config.mjs`** — inside `defineConfig({ ... })`, next to `output`:

```js
// Old canvas-post URLs. Posts live at /post/<slug> now.
redirects: { '/wip/[slug]': '/post/[slug]' },
```

- [ ] **Step 5: Commit**

```bash
git add "src/pages/post/[slug].astro" src/pages/index.astro src/pages/rss.xml.ts astro.config.mjs
git commit -m "feat: public pages read R2; posts render as Excalidraw+ embeds"
```

### Task 6: Admin SPA

**Files:**
- Create: `src/components/admin/AdminApp.tsx`
- Rewrite: `src/pages/admin/index.astro`
- Delete: `src/components/admin/AdminDashboard.tsx`, `src/components/admin/HistoryView.tsx`, `src/pages/admin/history/[slug].astro`, `src/pages/api/history/[slug].ts`
- Keep/extend: `src/components/admin/admin.css`

- [ ] **Step 1: Create `src/components/admin/AdminApp.tsx`**

```tsx
import { useCallback, useEffect, useState } from "react";
import "./admin.css";

interface Post {
  slug: string;
  title: string;
  summary: string;
  embedUrl: string;
  createdAt: string;
  updatedAt: string;
  published: boolean;
}

type Draft = Pick<Post, "slug" | "title" | "summary" | "embedUrl">;

const EMPTY: Draft = { slug: "", title: "", summary: "", embedUrl: "" };
const EMBED_PREFIX = "https://link.excalidraw.com/readonly/";

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

async function api(path: string, init?: RequestInit): Promise<{ ok: boolean; status: number; body: any }> {
  const res = await fetch(path, {
    headers: { "content-type": "application/json" },
    ...init,
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body };
}

export default function AdminApp() {
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [error, setError] = useState("");
  const [busySlug, setBusySlug] = useState<string | null>(null);
  /** null = closed, "" = create form, "<slug>" = editing that post */
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const r = await api("/api/posts");
    if (!r.ok) {
      setError(r.body.error || `failed to load posts (${r.status})`);
      return;
    }
    setPosts(r.body.posts);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const openCreate = () => { setDraft(EMPTY); setEditing(""); setError(""); };
  const openEdit = (p: Post) => {
    setDraft({ slug: p.slug, title: p.title, summary: p.summary, embedUrl: p.embedUrl });
    setEditing(p.slug);
    setError("");
  };

  const save = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      const r = editing === ""
        ? await api("/api/posts", { method: "POST", body: JSON.stringify(draft) })
        : await api(`/api/posts/${encodeURIComponent(editing!)}`, {
            method: "PATCH",
            body: JSON.stringify({ title: draft.title, summary: draft.summary, embedUrl: draft.embedUrl }),
          });
      if (!r.ok) {
        setError(r.body.error || `save failed (${r.status})`);
        return;
      }
      setEditing(null);
      await load();
    } finally {
      setSaving(false);
    }
  }, [draft, editing, load]);

  const togglePublish = useCallback(async (p: Post) => {
    setError("");
    setBusySlug(p.slug);
    try {
      const r = await api(`/api/posts/${encodeURIComponent(p.slug)}`, {
        method: "PATCH",
        body: JSON.stringify({ published: !p.published }),
      });
      if (!r.ok) {
        setError(r.body.error || `toggle failed (${r.status})`);
        return;
      }
      setPosts((prev) => prev!.map((row) => (row.slug === p.slug ? r.body.post : row)));
    } finally {
      setBusySlug(null);
    }
  }, []);

  const remove = useCallback(async (p: Post) => {
    if (!window.confirm(`Delete "${p.title}" (${p.slug})? The Excalidraw+ scene is untouched; only the post entry goes away.`)) return;
    setError("");
    setBusySlug(p.slug);
    try {
      const r = await api(`/api/posts/${encodeURIComponent(p.slug)}`, { method: "DELETE" });
      if (!r.ok) {
        setError(r.body.error || `delete failed (${r.status})`);
        return;
      }
      setPosts((prev) => prev!.filter((row) => row.slug !== p.slug));
    } finally {
      setBusySlug(null);
    }
  }, []);

  const previewUrl = draft.embedUrl.startsWith(EMBED_PREFIX) ? draft.embedUrl : "";

  if (posts === null) {
    return <div className="admin-root"><main><h1>admin</h1><div className="sub">{error || "loading…"}</div></main></div>;
  }

  return (
    <div className="admin-root">
      <main>
        <h1>admin</h1>
        <div className="sub">
          {posts.length} {posts.length === 1 ? "post" : "posts"} · authored in Excalidraw+, published here
        </div>
        <div className="admin-err">{error}</div>

        {editing === null ? (
          <button className="admin-btn-primary" onClick={openCreate}>new post</button>
        ) : (
          <div className="admin-card">
            <h2>{editing === "" ? "new post" : `edit: ${editing}`}</h2>
            <form onSubmit={save}>
              {editing === "" && (
                <div className="admin-row">
                  <label htmlFor="slug">slug</label>
                  <input id="slug" type="text" required pattern="[a-z0-9][a-z0-9-]{0,63}"
                    placeholder="my-new-post" autoComplete="off" value={draft.slug}
                    onChange={(e) => setDraft((s) => ({ ...s, slug: e.target.value }))} />
                </div>
              )}
              <div className="admin-row">
                <label htmlFor="title">title</label>
                <input id="title" type="text" required placeholder="My New Post" autoComplete="off"
                  value={draft.title} onChange={(e) => setDraft((s) => ({ ...s, title: e.target.value }))} />
              </div>
              <div className="admin-row">
                <label htmlFor="summary">summary</label>
                <input id="summary" type="text" placeholder="optional" autoComplete="off"
                  value={draft.summary} onChange={(e) => setDraft((s) => ({ ...s, summary: e.target.value }))} />
              </div>
              <div className="admin-row">
                <label htmlFor="embedUrl">embed url</label>
                <input id="embedUrl" type="url" placeholder={`${EMBED_PREFIX}…`} autoComplete="off"
                  value={draft.embedUrl} onChange={(e) => setDraft((s) => ({ ...s, embedUrl: e.target.value }))} />
              </div>
              {draft.embedUrl && !previewUrl && (
                <div className="admin-err">embed url must start with {EMBED_PREFIX}</div>
              )}
              {previewUrl && (
                <iframe className="admin-preview" src={previewUrl} title="embed preview" loading="lazy" />
              )}
              <button type="submit" className="admin-btn-primary" disabled={saving || Boolean(draft.embedUrl && !previewUrl)}>
                {saving ? "…" : "save"}
              </button>
              <button type="button" className="admin-btn" onClick={() => setEditing(null)}>cancel</button>
            </form>
          </div>
        )}

        <ul className="admin-list">
          {posts.map((p) => {
            const busy = busySlug === p.slug;
            return (
              <li key={p.slug}>
                <a className="admin-post-link" href={`/post/${p.slug}/`}>
                  <div className="admin-title">
                    <span className={`admin-status ${p.published ? "admin-status-published" : "admin-status-draft"}`}>
                      {p.published ? "published" : "draft"}
                    </span>
                    {p.title}
                  </div>
                  <div className="admin-meta">
                    {p.slug} · {fmtDate(p.createdAt)}
                    {p.embedUrl ? "" : " · no embed yet"}
                  </div>
                </a>
                <div className="admin-actions">
                  <button className="admin-btn" disabled={busy || (!p.published && !p.embedUrl)}
                    title={!p.published && !p.embedUrl ? "set an embed url first" : undefined}
                    onClick={() => togglePublish(p)}>
                    {busy ? "…" : p.published ? "unpublish" : "publish"}
                  </button>
                  <button className="admin-btn" disabled={busy} onClick={() => openEdit(p)}>edit</button>
                  <button className="admin-btn" disabled={busy} onClick={() => remove(p)}>delete</button>
                </div>
              </li>
            );
          })}
        </ul>
      </main>
    </div>
  );
}
```

- [ ] **Step 2: Append the preview style to `src/components/admin/admin.css`**

```css
.admin-preview {
  width: 100%;
  height: 360px;
  border: 1px solid #2a2a2e;
  border-radius: 8px;
  margin: 12px 0;
  background: #0a0a0b;
}
```

- [ ] **Step 3: Replace `src/pages/admin/index.astro` entirely with**

```astro
---
/**
 * /admin — SSR shell that enforces auth, then mounts the React admin app.
 * The app itself fetches /api/posts client-side.
 */
export const prerender = false;

import { requireAdmin } from '../../lib/auth';
import AdminApp from '../../components/admin/AdminApp.tsx';

const denied = await requireAdmin(Astro.request, Astro.locals.runtime.env);
if (denied) return denied;
---
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex, nofollow" />
    <title>admin — nvdk</title>
    <style>html, body { margin: 0; background: #0a0a0b; min-height: 100vh; }</style>
  </head>
  <body>
    <AdminApp client:only="react" />
  </body>
</html>
```

- [ ] **Step 4: Delete the superseded admin/history files**

```bash
git rm src/components/admin/AdminDashboard.tsx src/components/admin/HistoryView.tsx \
  "src/pages/admin/history/[slug].astro" "src/pages/api/history/[slug].ts"
```

- [ ] **Step 5: Commit**

```bash
git add src/components/admin/AdminApp.tsx src/components/admin/admin.css src/pages/admin/index.astro
git commit -m "feat: React admin SPA (create/edit/publish/delete, embed preview)"
```

### Task 7: Remove the old Excalidraw/KV/MDX machinery

**Files:**
- Delete: `vendor/excalidraw` (submodule), `src/components/excalidraw/`, `src/lib/scenes.ts`, `src/lib/excalidraw-libs.ts`, `src/pages/api/scenes/`, `src/pages/data/`, `src/pages/wip/`, `src/content/`, `src/content.config.ts`, `src/data/scenes/`, `src/data/excalidraw-libraries/`, `src/components/widgets/`, `src/pages/widgets/`, `scripts/seed-kv.mjs`
- Modify: `astro.config.mjs`, `package.json`, `scripts/setup-access.mjs`, `docs/excalidraw-canvas.md`

- [ ] **Step 1: Remove the submodule**

```bash
git submodule deinit -f vendor/excalidraw
git rm -f vendor/excalidraw
rm -rf .git/modules/vendor/excalidraw vendor
```

- [ ] **Step 2: Delete the dead source files**

```bash
git rm -r src/components/excalidraw src/lib/scenes.ts src/lib/excalidraw-libs.ts \
  src/pages/api/scenes src/pages/data src/pages/wip src/content src/content.config.ts \
  src/data/scenes src/data/excalidraw-libraries src/components/widgets src/pages/widgets \
  scripts/seed-kv.mjs
```

- [ ] **Step 3: Clean `astro.config.mjs`** — remove: the `mdx` import and `mdx()` integration; the `excalidrawPkg`/`excalidrawDist` consts and their comment; the two `@excalidraw/*` alias entries; the `dedupe: ['react', 'react-dom']` line (it existed to share React with the vendored package); the `markdown:` block (no markdown content remains); the `fileURLToPath` import if now unused. KEEP: `messageChannelPolyfill` + the `react-dom/server.browser → server.edge` alias + `ssr.noExternal` (React 19 SSR on Workers still needs them), `canvasSavePlugin` (homepage drag editor), `redirects` from Task 5. The resulting config:

```js
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import cloudflare from '@astrojs/cloudflare';
import { canvasSavePlugin } from './src/dev/canvas-save-plugin.mjs';

/**
 * Workers runtime lacks `MessageChannel`, which React 19's SSR bundle calls
 * at module-init time (before any request handler runs). nodejs_compat
 * doesn't expose it as a global, so we prepend a tiny shim to every SSR
 * chunk. The shim is a no-op queue — React only uses it to schedule
 * microtasks, which is exactly what `queueMicrotask` already does.
 */
function messageChannelPolyfill() {
  const SHIM = `if (typeof MessageChannel === 'undefined') {
    globalThis.MessageChannel = class {
      constructor() {
        const listeners = [];
        const port = {
          postMessage(msg) { queueMicrotask(() => listeners.forEach(fn => fn({ data: msg }))); },
          addEventListener(_type, fn) { listeners.push(fn); },
          removeEventListener(_type, fn) {
            const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1);
          },
          start() {}, close() {},
        };
        this.port1 = port; this.port2 = port;
      }
    };
  }`;
  return {
    name: 'cf-message-channel-polyfill',
    apply: 'build',
    enforce: 'post',
    // Only inject the shim into SSR chunks that actually reference
    // MessageChannel (i.e. the ones bundling React's server renderer).
    // Prepending to every client chunk too was putting statements before
    // `import` declarations in ESM modules — silently breaking them in the
    // browser, which is why client islands stopped hydrating. The shim is
    // wrapped in an IIFE so the leading non-import code is valid module text.
    generateBundle(_opts, bundle) {
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== 'chunk') continue;
        if (!chunk.code.includes('MessageChannel')) continue;
        chunk.code = `(()=>{${SHIM}})();\n${chunk.code}`;
      }
    },
  };
}

export default defineConfig({
  site: 'https://nvdk.co',
  // `server` = SSR by default with the Cloudflare adapter. Pages stay static when
  // they declare `export const prerender = true`. Required so /admin, /post/<slug>,
  // and the /api/* endpoints can read R2 at request time.
  output: 'server',
  adapter: cloudflare({
    platformProxy: { enabled: true, configPath: './wrangler.toml' },
  }),
  // Old canvas-post URLs. Posts live at /post/<slug> now.
  redirects: { '/wip/[slug]': '/post/[slug]' },
  integrations: [react(), sitemap()],
  vite: {
    plugins: [canvasSavePlugin(), messageChannelPolyfill()],
    resolve: {
      alias: [
        // SSR on Workers: react-dom/server.browser pulls in MessageChannel,
        // which the Workers runtime lacks. The .edge build is the same API
        // without the polyfill assumption.
        { find: 'react-dom/server.browser', replacement: 'react-dom/server.edge' },
      ],
    },
    ssr: {
      noExternal: ['react-dom'],
    },
    server: {
      fs: { strict: false },
      allowedHosts: ['.trycloudflare.com'],
    },
  },
});
```

- [ ] **Step 4: Prune `package.json`** — remove the `seed-kv` script. For each dependency candidate, FIRST verify it is unreferenced (`grep -rn "<name>" src astro.config.mjs`), THEN remove: `@astrojs/mdx`, `devices.css`, `papercss`, `roughjs`, `rough-notation` (the last two may be used by `src/components/canvas/` or `src/scripts/` — if grep finds a hit, KEEP them). Then:

```bash
npm install
```

- [ ] **Step 5: Update `scripts/setup-access.mjs`** — delete the `'nvdk.co/api/scenes/*',` line from the path list, and update the stale header comment (the app now covers `/admin` and `/api/posts*` only).

- [ ] **Step 6: Replace `docs/excalidraw-canvas.md`** with a short doc describing the new flow (author in Excalidraw+ → copy readonly link → create/publish in /admin → renders as iframe; storage = R2 posts.json; auth unchanged). Rename to `docs/publishing.md`:

```bash
git rm docs/excalidraw-canvas.md
```

- [ ] **Step 7: Verify nothing references the dead modules**

Run: `grep -rn "scenes\|excalidraw\|astro:content\|getCollection\|SCENES" src astro.config.mjs scripts --include="*.ts" --include="*.tsx" --include="*.astro" --include="*.mjs" -il`
Expected: only `src/lib/posts.ts`/`posts.test.ts`/API/admin files mentioning "excalidraw" in the embed-URL sense (link.excalidraw.com), and `setup-access.mjs` history in comments. No `astro:content`, no `SCENES`, no `lib/scenes` imports.

- [ ] **Step 8: Build + test**

Run: `npm test && npm run build`
Expected: tests PASS; build succeeds with no missing-module errors.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "refactor: remove vendored Excalidraw, KV scenes, MDX collection"
```

### Task 8: Seed production data + local dev data

**Files:**
- Create: `scripts/seed-posts.mjs`
- Modify: `package.json` (script)

- [ ] **Step 1: Create `scripts/seed-posts.mjs`** (writes the seed list from the Reference section to R2; `--remote` flag targets prod, default is the local dev bucket):

```js
/**
 * One-shot: seed posts.json into the POSTS R2 bucket.
 * Local (wrangler dev storage):  node scripts/seed-posts.mjs
 * Production:                    node scripts/seed-posts.mjs --remote
 * Refuses to overwrite an existing posts.json unless --force is passed.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BUCKET = 'nvdk-posts';
const KEY = 'posts.json';
const remote = process.argv.includes('--remote');
const force = process.argv.includes('--force');
const flag = remote ? '--remote' : '--local';

const now = new Date().toISOString();
const posts = [
  {
    slug: 'plot',
    title: 'Plot: My wishlist for SuperSet',
    summary:
      'A living wishlist for the agent tools I use all day. Make the diff the main surface and let me comment on it. Show me the change in plain English with a reason on every edit. Treat context like git. And surface the to-do list the agent already keeps.',
    embedUrl: 'https://link.excalidraw.com/readonly/psnMm8Nsg0mNNkHKQwi3?darkMode=true',
    createdAt: '2026-05-28T00:00:00.000Z',
    updatedAt: now,
    published: true,
  },
  {
    slug: 'prompt',
    title: 'PromptHub',
    summary: '',
    embedUrl: '',
    createdAt: '2026-05-28T00:00:00.000Z',
    updatedAt: now,
    published: false,
  },
  {
    slug: 'browser-plugin-for-ui-design',
    title: 'Two ways to change a UI',
    summary:
      'Two ways to spin up modified versions of our UI fast with AI — copy the frontend and edit the copy, or edit the real product live in the browser — and what each would actually take.',
    embedUrl: '',
    createdAt: '2026-05-27T00:00:00.000Z',
    updatedAt: now,
    published: false,
  },
];

const run = (args) =>
  execFileSync('npx', ['wrangler', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

if (!force) {
  try {
    run(['r2', 'object', 'get', `${BUCKET}/${KEY}`, flag, '--pipe']);
    console.error(`${KEY} already exists in ${BUCKET} (${flag}); pass --force to overwrite.`);
    process.exit(1);
  } catch {
    /* missing — good, proceed */
  }
}

const dir = mkdtempSync(join(tmpdir(), 'seed-posts-'));
const file = join(dir, KEY);
writeFileSync(file, JSON.stringify(posts, null, 2));
try {
  run(['r2', 'object', 'put', `${BUCKET}/${KEY}`, `--file=${file}`, flag, '--content-type', 'application/json']);
  console.log(`Seeded ${posts.length} posts into ${BUCKET}/${KEY} (${flag}).`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
```

- [ ] **Step 2: Replace the removed `seed-kv` npm script with**

```json
"seed-posts": "node scripts/seed-posts.mjs"
```

- [ ] **Step 3: Seed the local dev bucket and verify**

Run: `npm run seed-posts && npx wrangler r2 object get nvdk-posts/posts.json --local --pipe`
Expected: the 3-post JSON printed.

- [ ] **Step 4: Commit**

```bash
git add scripts/seed-posts.mjs package.json
git commit -m "feat: seed-posts script (plot published, two drafts)"
```

### Task 9: Local verification (manual, dev server)

Requires `.dev.vars` containing `LOCAL_DEV_BYPASS_AUTH=true` (already the established local setup).

- [ ] **Step 1: Start dev server**

Run: `npm run dev` (background)

- [ ] **Step 2: Verify each surface with curl + browser**

```bash
curl -s localhost:4321/ | grep -o "Plot: My wishlist[^<]*"          # homepage lists plot
curl -s localhost:4321/post/plot/ | grep -o 'link.excalidraw.com[^"]*'  # iframe src present
curl -s -o /dev/null -w '%{http_code}\n' localhost:4321/post/prompt/    # 404 (draft)
curl -s localhost:4321/rss.xml | grep -c "<item>"                        # 1 item
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' localhost:4321/wip/plot/  # 301 → /post/plot
```

- [ ] **Step 3: Exercise the admin in a browser (or via curl)** — create a draft post, edit it, paste the plot embed URL, watch the preview render, publish, confirm it appears on `/`, unpublish, delete. API-only smoke:

```bash
curl -s -X POST localhost:4321/api/posts -H 'content-type: application/json' \
  -d '{"slug":"smoke","title":"Smoke"}'                                   # 201
curl -s -X PATCH localhost:4321/api/posts/smoke -H 'content-type: application/json' \
  -d '{"published":true}'                                                 # 400: needs embedUrl
curl -s -X PATCH localhost:4321/api/posts/smoke -H 'content-type: application/json' \
  -d '{"embedUrl":"https://link.excalidraw.com/readonly/psnMm8Nsg0mNNkHKQwi3","published":true}'  # 200
curl -s -X DELETE localhost:4321/api/posts/smoke                          # 200
```

- [ ] **Step 4: Stop dev server. Fix anything that failed before proceeding.**

### Task 10: Access app update, deploy, prod verification

- [ ] **Step 1: Re-run the Access setup so the app paths match the new API surface**

Run: `node scripts/setup-access.mjs`
Expected: consolidated app recreated covering `/admin`, `/admin/*`, `/api/posts`, `/api/posts/*`; AUD written to `wrangler.toml`. Commit `wrangler.toml` if the AUD changed.

- [ ] **Step 2: Seed production R2**

Run: `npm run seed-posts -- --remote`
Expected: "Seeded 3 posts".

- [ ] **Step 3: Deploy**

Run: `npm run deploy`
Expected: Pages deployment succeeds.

- [ ] **Step 4: Verify production**

```bash
curl -s https://nvdk.co/ | grep -o "Plot: My wishlist[^<]*"
curl -s https://nvdk.co/post/plot/ | grep -o 'link.excalidraw.com[^"]*'
curl -s -o /dev/null -w '%{http_code}\n' https://nvdk.co/post/prompt/        # 404
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://nvdk.co/api/posts \
  -H 'content-type: application/json' -d '{"slug":"x","title":"x"}'          # 401/403 (no JWT)
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' https://nvdk.co/wip/plot/  # 301
```

Then in a browser: `https://nvdk.co/admin` challenges via Access and renders the SPA; `/post/plot` shows the canvas.

- [ ] **Step 5: Final commit of any straggler changes; update project CLAUDE.md/docs if stale references remain**

```bash
git add -A && git commit -m "chore: Excalidraw+ pipeline live; KV decommissioned"
```

(Optionally later: delete the old SCENES KV namespace via `npx wrangler kv namespace delete --namespace-id=74782c54096c419397d9fde4495b1d70` once confident — not part of this plan's automated steps.)

---

## Self-review notes

- Spec coverage: data model (T2), API (T4), admin SPA (T6), public pages + redirects (T5), removals (T7), provisioning + import (T3/T8), error handling (validation in T4, empty-on-corrupt in T2), testing (T2 unit, T9 manual, T10 prod). RSS covered (T5.3). Access path update covered (T10.1).
- `publishedPosts` name consistent across T2/T5. `RuntimeEnv.POSTS` consistent across T3/T4/T6.
- Drafts with empty embedUrl can't be published (enforced in API + admin button disabled) — matches spec's "publish requires valid embedUrl".
