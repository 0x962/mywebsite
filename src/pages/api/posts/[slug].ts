import type { APIRoute } from 'astro';
import { authenticate, type RuntimeEnv } from '../../../lib/auth';
import {
  deleteOverride,
  isSlug,
  readPostMeta,
  writeOverride,
  writePostMeta,
} from '../../../lib/scenes';

/**
 * Per-post admin actions.
 *
 *   PATCH /api/posts/<slug> { published: boolean }
 *
 * For a KV-only post (created via /admin): flips `draft` on its PostMeta.
 * For a frontmatter post (src/content/posts/<slug>.mdx): stores an override
 * at `override:<slug>` that the home page / RSS respect. Sending `{ published:
 * <matches frontmatter> }` clears the override.
 */
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

export const PATCH: APIRoute = async ({ params, request, locals }) => {
  if (!isSlug(params.slug)) return json({ error: 'bad slug' }, 400);
  const e = env(locals);
  const auth = await authenticate(request, e);
  if ('denied' in auth) return auth.denied;

  let body: { published?: unknown; source?: unknown };
  try { body = (await request.json()) as typeof body; } catch { return json({ error: 'invalid json' }, 400); }
  if (typeof body.published !== 'boolean') return json({ error: 'published must be boolean' }, 400);
  if (body.source !== 'kv' && body.source !== 'collection') {
    return json({ error: 'source must be "kv" or "collection"' }, 400);
  }

  if (body.source === 'kv') {
    const meta = await readPostMeta(e.SCENES, params.slug);
    if (!meta) return json({ error: 'post not found' }, 404);
    meta.draft = !body.published;
    await writePostMeta(e.SCENES, meta);
    return json({ ok: true, source: 'kv', draft: meta.draft });
  }

  // Frontmatter source: write an override entry (or clear one).
  await writeOverride(e.SCENES, params.slug, { published: body.published });
  return json({ ok: true, source: 'collection', published: body.published });
};

export const DELETE: APIRoute = async ({ params, request, locals }) => {
  // Clear any override on this slug, restoring the frontmatter default.
  if (!isSlug(params.slug)) return json({ error: 'bad slug' }, 400);
  const e = env(locals);
  const auth = await authenticate(request, e);
  if ('denied' in auth) return auth.denied;
  await deleteOverride(e.SCENES, params.slug);
  return json({ ok: true });
};
