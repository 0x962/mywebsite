/**
 * R2-backed runtime layout store for the interactive ("desktop") canvas.
 *
 * The committed src/data/layouts/<page>.json (authored by the dev drag editor)
 * is the build-time baseline. THIS store is the live, owner-editable overlay:
 * when the signed-in owner drags a tile on the production page it's PUT here,
 * and the SSR page merges it over the build-time baseline (see utils/layout's
 * mergeLayouts). Guests never write here — their arrangement lives in their own
 * browser's localStorage.
 *
 * One object per page, `layout-<page>.json`, in the same POSTS bucket. Shape
 * matches PageLayout so it merges cleanly with the build-time file.
 */
import type { PageLayout, PlaceLayout } from '../utils/layout';

const LAYOUT_KEY = (page: string) => `layout-${page}.json`;

const ID = /^[a-z0-9][a-z0-9-]{0,80}$/;
export const isLayoutId = (s: unknown): s is string => typeof s === 'string' && ID.test(s);

const BREAKPOINTS = ['desktop', 'tablet', 'mobile'] as const;
export type Breakpoint = (typeof BREAKPOINTS)[number];
export const isBreakpoint = (s: unknown): s is Breakpoint => BREAKPOINTS.includes(s as Breakpoint);

const FIELDS = ['x', 'y', 'rotate', 'z', 'w'] as const;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const clamp = (n: number) => Math.max(-20000, Math.min(20000, Math.round(n)));

/** Coerce an untrusted patch to a clean {x?,y?,rotate?,z?,w?}; null if invalid. */
export function sanitizePatch(patch: unknown): PlaceLayout | null {
  if (typeof patch !== 'object' || patch === null) return null;
  const p = patch as Record<string, unknown>;
  const out: PlaceLayout = {};
  for (const k of FIELDS) {
    if (p[k] === undefined) continue;
    if (!isNum(p[k])) return null;
    out[k] = clamp(p[k] as number);
  }
  return Object.keys(out).length ? out : null;
}

function sanitizeLayout(raw: unknown): PageLayout {
  const out: PageLayout = {};
  if (typeof raw !== 'object' || raw === null) return out;
  for (const [id, val] of Object.entries(raw as Record<string, unknown>)) {
    if (!isLayoutId(id) || typeof val !== 'object' || val === null) continue;
    const entry: PageLayout[string] = {};
    for (const bp of BREAKPOINTS) {
      const p = sanitizePatch((val as Record<string, unknown>)[bp]);
      if (p) entry[bp] = p;
    }
    if (Object.keys(entry).length) out[id] = entry;
  }
  return out;
}

/** Missing or corrupt object reads as an empty layout — never throws. */
export async function readLayout(bucket: R2Bucket, page: string): Promise<PageLayout> {
  const obj = await bucket.get(LAYOUT_KEY(page));
  if (!obj) return {};
  try {
    return sanitizeLayout(JSON.parse(await obj.text()));
  } catch {
    return {};
  }
}

export async function writeLayout(bucket: R2Bucket, page: string, layout: PageLayout): Promise<void> {
  await bucket.put(LAYOUT_KEY(page), JSON.stringify(layout, null, 2), {
    httpMetadata: { contentType: 'application/json' },
  });
}

/** Merge one element's per-breakpoint patch into a layout, returning a new layout. */
export function applyPatch(
  layout: PageLayout,
  id: string,
  bp: Breakpoint,
  patch: PlaceLayout,
): PageLayout {
  const entry = { ...(layout[id] ?? {}) };
  entry[bp] = { ...(entry[bp] ?? {}), ...patch };
  return { ...layout, [id]: entry };
}
