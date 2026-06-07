/**
 * Bundle the three default Excalidraw libraries (HTML inputs, wireframing
 * placeholders, desktop resolutions) into a single `libraryItems` array that
 * gets passed via `initialData.libraryItems` on canvas mount. That seeds every
 * visitor with the same set of stencils without requiring per-browser
 * localStorage state.
 *
 * Two formats in the wild:
 *   v1: { library: ExcalidrawElement[][] }              ← one inner array per item
 *   v2: { libraryItems: { id, status, elements, … }[] }
 * v1 entries are normalised into v2 shape with synthetic ids.
 */
import htmlInputs from '../data/excalidraw-libraries/html-input-elements.excalidrawlib?raw';
import placeholders from '../data/excalidraw-libraries/wireframing-placeholders.excalidrawlib?raw';
import desktops from '../data/excalidraw-libraries/desktop-resolutions.excalidrawlib?raw';

interface LibraryV2Item {
  id: string;
  status: string;
  elements: unknown[];
  created: number;
  name?: string;
}

function normalise(raw: string, key: string): LibraryV2Item[] {
  const parsed = JSON.parse(raw) as
    | { type: string; version: 2; libraryItems: LibraryV2Item[] }
    | { type: string; version: 1; library: unknown[][] };
  if ('libraryItems' in parsed) return parsed.libraryItems;
  // v1 — each inner array is one item's elements.
  return parsed.library.map((elements, i) => ({
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
