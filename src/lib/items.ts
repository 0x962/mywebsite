/**
 * R2-backed store for owner-authored canvas items — the "things on the desk"
 * the signed-in owner adds at runtime from the live page (a link, a post-it,
 * a text note, an image, a borderless embed). Build-time items still live in
 * the page source; THIS store holds the ones added after deploy.
 *
 * One array per page, `items-<page>.json`, in the POSTS bucket. The home page
 * reads it at SSR time and renders each item inside a <Place> keyed by the
 * item id, so the existing layout store (positions) merges over it cleanly —
 * dragging an added item persists exactly like a built-in one.
 */
const ITEMS_KEY = (page: string) => `items-${page}.json`;

export const ITEM_KINDS = ['link', 'postit', 'text', 'image', 'embed'] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

export const ITEM_COLORS = ['amber', 'blue', 'green', 'pink', 'paper', 'white'] as const;
export type ItemColor = (typeof ITEM_COLORS)[number];

export interface CanvasItem {
  id: string;
  kind: ItemKind;
  /** Desktop-baseline placement (design-px). Owner drags refine it per breakpoint. */
  x: number;
  y: number;
  rotate?: number;
  z?: number;
  w?: number;
  h?: number;
  /** Link label / post-it heading / image alt. */
  title?: string;
  /** Post-it body / freestanding text. */
  text?: string;
  /** Destination for link / image / (optional) post-it. */
  href?: string;
  /** Source for image / embed. */
  src?: string;
  color?: ItemColor;
}

const ID_RE = /^item-[a-z0-9]{6,32}$/;
const isStr = (v: unknown): v is string => typeof v === 'string';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const clampPos = (n: number) => Math.max(-20000, Math.min(20000, Math.round(n)));
const clampDim = (n: number) => Math.max(20, Math.min(4000, Math.round(n)));

/** http(s) absolute, or a site-relative path. Embeds must be https. */
const isHttpish = (v: unknown): v is string =>
  isStr(v) && (/^https?:\/\/[^\s]+$/.test(v) || /^\/[^\s]*$/.test(v));
const isHttps = (v: unknown): v is string => isStr(v) && /^https:\/\/[^\s]+$/.test(v);

const trimTo = (v: unknown, n: number): string | undefined => {
  if (!isStr(v)) return undefined;
  const s = v.trim();
  return s ? s.slice(0, n) : undefined;
};

export function newItemId(): string {
  const rnd =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 12)
      : Math.abs(Date.now()).toString(36) + Math.floor(performance?.now?.() ?? 0).toString(36);
  return `item-${rnd}`;
}

/**
 * Coerce an untrusted item payload (from the owner's add form) into a clean
 * CanvasItem, or return null if it can't be made valid for its kind. The id is
 * assigned here — clients never choose it.
 */
export function sanitizeNewItem(raw: unknown): CanvasItem | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (!ITEM_KINDS.includes(r.kind as ItemKind)) return null;
  const kind = r.kind as ItemKind;

  const item: CanvasItem = {
    id: newItemId(),
    kind,
    x: isNum(r.x) ? clampPos(r.x) : 120,
    y: isNum(r.y) ? clampPos(r.y) : 120,
  };
  if (isNum(r.rotate)) item.rotate = Math.max(-180, Math.min(180, Math.round(r.rotate)));
  if (isNum(r.z)) item.z = Math.max(0, Math.min(999, Math.round(r.z)));
  if (isNum(r.w)) item.w = clampDim(r.w);
  if (isNum(r.h)) item.h = clampDim(r.h);

  const title = trimTo(r.title, 200);
  const text = trimTo(r.text, 2000);
  const href = isHttpish(r.href) ? r.href : undefined;
  if (ITEM_COLORS.includes(r.color as ItemColor)) item.color = r.color as ItemColor;

  switch (kind) {
    case 'link':
      if (!href) return null;
      item.href = href;
      item.title = title ?? href;
      break;
    case 'postit':
      if (!title && !text) return null;
      if (title) item.title = title;
      if (text) item.text = text;
      if (href) item.href = href;
      item.color = item.color ?? 'amber';
      break;
    case 'text':
      if (!text) return null;
      item.text = text;
      item.color = item.color ?? 'white';
      break;
    case 'image':
      if (!isHttpish(r.src)) return null;
      item.src = r.src as string;
      if (title) item.title = title;
      if (href) item.href = href;
      break;
    case 'embed':
      if (!isHttps(r.src)) return null; // embeds must be https
      item.src = r.src as string;
      item.w = item.w ?? 560;
      item.h = item.h ?? 360;
      break;
  }
  return item;
}

function sanitizeStored(raw: unknown): CanvasItem | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (!isStr(r.id) || !ID_RE.test(r.id)) return null;
  const cleaned = sanitizeNewItem(r);
  if (!cleaned) return null;
  cleaned.id = r.id; // keep the persisted id rather than minting a new one
  return cleaned;
}

/** Missing or corrupt items object reads as an empty list — never throws. */
export async function readItems(bucket: R2Bucket, page: string): Promise<CanvasItem[]> {
  const obj = await bucket.get(ITEMS_KEY(page));
  if (!obj) return [];
  try {
    const arr = JSON.parse(await obj.text());
    return Array.isArray(arr) ? arr.map(sanitizeStored).filter((x): x is CanvasItem => !!x) : [];
  } catch {
    return [];
  }
}

export async function writeItems(bucket: R2Bucket, page: string, items: CanvasItem[]): Promise<void> {
  await bucket.put(ITEMS_KEY(page), JSON.stringify(items, null, 2), {
    httpMetadata: { contentType: 'application/json' },
  });
}
