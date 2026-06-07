import type { APIRoute } from 'astro';
import { authenticate, requireAdmin, type RuntimeEnv } from '../../../lib/auth';
import {
  BLANK_SCENE,
  addToIndex,
  isSlug,
  listPostSlugs,
  readPostMeta,
  writePostMeta,
  writeScene,
  type PostMeta,
} from '../../../lib/scenes';

export const prerender = false;

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

function env(locals: App.Locals): RuntimeEnv {
  const runtime = (locals as { runtime?: { env: RuntimeEnv } }).runtime;
  if (!runtime?.env?.SCENES) throw new Error('SCENES KV binding missing');
  return runtime.env;
}

// GET: admin-only list of KV-authored posts (the ones created via /admin).
// Existing frontmatter posts come from src/content/posts and are listed in the
// admin page directly via getCollection — they don't appear here.
export const GET: APIRoute = async ({ request, locals }) => {
  const e = env(locals);
  const denied = await requireAdmin(request, e);
  if (denied) return denied;

  const slugs = await listPostSlugs(e.SCENES);
  const posts = await Promise.all(slugs.map((s) => readPostMeta(e.SCENES, s)));
  return json({ posts: posts.filter(Boolean) });
};

// POST: admin-only create. Body { slug, title, summary? }. Seeds an empty
// scene and stores metadata. Idempotent on slug collision (409).
export const POST: APIRoute = async ({ request, locals }) => {
  const e = env(locals);
  const auth = await authenticate(request, e);
  if ('denied' in auth) return auth.denied;

  let body: unknown;
  try { body = await request.json(); } catch { return json({ error: 'invalid json' }, 400); }
  const b = body as { slug?: unknown; title?: unknown; summary?: unknown };
  if (!isSlug(b.slug)) return json({ error: 'slug must be [a-z0-9-]' }, 400);
  if (typeof b.title !== 'string' || !b.title.trim()) return json({ error: 'title required' }, 400);

  if (await readPostMeta(e.SCENES, b.slug)) return json({ error: 'slug taken' }, 409);

  const now = new Date().toISOString();
  const meta: PostMeta = {
    slug: b.slug,
    title: b.title.trim(),
    date: now,
    summary: typeof b.summary === 'string' ? b.summary.trim() : '',
    draft: true,
  };

  await writeScene(e.SCENES, meta.slug, BLANK_SCENE, { lastEditedAt: now, lastEditedBy: auth.email });
  await writePostMeta(e.SCENES, meta);
  await addToIndex(e.SCENES, meta.slug);

  return json({ ok: true, post: meta }, 201);
};
