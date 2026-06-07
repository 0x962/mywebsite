import type { APIRoute } from 'astro';
import type { RuntimeEnv } from '../../../lib/auth';
import { isSlug, readScene } from '../../../lib/scenes';

/**
 * Public scene read. Lives outside /api/ so the entire /api/* tree can be
 * uniformly Access-gated (Access apps don't support per-method include rules
 * via the JSON API). The canvas client fetches scenes from here on mount;
 * writes go to PUT /api/scenes/<slug> (auth required).
 */
export const prerender = false;

function env(locals: App.Locals): RuntimeEnv {
  const runtime = (locals as { runtime?: { env: RuntimeEnv } }).runtime;
  if (!runtime?.env?.SCENES) throw new Error('SCENES KV binding missing');
  return runtime.env;
}

export const GET: APIRoute = async ({ params, locals }) => {
  if (!isSlug(params.slug)) return new Response('bad slug', { status: 400 });
  const scene = await readScene(env(locals).SCENES, params.slug);
  return new Response(JSON.stringify(scene), {
    status: 200,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
};
