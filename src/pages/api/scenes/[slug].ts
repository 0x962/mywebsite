import type { APIRoute } from 'astro';
import { requireAdmin, type RuntimeEnv } from '../../../lib/auth';
import { isSlug, readScene, writeScene } from '../../../lib/scenes';

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

// GET: public read. The canvas page calls this on mount.
export const GET: APIRoute = async ({ params, locals }) => {
  if (!isSlug(params.slug)) return json({ error: 'bad slug' }, 400);
  const scene = await readScene(env(locals).SCENES, params.slug);
  return json(scene);
};

// PUT: admin-only write. Body must be the full Excalidraw scene JSON.
export const PUT: APIRoute = async ({ params, request, locals }) => {
  if (!isSlug(params.slug)) return json({ error: 'bad slug' }, 400);
  const e = env(locals);
  const denied = await requireAdmin(request, e);
  if (denied) return denied;

  let body: unknown;
  try { body = await request.json(); } catch { return json({ error: 'invalid json' }, 400); }
  if (!body || typeof body !== 'object' || !Array.isArray((body as { elements?: unknown }).elements)) {
    return json({ error: 'scene must have elements array' }, 400);
  }

  await writeScene(e.SCENES, params.slug, body);
  return json({ ok: true });
};
