import { describe, expect, it } from 'vitest';
import {
  isEmbedUrl,
  isSlug,
  POSTS_KEY,
  publishedPosts,
  readAllPosts,
  writeAllPosts,
  type Post,
} from './posts';

/** Minimal in-memory stand-in for the two R2Bucket methods posts.ts uses. */
function fakeBucket(initial?: string) {
  const store = new Map<string, string>();
  if (initial !== undefined) store.set(POSTS_KEY, initial);
  return {
    store,
    async get(key: string) {
      const v = store.get(key);
      return v === undefined ? null : { text: async () => v };
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
  } as unknown as R2Bucket & { store: Map<string, string> };
}

const post = (over: Partial<Post> = {}): Post => ({
  slug: 'plot',
  title: 'Plot',
  summary: '',
  embedUrl: 'https://link.excalidraw.com/readonly/psnMm8Nsg0mNNkHKQwi3?darkMode=true',
  createdAt: '2026-05-28T00:00:00.000Z',
  updatedAt: '2026-06-09T00:00:00.000Z',
  published: true,
  ...over,
});

describe('isSlug', () => {
  it('accepts kebab slugs', () => expect(isSlug('plot-2')).toBe(true));
  it('rejects uppercase/slashes/empty', () => {
    expect(isSlug('Plot')).toBe(false);
    expect(isSlug('a/b')).toBe(false);
    expect(isSlug('')).toBe(false);
    expect(isSlug(42)).toBe(false);
  });
});

describe('isEmbedUrl', () => {
  it('accepts readonly excalidraw links incl. query params', () => {
    expect(isEmbedUrl('https://link.excalidraw.com/readonly/abc123?darkMode=true')).toBe(true);
    expect(isEmbedUrl('https://link.excalidraw.com/readonly/abc123')).toBe(true);
  });
  it('rejects other urls', () => {
    expect(isEmbedUrl('https://link.excalidraw.com/l/abc/def')).toBe(false);
    expect(isEmbedUrl('https://evil.com/readonly/abc')).toBe(false);
    expect(isEmbedUrl('')).toBe(false);
    expect(isEmbedUrl(null)).toBe(false);
  });
});

describe('readAllPosts', () => {
  it('returns [] when object missing', async () => {
    expect(await readAllPosts(fakeBucket())).toEqual([]);
  });
  it('returns [] on corrupt json', async () => {
    expect(await readAllPosts(fakeBucket('{nope'))).toEqual([]);
  });
  it('round-trips through writeAllPosts and drops malformed entries', async () => {
    const b = fakeBucket();
    await writeAllPosts(b, [post()]);
    b.store.set(POSTS_KEY, JSON.stringify([...JSON.parse(b.store.get(POSTS_KEY)!), { junk: true }]));
    expect(await readAllPosts(b)).toEqual([post()]);
  });
});

describe('publishedPosts', () => {
  it('filters drafts and sorts newest first', () => {
    const a = post({ slug: 'a', createdAt: '2026-01-01T00:00:00.000Z' });
    const b = post({ slug: 'b', createdAt: '2026-02-01T00:00:00.000Z' });
    const d = post({ slug: 'd', published: false });
    expect(publishedPosts([a, d, b]).map((p) => p.slug)).toEqual(['b', 'a']);
  });
});
