/**
 * Owner-only canvas layout API, behind Cloudflare Access.
 *
 *   GET  /api/layout/<page>  → { admin: true, email, layout }
 *        Doubles as the client's "am I the signed-in owner?" probe: guests hit
 *        Access's login redirect (an opaque redirect to the fetch), the owner
 *        gets a 200. Also returns the current saved layout.
 *   PUT  /api/layout/<page>  body { id, breakpoint, patch } → merges one
 *        element's per-breakpoint position into the R2 layout (the shared
 *        baseline every visitor loads).
 *
 * Both methods require a verified Access JWT (admin allowlist). The public home
 * page reads the layout directly from R2 at SSR time, so this route is never on
 * a visitor's path — keeping it fully Access-gated is what makes GET a clean
 * owner probe. NOTE: /api/layout + /api/layout/* must be added to the Access
 * app (see scripts/setup-access.mjs) or every call here fails closed.
 */
import type { APIRoute } from 'astro';
import { authenticate, type RuntimeEnv } from '../../../lib/auth';
import { applyPatch, isBreakpoint, isLayoutId, readLayout, sanitizePatch, writeLayout } from '../../../lib/layouts';
import { readItems, sanitizeNewItem, writeItems } from '../../../lib/items';

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

export const GET: APIRoute = async ({ request, params, locals }) => {
  const e = env(locals);
  const auth = await authenticate(request, e);
  if ('denied' in auth) return auth.denied;
  const page = params.page;
  if (!isLayoutId(page)) return json({ error: 'bad page' }, 400);
  return json({
    admin: true,
    email: auth.email,
    layout: await readLayout(e.POSTS, page),
    items: await readItems(e.POSTS, page),
  });
};

// POST → add a new owner-authored item to the page. Body is the raw item
// payload from the add form; the id is assigned server-side.
export const POST: APIRoute = async ({ request, params, locals }) => {
  const e = env(locals);
  const auth = await authenticate(request, e);
  if ('denied' in auth) return auth.denied;

  const page = params.page;
  if (!isLayoutId(page)) return json({ error: 'bad page' }, 400);

  let body: unknown;
  try { body = await request.json(); } catch { return json({ error: 'invalid json' }, 400); }
  const b = body as Record<string, unknown>;

  const item = sanitizeNewItem(b.item ?? b);
  if (!item) return json({ error: 'invalid item for its kind' }, 400);

  const items = await readItems(e.POSTS, page);
  items.push(item);
  await writeItems(e.POSTS, page, items);
  return json({ ok: true, id: item.id }, 201);
};

// DELETE → remove an owner-authored item (and any saved position for it).
export const DELETE: APIRoute = async ({ request, params, locals }) => {
  const e = env(locals);
  const auth = await authenticate(request, e);
  if ('denied' in auth) return auth.denied;

  const page = params.page;
  if (!isLayoutId(page)) return json({ error: 'bad page' }, 400);

  let body: unknown;
  try { body = await request.json(); } catch { return json({ error: 'invalid json' }, 400); }
  const id = (body as Record<string, unknown>).id;
  if (!isLayoutId(id)) return json({ error: 'id required' }, 400);

  const items = await readItems(e.POSTS, page);
  const next = items.filter((it) => it.id !== id);
  if (next.length !== items.length) await writeItems(e.POSTS, page, next);

  // Drop its position override too, if any.
  const layout = await readLayout(e.POSTS, page);
  if (layout[id]) {
    const { [id]: _drop, ...rest } = layout;
    await writeLayout(e.POSTS, page, rest);
  }
  return json({ ok: true });
};

export const PUT: APIRoute = async ({ request, params, locals }) => {
  const e = env(locals);
  const auth = await authenticate(request, e);
  if ('denied' in auth) return auth.denied;

  const page = params.page;
  if (!isLayoutId(page)) return json({ error: 'bad page' }, 400);

  let body: unknown;
  try { body = await request.json(); } catch { return json({ error: 'invalid json' }, 400); }
  const b = body as Record<string, unknown>;

  if (!isLayoutId(b.id)) return json({ error: 'id must be [a-z0-9-]' }, 400);
  if (!isBreakpoint(b.breakpoint)) return json({ error: 'breakpoint must be desktop|tablet|mobile' }, 400);
  const patch = sanitizePatch(b.patch);
  if (!patch) return json({ error: 'patch must be numeric x/y/rotate/z/w' }, 400);

  const layout = await readLayout(e.POSTS, page);
  await writeLayout(e.POSTS, page, applyPatch(layout, b.id, b.breakpoint, patch));
  return json({ ok: true });
};
