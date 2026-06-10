/**
 * One-shot: seed posts.json into the POSTS R2 bucket.
 * Local (wrangler dev storage):  node scripts/seed-posts.mjs
 * Production:                    node scripts/seed-posts.mjs --remote
 * Refuses to overwrite an existing posts.json unless --force is passed.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BUCKET = 'nvdk-posts';
const KEY = 'posts.json';
const remote = process.argv.includes('--remote');
const force = process.argv.includes('--force');
const flag = remote ? '--remote' : '--local';

const now = new Date().toISOString();
const posts = [
  {
    slug: 'plot',
    title: 'Plot: My wishlist for SuperSet',
    summary:
      'A living wishlist for the agent tools I use all day. Make the diff the main surface and let me comment on it. Show me the change in plain English with a reason on every edit. Treat context like git. And surface the to-do list the agent already keeps.',
    embedUrl: 'https://link.excalidraw.com/readonly/psnMm8Nsg0mNNkHKQwi3?darkMode=true',
    createdAt: '2026-05-28T00:00:00.000Z',
    updatedAt: now,
    published: true,
  },
  {
    slug: 'prompt',
    title: 'PromptHub',
    summary: '',
    embedUrl: '',
    createdAt: '2026-05-28T00:00:00.000Z',
    updatedAt: now,
    published: false,
  },
  {
    slug: 'browser-plugin-for-ui-design',
    title: 'Two ways to change a UI',
    summary:
      'Two ways to spin up modified versions of our UI fast with AI — copy the frontend and edit the copy, or edit the real product live in the browser — and what each would actually take.',
    embedUrl: '',
    createdAt: '2026-05-27T00:00:00.000Z',
    updatedAt: now,
    published: false,
  },
];

const run = (args) =>
  execFileSync('npx', ['wrangler', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

if (!force) {
  try {
    run(['r2', 'object', 'get', `${BUCKET}/${KEY}`, flag, '--pipe']);
    console.error(`${KEY} already exists in ${BUCKET} (${flag}); pass --force to overwrite.`);
    process.exit(1);
  } catch {
    /* missing — good, proceed */
  }
}

const dir = mkdtempSync(join(tmpdir(), 'seed-posts-'));
const file = join(dir, KEY);
writeFileSync(file, JSON.stringify(posts, null, 2));
try {
  run(['r2', 'object', 'put', `${BUCKET}/${KEY}`, `--file=${file}`, flag, '--content-type', 'application/json']);
  console.log(`Seeded ${posts.length} posts into ${BUCKET}/${KEY} (${flag}).`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
