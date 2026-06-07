/**
 * Auth check for protected endpoints (POST/PUT/DELETE on /api/* and /admin).
 *
 * Production: behind Cloudflare Access. CF injects the verified user email as
 * `Cf-Access-Authenticated-User-Email`. We check it against `ADMIN_EMAILS`
 * (comma-separated, configured in wrangler.toml `[vars]`).
 *
 * Local dev: `LOCAL_DEV_BYPASS_AUTH=true` in `.dev.vars` skips the check, since
 * there is no Access in front of `wrangler pages dev` or `astro dev`.
 *
 * Anything else → 401.
 */
export interface RuntimeEnv {
  SCENES: KVNamespace;
  ADMIN_EMAILS?: string;
  LOCAL_DEV_BYPASS_AUTH?: string;
}

export function requireAdmin(request: Request, env: RuntimeEnv): Response | null {
  if (env.LOCAL_DEV_BYPASS_AUTH === 'true') return null;

  const email = request.headers.get('Cf-Access-Authenticated-User-Email');
  const allowed = (env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  if (email && allowed.includes(email.toLowerCase())) return null;

  return new Response('unauthorized', {
    status: 401,
    headers: { 'content-type': 'text/plain' },
  });
}
