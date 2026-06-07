/**
 * KV-backed scene + post-metadata storage.
 *
 * Keys:
 *   scene:<slug>  → Excalidraw scene JSON (string, parsed by callers)
 *   post:<slug>   → PostMeta JSON (for posts created via /admin; existing
 *                   posts authored as src/content/posts/<slug>.mdx are NOT
 *                   mirrored here — frontmatter remains the source of truth
 *                   for them)
 *   posts:index   → JSON array of slugs created via /admin (cheap list)
 */

export interface PostMeta {
  slug: string;
  title: string;
  date: string;          // ISO
  summary: string;
  /** Hidden from home/RSS until promoted to a frontmatter file. */
  draft?: boolean;
}

const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const isSlug = (s: unknown): s is string => typeof s === 'string' && SLUG.test(s);

export const BLANK_SCENE = {
  type: 'excalidraw',
  version: 2,
  source: 'nvdk.co',
  elements: [] as unknown[],
  appState: { viewBackgroundColor: '#ffffff' },
  files: {} as Record<string, unknown>,
};

export const sceneKey = (slug: string) => `scene:${slug}`;
export const postKey  = (slug: string) => `post:${slug}`;
export const INDEX_KEY = 'posts:index';

export async function readScene(kv: KVNamespace, slug: string): Promise<unknown> {
  const raw = await kv.get(sceneKey(slug));
  if (!raw) return BLANK_SCENE;
  try { return JSON.parse(raw); } catch { return BLANK_SCENE; }
}

export async function writeScene(kv: KVNamespace, slug: string, scene: unknown): Promise<void> {
  await kv.put(sceneKey(slug), JSON.stringify(scene));
}

export async function readPostMeta(kv: KVNamespace, slug: string): Promise<PostMeta | null> {
  const raw = await kv.get(postKey(slug));
  if (!raw) return null;
  try { return JSON.parse(raw) as PostMeta; } catch { return null; }
}

export async function writePostMeta(kv: KVNamespace, meta: PostMeta): Promise<void> {
  await kv.put(postKey(meta.slug), JSON.stringify(meta));
}

export async function listPostSlugs(kv: KVNamespace): Promise<string[]> {
  const raw = await kv.get(INDEX_KEY);
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter(isSlug) : [];
  } catch { return []; }
}

export async function addToIndex(kv: KVNamespace, slug: string): Promise<void> {
  const current = await listPostSlugs(kv);
  if (current.includes(slug)) return;
  await kv.put(INDEX_KEY, JSON.stringify([...current, slug]));
}
