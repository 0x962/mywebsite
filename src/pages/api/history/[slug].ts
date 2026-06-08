import type { APIRoute } from 'astro';
import { authenticate, type RuntimeEnv } from '../../../lib/auth';
import {
  isSlug,
  listHistory,
  pruneHistory,
  readHistory,
  readSceneWithMeta,
  writeScene,
} from '../../../lib/scenes';

/**
 * Per-slug scene history. Admin-only (all methods Access-gated).
 *
 *   GET  /api/history/<slug>            → list snapshots, newest first
 *   GET  /api/history/<slug>?ts=<iso>   → return one snapshot's full scene
 *   POST /api/history/<slug> { ts }     → restore that snapshot to current
 *                                         (the *current* state is snapshotted
 *                                         first, so restore is itself undoable)
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

export const GET: APIRoute = async ({ params, request, url, locals }) => {
  if (!isSlug(params.slug)) return json({ error: 'bad slug' }, 400);
  const e = env(locals);
  const auth = await authenticate(request, e);
  if ('denied' in auth) return auth.denied;

  const ts = url.searchParams.get('ts');
  if (ts) {
    const snap = await readHistory(e.SCENES, `history:${params.slug}:${ts}`);
    if (!snap) return json({ error: 'snapshot not found' }, 404);
    return json(snap);
  }

  const entries = await listHistory(e.SCENES, params.slug);
  return json({ entries });
};

export const POST: APIRoute = async ({ params, request, locals }) => {
  if (!isSlug(params.slug)) return json({ error: 'bad slug' }, 400);
  const e = env(locals);
  const auth = await authenticate(request, e);
  if ('denied' in auth) return auth.denied;

  let body: { ts?: string };
  try { body = (await request.json()) as { ts?: string }; } catch { return json({ error: 'invalid json' }, 400); }
  if (typeof body.ts !== 'string' || !body.ts) return json({ error: 'ts required' }, 400);

  const snap = await readHistory(e.SCENES, `history:${params.slug}:${body.ts}`);
  if (!snap) return json({ error: 'snapshot not found' }, 404);

  // Snapshot the CURRENT state to history before overwriting it. The restore
  // is itself recoverable, so an accidental restore can be undone.
  const prior = await readSceneWithMeta(e.SCENES, params.slug);
  const meta = {
    lastEditedAt: new Date().toISOString(),
    lastEditedBy: `${auth.email} (restore of ${body.ts})`,
  };
  await writeScene(e.SCENES, params.slug, snap.scene, meta, prior ?? undefined);
  await pruneHistory(e.SCENES, params.slug);
  return json({ ok: true, restoredFrom: body.ts, ...meta });
};
