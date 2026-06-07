/**
 * Bundle the three default Excalidraw libraries (HTML inputs, wireframing
 * placeholders, desktop resolutions) into a single `libraryItems` array that
 * gets passed via `initialData.libraryItems` on canvas mount. That seeds every
 * visitor with the same set of stencils without per-browser localStorage state.
 *
 * Two formats in the wild:
 *   v1: { library: ExcalidrawElement[][] }              ← one inner array per item
 *   v2: { libraryItems: { id, status, elements, … }[] }
 * v1 entries are normalised into v2 shape with synthetic ids.
 *
 * Files are stored as `.json` (not `.excalidrawlib`) so Vite handles them as
 * native JSON modules — the `?raw` import on the original extension was
 * silently failing to bundle.
 */
import htmlInputs from '../data/excalidraw-libraries/html-input-elements.json';
import placeholders from '../data/excalidraw-libraries/wireframing-placeholders.json';
import desktops from '../data/excalidraw-libraries/desktop-resolutions.json';

interface LibraryV2Item {
  id: string;
  status: string;
  elements: unknown[];
  created: number;
  name?: string;
}

interface RawV2 { libraryItems: LibraryV2Item[] }
interface RawV1 { library: unknown[][] }

function normalise(raw: unknown, key: string): LibraryV2Item[] {
  if (raw && typeof raw === 'object' && 'libraryItems' in raw) {
    return (raw as RawV2).libraryItems;
  }
  // v1 — each inner array is one item's elements.
  const v1 = raw as RawV1;
  return (v1.library ?? []).map((elements, i) => ({
    id: `${key}-${i}`,
    status: 'published',
    elements,
    created: 0,
  }));
}

export const DEFAULT_LIBRARY_ITEMS: LibraryV2Item[] = [
  ...normalise(htmlInputs, 'html-inputs'),
  ...normalise(placeholders, 'placeholders'),
  ...normalise(desktops, 'desktops'),
];
