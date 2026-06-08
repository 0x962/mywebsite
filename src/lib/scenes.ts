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
 * Write the scene + metadata. Before overwriting, snapshot the existing scene
 * into `history:<slug>:<iso-timestamp>` so any save is recoverable. KV has no
 * native versioning, so this manual history layer is the only safety net.
 *
 * Caller passes `prior` (the scene we're about to overwrite). We don't read
 * it ourselves because the PUT handler already has the previous value in
 * scope from a `getWithMetadata` it does for the meta check.
 */
export async function writeScene(
  kv: KVNamespace,
  slug: string,
  scene: unknown,
  meta: SceneMeta,
  prior?: { value: string; meta: SceneMeta | null },
): Promise<void> {
  if (prior && prior.value) {
    const ts = meta.lastEditedAt; // ISO; same as the new write's timestamp
    const histKey = `history:${slug}:${ts}`;
    await kv.put(histKey, prior.value, {
      metadata: prior.meta ?? undefined,
      // 1-year backstop. Real retention is capped by HISTORY_MAX via prune.
      expirationTtl: 365 * 24 * 60 * 60,
    });
  }
  await kv.put(sceneKey(slug), JSON.stringify(scene), { metadata: meta });
}

/** Last N history snapshots we keep per slug. Older are pruned on each save. */
export const HISTORY_MAX = 500;

/**
 * Delete history entries past `HISTORY_MAX` (oldest first). Cheap when the
 * count is small; runs after every successful save.
 */
export async function pruneHistory(kv: KVNamespace, slug: string): Promise<number> {
  const prefix = `history:${slug}:`;
  const { keys } = await kv.list({ prefix, limit: 1000 });
  if (keys.length <= HISTORY_MAX) return 0;
  // Sort newest first by the ISO suffix; everything after HISTORY_MAX gets deleted.
  const sorted = [...keys].sort((a, b) => (a.name < b.name ? 1 : -1));
  const toDelete = sorted.slice(HISTORY_MAX);
  await Promise.all(toDelete.map((k) => kv.delete(k.name)));
  return toDelete.length;
}

/**
 * Read both the raw value and metadata for the CURRENT scene — used by the
 * PUT handler to capture `prior` for the history snapshot.
 */
export async function readSceneWithMeta(
  kv: KVNamespace,
  slug: string,
): Promise<{ value: string; meta: SceneMeta | null } | null> {
  const { value, metadata } = await kv.getWithMetadata<SceneMeta>(sceneKey(slug), { type: 'text' });
  if (!value) return null;
  return { value, meta: metadata ?? null };
}

/* ------------------------------------------------------------------ history */

export interface HistoryEntry {
  /** Full key, e.g. "history:plot:2026-06-07T22:35:05.123Z" */
  key: string;
  /** ISO timestamp parsed from the key */
  ts: string;
  /** Metadata of the snapshot — who wrote it and when. May be null on legacy. */
  meta: SceneMeta | null;
}

/**
 * List all history snapshots for a slug, newest first. Returns just the
 * pointer + metadata; the snapshot body is fetched on demand via readHistory.
 */
export async function listHistory(kv: KVNamespace, slug: string): Promise<HistoryEntry[]> {
  const prefix = `history:${slug}:`;
  const { keys } = await kv.list<SceneMeta>({ prefix, limit: 1000 });
  return keys
    .map((k) => ({ key: k.name, ts: k.name.slice(prefix.length), meta: k.metadata ?? null }))
    .sort((a, b) => (a.ts < b.ts ? 1 : -1));
}

/** Read a specific historical snapshot. */
export async function readHistory(
  kv: KVNamespace,
  histKey: string,
): Promise<{ scene: unknown; meta: SceneMeta | null } | null> {
  const { value, metadata } = await kv.getWithMetadata<SceneMeta>(histKey, { type: 'text' });
  if (!value) return null;
  try {
    return { scene: JSON.parse(value), meta: metadata ?? null };
  } catch {
    return null;
  }
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
