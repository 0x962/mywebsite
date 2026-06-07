/**
 * Auth for write endpoints (PUT/POST/DELETE on /api/*) and /admin.
 *
 * THREAT MODEL — what we're guarding against:
 *
 *  1. The `Cf-Access-Authenticated-User-Email` header is set by Cloudflare
 *     Access for authenticated requests, but ANY upstream can send a header
 *     with that name. If we only ever ran behind Access we could trust it,
 *     but Pages deployments are also reachable directly at <hash>.nvdk.pages.dev
 *     (and at the apex via DNS) — Access does not implicitly cover those.
 *     A request that bypasses Access (e.g. to the *.pages.dev URL) can forge
 *     the header trivially. So: never trust the email header alone.
 *
 *  2. Cloudflare Access also issues a signed JWT in `Cf-Access-Jwt-Assertion`.
 *     The JWT is signed by the team's key (rotated by CF), and includes
 *     `aud` = the specific Access application AUD tag. Verifying the JWT
 *     against the team's JWKS, and confirming the `aud` matches OUR app,
 *     proves the request actually transited Access. That's the only safe
 *     auth signal.
 *
 *  3. We also reject any request that arrived on a *.pages.dev hostname.
 *     Even if someone forgets to add a hostname to the Access app, the
 *     direct origin is still blocked.
 *
 * Local dev: `LOCAL_DEV_BYPASS_AUTH=true` in .dev.vars short-circuits the
 * whole thing — there is no Access in front of `astro dev` / `wrangler pages
 * dev`, and prod Workers never load .dev.vars.
 *
 * Config (wrangler.toml [vars] or `wrangler secret put`):
 *   CF_ACCESS_TEAM_DOMAIN  e.g. "nvdk"  (-> https://nvdk.cloudflareaccess.com)
 *   CF_ACCESS_AUD          comma-separated AUD tags (one per Access app
 *                          that fronts a protected path — admin, posts api,
 *                          scenes-write). The JWT's `aud` claim must match
 *                          one of them.
 *   ADMIN_EMAILS           comma-separated allowlist
 *
 * Until CF_ACCESS_AUD is set, ALL writes fail closed — better than silently
 * accepting forged headers.
 */

export interface RuntimeEnv {
  SCENES: KVNamespace;
  ADMIN_EMAILS?: string;
  CF_ACCESS_TEAM_DOMAIN?: string;
  CF_ACCESS_AUD?: string;
  LOCAL_DEV_BYPASS_AUTH?: string;
}

interface AccessJwtPayload {
  email?: string;
  iss?: string;
  aud?: string | string[];
  exp?: number;
  nbf?: number;
  iat?: number;
}

interface Jwk {
  kty: string;
  use?: string;
  kid: string;
  alg?: string;
  n: string;
  e: string;
}

const TEXT_PLAIN = { 'content-type': 'text/plain' };
const unauthorized = (msg = 'unauthorized') => new Response(msg, { status: 401, headers: TEXT_PLAIN });
const forbidden = (msg = 'forbidden') => new Response(msg, { status: 403, headers: TEXT_PLAIN });

/** base64url → ArrayBuffer */
function b64uToBuf(s: string): ArrayBuffer {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const b64 = (s + pad).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

/** base64url → utf-8 string */
function b64uToString(s: string): string {
  return new TextDecoder().decode(b64uToBuf(s));
}

/**
 * JWKS cache. The set rotates rarely; we hold it in module scope for the
 * lifetime of an isolate and re-fetch lazily after TTL.
 */
let jwksCache: { keys: Jwk[]; fetchedAt: number; team: string } | null = null;
const JWKS_TTL_MS = 60 * 60 * 1000; // 1 hour

async function getJwks(team: string): Promise<Jwk[]> {
  const now = Date.now();
  if (jwksCache && jwksCache.team === team && now - jwksCache.fetchedAt < JWKS_TTL_MS) {
    return jwksCache.keys;
  }
  const url = `https://${team}.cloudflareaccess.com/cdn-cgi/access/certs`;
  const res = await fetch(url, { cf: { cacheTtl: 300, cacheEverything: true } as RequestInitCfProperties });
  if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status}`);
  const data = (await res.json()) as { keys: Jwk[] };
  if (!Array.isArray(data.keys)) throw new Error('JWKS missing keys array');
  jwksCache = { keys: data.keys, fetchedAt: now, team };
  return data.keys;
}

/** Verify a CF Access JWT. Returns the validated payload or null. */
async function verifyAccessJwt(
  jwt: string,
  team: string,
  expectedAuds: string[],
): Promise<AccessJwtPayload | null> {
  const parts = jwt.split('.');
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = parts;

  let header: { alg?: string; kid?: string };
  let payload: AccessJwtPayload;
  try {
    header = JSON.parse(b64uToString(headerB64));
    payload = JSON.parse(b64uToString(payloadB64));
  } catch {
    return null;
  }

  if (header.alg !== 'RS256') return null;
  if (!header.kid) return null;

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp < now) return null;
  if (typeof payload.nbf === 'number' && payload.nbf > now) return null;

  const expectedIss = `https://${team}.cloudflareaccess.com`;
  if (payload.iss !== expectedIss) return null;

  const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!auds.some((a) => typeof a === 'string' && expectedAuds.includes(a))) return null;

  let keys: Jwk[];
  try {
    keys = await getJwks(team);
  } catch {
    return null;
  }
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) return null;

  let cryptoKey: CryptoKey;
  try {
    cryptoKey = await crypto.subtle.importKey(
      'jwk',
      jwk as JsonWebKey,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    );
  } catch {
    return null;
  }

  const data = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  let ok = false;
  try {
    ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', cryptoKey, b64uToBuf(sigB64), data);
  } catch {
    return null;
  }

  return ok ? payload : null;
}

/**
 * Reject calls that landed on the pages.dev origin. Production traffic should
 * arrive on nvdk.co (or another configured custom hostname covered by Access).
 * Direct *.pages.dev hits cannot be in front of Access, so they cannot have
 * a valid JWT anyway — refuse them up-front for clarity.
 */
function isPagesDevOrigin(request: Request): boolean {
  try {
    const host = new URL(request.url).hostname;
    return host.endsWith('.pages.dev');
  } catch {
    return false;
  }
}

export async function requireAdmin(request: Request, env: RuntimeEnv): Promise<Response | null> {
  if (env.LOCAL_DEV_BYPASS_AUTH === 'true') return null;

  if (isPagesDevOrigin(request)) {
    return forbidden('direct pages.dev origin not allowed; use nvdk.co');
  }

  const team = env.CF_ACCESS_TEAM_DOMAIN;
  const auds = (env.CF_ACCESS_AUD ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!team || auds.length === 0) {
    // Fail closed when not yet configured — never fall back to header trust.
    return unauthorized('Access not configured: set CF_ACCESS_TEAM_DOMAIN + CF_ACCESS_AUD');
  }

  const jwt = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!jwt) return unauthorized('missing Cf-Access-Jwt-Assertion');

  const payload = await verifyAccessJwt(jwt, team, auds);
  if (!payload || !payload.email) return unauthorized('invalid Access token');

  const allowed = (env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (!allowed.includes(payload.email.toLowerCase())) {
    return forbidden(`not in admin allowlist: ${payload.email}`);
  }

  return null;
}
