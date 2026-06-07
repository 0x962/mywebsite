#!/usr/bin/env node
/**
 * One-shot: create the three Cloudflare Access self-hosted applications
 * needed to gate /admin, /api/posts, and the write methods on /api/scenes.
 *
 *   node scripts/setup-access.mjs
 *
 * Reads CF_ACCESS_API_TOKEN from .env. Idempotent: if an app with the
 * same name already exists, it is reused (no duplicate created). Each
 * app's AUD is captured; if all three match we write a single AUD into
 * wrangler.toml — otherwise we error so the caller can decide what to do.
 *
 * Required token permissions:
 *   Account · Access: Apps and Policies · Edit
 *
 * The Allow policy grants ADMIN_EMAILS (default n@nvdk.co). The default
 * One-time PIN identity provider is used (Cloudflare provides it without
 * explicit creation when no other IdP is attached).
 */
import { readFileSync, writeFileSync } from 'node:fs';

const ACCOUNT_ID = '123440327a67db0da0c8f99fa3394777';
const ADMIN_EMAIL = 'n@nvdk.co';
const SESSION = '720h'; // 30 days

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

const APPS = [
  {
    name: 'nvdk admin',
    self_hosted_domains: ['nvdk.co/admin', 'nvdk.co/admin/*'],
  },
  {
    name: 'nvdk posts api',
    self_hosted_domains: ['nvdk.co/api/posts', 'nvdk.co/api/posts/*'],
  },
  {
    // GET /api/scenes/* stays public; we only require auth on writes.
    name: 'nvdk scenes write',
    self_hosted_domains: ['nvdk.co/api/scenes/*'],
    http_only_cookie_attribute: false,
    // Method-scoped: only these methods trigger Access.
    allowed_request_methods: ['PUT', 'POST', 'DELETE'],
  },
];

console.log('Loading existing apps…');
const existing = await cf('GET', '/apps');
const byName = new Map(existing.map((a) => [a.name, a]));

const results = [];
for (const spec of APPS) {
  const found = byName.get(spec.name);
  let app;
  if (found) {
    console.log(`  · ${spec.name} already exists (${found.id})`);
    app = found;
  } else {
    console.log(`  + creating ${spec.name}…`);
    app = await cf('POST', '/apps', {
      type: 'self_hosted',
      session_duration: SESSION,
      app_launcher_visible: false,
      auto_redirect_to_identity: false,
      ...spec,
    });
    console.log(`    created ${app.id}`);
  }
  results.push(app);

  // Ensure an Allow policy exists for this app.
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
}

console.log('\nAUDs:');
for (const a of results) console.log(`  ${a.name.padEnd(20)} ${a.aud}`);

const auds = results.map((a) => a.aud);
const uniq = [...new Set(auds)];
console.log(`\n${uniq.length} unique AUD(s):`, uniq);

if (uniq.length !== 1) {
  console.log(
    '\nMultiple AUDs — leaving wrangler.toml alone. ' +
      'Update CF_ACCESS_AUD manually, or extend src/lib/auth.ts to accept a comma list.',
  );
  process.exit(0);
}

// Patch wrangler.toml CF_ACCESS_AUD line.
const aud = uniq[0];
const TOML_PATH = 'wrangler.toml';
let toml = readFileSync(TOML_PATH, 'utf8');
const newToml = toml.replace(
  /^CF_ACCESS_AUD\s*=\s*".*"$/m,
  `CF_ACCESS_AUD = "${aud}"`,
);
if (newToml === toml) {
  console.warn('wrangler.toml had no CF_ACCESS_AUD line to replace — add it manually.');
} else {
  writeFileSync(TOML_PATH, newToml);
  console.log(`\n✓ wrote CF_ACCESS_AUD = "${aud}" to wrangler.toml`);
}

console.log('\nRedeploy: npm run deploy');
