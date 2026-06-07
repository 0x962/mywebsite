#!/usr/bin/env node
/**
 * Seed the production `scenes` KV namespace with blank scene entries for every
 * post in src/content/posts/. Idempotent: only writes keys that don't exist.
 *
 *   npm run seed-kv
 *
 * Each existing post gets `scene:<slug>` → blank Excalidraw scene so the
 * /api/scenes/<slug> read path returns something sensible immediately. The
 * actual content is authored via /admin or /wip/<slug>/?edit.
 */
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const NAMESPACE = 'scenes';
const BLANK = JSON.stringify({
  type: 'excalidraw',
  version: 2,
  source: 'nvdk.co',
  elements: [],
  appState: { viewBackgroundColor: '#ffffff' },
  files: {},
});

const wrangler = (args) => execFileSync('npx', ['wrangler', ...args], { encoding: 'utf8' });

const postDir = join(process.cwd(), 'src/content/posts');
const slugs = readdirSync(postDir)
  .filter((f) => /\.mdx?$/.test(f))
  .map((f) => f.replace(/\.mdx?$/, ''));

console.log(`Seeding ${slugs.length} slug(s): ${slugs.join(', ')}`);

for (const slug of slugs) {
  const key = `scene:${slug}`;
  // Check if it already exists; skip if so.
  let exists = false;
  try {
    const out = wrangler(['kv', 'key', 'get', key, `--namespace-id=74782c54096c419397d9fde4495b1d70`, '--remote']);
    if (out && out.trim()) exists = true;
  } catch {
    // not found is fine
  }
  if (exists) {
    console.log(`  · ${key} already exists, skipping`);
    continue;
  }

  wrangler([
    'kv', 'key', 'put',
    key, BLANK,
    `--namespace-id=74782c54096c419397d9fde4495b1d70`,
    '--remote',
  ]);
  console.log(`  + ${key} seeded`);
}

console.log('Done.');
