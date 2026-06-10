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
