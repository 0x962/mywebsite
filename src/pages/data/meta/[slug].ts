import type { APIRoute } from 'astro';
import type { RuntimeEnv } from '../../../lib/auth';
import { isSlug, readSceneMeta } from '../../../lib/scenes';

/**
 * Public scene authoring metadata — `{ lastEditedAt }` only (we don't leak the
 * editor's email). Used to label post-its on the home page and the small
 * "edited X ago" badge on canvas pages. Returns 200 with `lastEditedAt: null`
 * for slugs that have never been written, so callers can render unconditionally.
 */
export const prerender = false;

function env(locals: App.Locals): RuntimeEnv {
  const runtime = (locals as { runtime?: { env: RuntimeEnv } }).runtime;
  if (!runtime?.env?.SCENES) throw new Error('SCENES KV binding missing');
  return runtime.env;
}

export const GET: APIRoute = async ({ params, locals }) => {
  if (!isSlug(params.slug)) return new Response('bad slug', { status: 400 });
  const meta = await readSceneMeta(env(locals).SCENES, params.slug);
  return new Response(JSON.stringify({ lastEditedAt: meta?.lastEditedAt ?? null }), {
    status: 200,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
};
