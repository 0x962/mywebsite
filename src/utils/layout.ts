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
