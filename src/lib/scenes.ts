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

export const sceneKey  = (slug: string) => `scene:${slug}`;
export const postKey   = (slug: string) => `post:${slug}`;
export const layoutKey = (page: string) => `layout:${page}`;
/**
 * Per-slug publish override for frontmatter-authored posts. The .mdx file
 * is the source of truth for everything EXCEPT draft state — admin can flip
 * { published: true|false } here and the home page / RSS will honour it.
 */
export const overrideKey = (slug: string) => `override:${slug}`;
export const INDEX_KEY = 'posts:index';

/** Per-scene authoring metadata. Stored as KV metadata alongside scene:<slug>. */
export interface SceneMeta {
  lastEditedAt: string;   // ISO
  lastEditedBy: string;   // verified email from the Access JWT
}

export async function readScene(kv: KVNamespace, slug: string): Promise<unknown> {
  const raw = await kv.get(sceneKey(slug));
  if (!raw) return BLANK_SCENE;
  try { return JSON.parse(raw); } catch { return BLANK_SCENE; }
}

/**
 * Read the metadata KV stored alongside the scene blob. Returns null if the
 * key doesn't exist OR if metadata wasn't written (e.g. legacy seeds). The
 * value body is not read — that's `readScene`'s job.
 */
export async function readSceneMeta(kv: KVNamespace, slug: string): Promise<SceneMeta | null> {
  const { metadata } = await kv.getWithMetadata<SceneMeta>(sceneKey(slug), { type: 'text' });
  return metadata ?? null;
}

/**
 * Write the scene blob AND its authoring metadata in a single KV put. KV
 * supports up to 1024 bytes of metadata per key — `SceneMeta` is well under.
 */
export async function writeScene(
  kv: KVNamespace,
  slug: string,
  scene: unknown,
  meta: SceneMeta,
): Promise<void> {
  await kv.put(sceneKey(slug), JSON.stringify(scene), { metadata: meta });
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

/* ---------------------------------------------------------------- overrides */

export interface PublishOverride {
  published: boolean;
}

export async function readOverride(kv: KVNamespace, slug: string): Promise<PublishOverride | null> {
  const raw = await kv.get(overrideKey(slug));
  if (!raw) return null;
  try { return JSON.parse(raw) as PublishOverride; } catch { return null; }
}

export async function writeOverride(kv: KVNamespace, slug: string, ov: PublishOverride): Promise<void> {
  await kv.put(overrideKey(slug), JSON.stringify(ov));
}

export async function deleteOverride(kv: KVNamespace, slug: string): Promise<void> {
  await kv.delete(overrideKey(slug));
}

/**
 * Bulk-read overrides for many slugs in one parallel pass. Caller passes the
 * canonical slug list; each missing entry becomes null. Used by the home page
 * to decide which frontmatter posts to surface.
 */
export async function readManyOverrides(
  kv: KVNamespace,
  slugs: string[],
): Promise<Record<string, PublishOverride | null>> {
  const entries = await Promise.all(slugs.map(async (s) => [s, await readOverride(kv, s)] as const));
  return Object.fromEntries(entries);
}

/* ------------------------------------------------------------------ layouts */

export interface PlaceLayout {
  x?: number; y?: number; rotate?: number; z?: number; w?: number;
}
export type PageLayout = Record<string, Partial<Record<'desktop' | 'tablet' | 'mobile', PlaceLayout>>>;

export async function readLayout(kv: KVNamespace, page: string): Promise<PageLayout> {
  const raw = await kv.get(layoutKey(page));
  if (!raw) return {};
  try { return JSON.parse(raw) as PageLayout; } catch { return {}; }
}

export async function writeLayout(kv: KVNamespace, page: string, layout: PageLayout): Promise<void> {
  await kv.put(layoutKey(page), JSON.stringify(layout));
}

/**
 * Merge a single element-breakpoint patch into the page's stored layout.
 * Used by the live drag editor — sends one patch per drop, not the whole
 * layout. Returns the new layout so the caller can hand it back to the client.
 */
export async function patchLayout(
  kv: KVNamespace,
  page: string,
  id: string,
  breakpoint: 'desktop' | 'tablet' | 'mobile',
  patch: PlaceLayout,
): Promise<PageLayout> {
  const current = await readLayout(kv, page);
  const next: PageLayout = {
    ...current,
    [id]: {
      ...current[id],
      [breakpoint]: { ...current[id]?.[breakpoint], ...patch },
    },
  };
  await writeLayout(kv, page, next);
  return next;
}
