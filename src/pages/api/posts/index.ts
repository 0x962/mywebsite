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
