#!/usr/bin/env node
/**
 * One-shot: create the single Cloudflare Access self-hosted application that
 * gates /admin, /api/posts* and /api/layout* (all methods).
 *
 *   node scripts/setup-access.mjs
 *
 * ONE app, not several: the admin SPA calls /api/posts* via `fetch()` from
 * /admin. When Access challenges that request, it 302s to the login page on
 * the team's *.cloudflareaccess.com origin — a CORS-mode fetch can't follow
 * a cross-origin redirect without CORS headers on the login page (and there
 * aren't any). One app → one session cookie → no fresh challenge on the
 * fetch path.
 *
 * The script tears down any previous "nvdk admin / nvdk posts api / nvdk
 * scenes write" apps before creating the consolidated one. AUDs are
 * written back into wrangler.toml. Idempotent on re-run.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const ACCOUNT_ID = '123440327a67db0da0c8f99fa3394777';
const ADMIN_EMAIL = 'n@nvdk.co';
const SESSION = '24h';

const OLD_APP_NAMES = ['nvdk admin', 'nvdk posts api', 'nvdk scenes write'];

// The full set of paths this app gates. Source of truth — a PUT replaces the
// app's destinations with exactly this list, so add/remove here and re-run.
// NOTE: the app is capped at 5 destinations on this plan; keep the list ≤ 5.
const DESTINATION_URIS = [
  'nvdk.co/admin',
  'nvdk.co/admin/*',
  'nvdk.co/api/posts',
  'nvdk.co/api/posts/*',
  // Owner-only home-page "desktop" layout saves. GET here also serves as the
  // client's owner probe, so it MUST stay gated (guests get the login redirect).
  // The route is /api/layout/[page], so the wildcard alone covers it.
  'nvdk.co/api/layout/*',
];

const CONSOLIDATED = {
  name: 'nvdk authoring',
  type: 'self_hosted',
  session_duration: SESSION,
  app_launcher_visible: false,
  auto_redirect_to_identity: false,
  // Modern `destinations` form (CF migrated off `self_hosted_domains`). Sending
  // both on a PUT double-counts and trips "too many destinations".
  destinations: DESTINATION_URIS.map((uri) => ({ type: 'public', uri })),
};

const env = Object.fromEntries(
  readFileSync('.env', 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i), l.slice(i + 1).replace(/^["']|["']$/g, '')];
    }),
);
const TOKEN = env.CF_ACCESS_API_TOKEN;
if (!TOKEN) throw new Error('CF_ACCESS_API_TOKEN missing from .env');

const API = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/access`;
const H = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };

async function cf(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: H,
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await res.json();
  if (!j.success) {
    throw new Error(`${method} ${path} → ${res.status}: ${JSON.stringify(j.errors)}`);
  }
  return j.result;
}

console.log('Loading existing apps…');
const existing = await cf('GET', '/apps');
const byName = new Map(existing.map((a) => [a.name, a]));

// Tear down stale split apps first so paths don't conflict.
for (const oldName of OLD_APP_NAMES) {
  const found = byName.get(oldName);
  if (!found) continue;
  console.log(`  - deleting stale app ${oldName} (${found.id})`);
  await cf('DELETE', `/apps/${found.id}`);
  byName.delete(oldName);
}

// Create the consolidated app, or sync its config if it already exists (so
// edits to self_hosted_domains here actually take effect on re-run).
let app = byName.get(CONSOLIDATED.name);
if (app) {
  console.log(`  · ${CONSOLIDATED.name} already exists (${app.id}) — syncing config`);
  app = await cf('PUT', `/apps/${app.id}`, CONSOLIDATED);
} else {
  console.log(`  + creating ${CONSOLIDATED.name}…`);
  app = await cf('POST', '/apps', CONSOLIDATED);
  console.log(`    created ${app.id}`);
}

// Ensure Allow policy.
const policies = await cf('GET', `/apps/${app.id}/policies`);
if (!policies.length) {
  console.log(`    + adding allow policy for ${ADMIN_EMAIL}`);
  await cf('POST', `/apps/${app.id}/policies`, {
    name: 'allow admin',
    decision: 'allow',
    precedence: 1,
    include: [{ email: { email: ADMIN_EMAIL } }],
  });
} else {
  console.log(`    · policy already present (${policies.length})`);
}

console.log(`\nAUD: ${app.aud}\n`);

// Login-page branding: make the Access login screen black (was red). This is
// ORGANISATION-level config, so the API token needs the "Access: Organizations
// (Edit)" permission in addition to "Access: Apps". If it doesn't, we skip with
// a clear manual instruction rather than failing the whole run.
const LOGIN_DESIGN = {
  background_color: '#000000',
  text_color: '#ffffff',
  header_text: 'nvdk',
  footer_text: '',
};
try {
  const org = await cf('GET', '/organizations');
  const merged = { login_design: { ...(org.login_design ?? {}), ...LOGIN_DESIGN } };
  await cf('PUT', '/organizations', merged);
  console.log('✓ login page background set to black');
} catch (err) {
  console.warn(
    '⚠ could not set login-page colour automatically:\n  ' +
      String(err.message || err) +
      '\n  The API token likely lacks "Access: Organizations (Edit)".\n' +
      '  Set it by hand: Zero Trust dashboard → Settings → Custom Pages →\n' +
      '  Login page → Background color → #000000  (text #ffffff).',
  );
}

// Patch wrangler.toml.
const TOML_PATH = 'wrangler.toml';
const toml = readFileSync(TOML_PATH, 'utf8');
const AUD_LINE = /^CF_ACCESS_AUD\s*=\s*".*"$/m;
if (!AUD_LINE.test(toml)) {
  console.warn('wrangler.toml had no CF_ACCESS_AUD line to replace — add it manually.');
} else if (toml.includes(`CF_ACCESS_AUD = "${app.aud}"`)) {
  console.log('· wrangler.toml CF_ACCESS_AUD already current');
} else {
  writeFileSync(TOML_PATH, toml.replace(AUD_LINE, `CF_ACCESS_AUD = "${app.aud}"`));
  console.log(`✓ wrote CF_ACCESS_AUD = "${app.aud}" to wrangler.toml`);
}

console.log('\nRedeploy: npm run deploy');
