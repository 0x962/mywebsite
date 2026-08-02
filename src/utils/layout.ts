/**
 * Build-time loader for saved canvas layouts. Reads src/data/layouts/<page>.json
 * (written by the dev-only drag editor) if it exists, else returns {}. The code
 * props on each <Place> remain the initial fallback; saved values override them.
 */
export interface PlaceLayout {
  x?: number;
  y?: number;
  rotate?: number;
  z?: number;
  w?: number;
}
export type PageLayout = Record<string, Partial<Record<'desktop' | 'tablet' | 'mobile', PlaceLayout>>>;

const modules = import.meta.glob<{ default: PageLayout }>('/src/data/layouts/*.json', { eager: true });

export function loadLayout(page: string): PageLayout {
  return modules[`/src/data/layouts/${page}.json`]?.default ?? {};
}

const BREAKPOINTS = ['desktop', 'tablet', 'mobile'] as const;

/**
 * Overlay a runtime layout (e.g. the owner's live R2 saves) on top of a base
 * layout (the committed build-time file). Per element, per breakpoint, the
 * override's fields win and the base's fields fill the gaps.
 */
export function mergeLayouts(base: PageLayout, override: PageLayout): PageLayout {
  const out: PageLayout = { ...base };
  for (const [id, ov] of Object.entries(override)) {
    const b = out[id] ?? {};
    const entry: PageLayout[string] = { ...b };
    for (const bp of BREAKPOINTS) {
      const merged = { ...b[bp], ...ov[bp] };
      if (Object.keys(merged).length) entry[bp] = merged;
    }
    out[id] = entry;
  }
  return out;
}
