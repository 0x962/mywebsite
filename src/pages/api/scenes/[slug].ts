import type { APIRoute } from 'astro';
import { authenticate, type RuntimeEnv } from '../../../lib/auth';
import { isSlug, pruneHistory, readSceneWithMeta, writeScene } from '../../../lib/scenes';

/**
 * Scene write endpoint. PUT only — public reads live at /data/scenes/<slug>
 * (outside the Access-gated /api/ tree, since Access JSON apps don't support
 * per-method include rules).
 *
 * Every write snapshots the PRIOR scene into KV under
 * `history:<slug>:<iso-timestamp>` so any save is recoverable from /admin →
 * history. KV has no native versioning; this is the only safety net.
 */
export const prerender = false;

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

function env(locals: App.Locals): RuntimeEnv {
  const runtime = (locals as { runtime?: { env: RuntimeEnv } }).runtime;
  if (!runtime?.env?.SCENES) throw new Error('SCENES KV binding missing — check wrangler.toml');
  return runtime.env;
}

export const PUT: APIRoute = async ({ params, request, locals }) => {
  if (!isSlug(params.slug)) return json({ error: 'bad slug' }, 400);
  const e = env(locals);
  const auth = await authenticate(request, e);
  if ('denied' in auth) return auth.denied;

  let body: unknown;
  try { body = await request.json(); } catch { return json({ error: 'invalid json' }, 400); }
  if (!body || typeof body !== 'object' || !Array.isArray((body as { elements?: unknown }).elements)) {
    return json({ error: 'scene must have elements array' }, 400);
  }

  const prior = await readSceneWithMeta(e.SCENES, params.slug);
  const meta = { lastEditedAt: new Date().toISOString(), lastEditedBy: auth.email };
  await writeScene(e.SCENES, params.slug, body, meta, prior ?? undefined);
  await pruneHistory(e.SCENES, params.slug);
  return json({ ok: true, ...meta });
};
