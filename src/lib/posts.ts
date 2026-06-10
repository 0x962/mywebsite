/**
 * R2-backed post store. Posts are authored in Excalidraw+; we keep only
 * metadata + the readonly embed URL, all in a single `posts.json` object.
 * This module is the only code that touches the POSTS bucket.
 */

export interface Post {
  slug: string;
  title: string;
  summary: string;
  /** Excalidraw+ readonly link. Empty string allowed while unpublished. */
  embedUrl: string;
  createdAt: string; // ISO
  updatedAt: string; // ISO
  published: boolean;
}

export const POSTS_KEY = 'posts.json';

const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const isSlug = (s: unknown): s is string => typeof s === 'string' && SLUG.test(s);

const EMBED = /^https:\/\/link\.excalidraw\.com\/readonly\/[A-Za-z0-9_-]+(\?.*)?$/;
export const isEmbedUrl = (u: unknown): u is string => typeof u === 'string' && EMBED.test(u);

function isPost(p: unknown): p is Post {
  if (typeof p !== 'object' || p === null) return false;
  const x = p as Record<string, unknown>;
  return (
    isSlug(x.slug) &&
    typeof x.title === 'string' &&
    typeof x.summary === 'string' &&
    typeof x.embedUrl === 'string' &&
    typeof x.createdAt === 'string' &&
    typeof x.updatedAt === 'string' &&
    typeof x.published === 'boolean'
  );
}

/** Missing or corrupt posts.json reads as an empty list — never throws. */
export async function readAllPosts(bucket: R2Bucket): Promise<Post[]> {
  const obj = await bucket.get(POSTS_KEY);
  if (!obj) return [];
  try {
    const arr = JSON.parse(await obj.text());
    return Array.isArray(arr) ? arr.filter(isPost) : [];
  } catch {
    return [];
  }
}

export async function writeAllPosts(bucket: R2Bucket, posts: Post[]): Promise<void> {
  await bucket.put(POSTS_KEY, JSON.stringify(posts, null, 2), {
    httpMetadata: { contentType: 'application/json' },
  });
}

export const publishedPosts = (posts: Post[]): Post[] =>
  posts.filter((p) => p.published).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
