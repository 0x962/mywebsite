import { Excalidraw } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";

/**
 * Excalidraw canvas island. Renders the vendored-from-source Excalidraw editor.
 *
 *   • viewMode (default true) → read-only canvas for visitors. The host controls
 *     this, so visitors cannot toggle back into edit mode.
 *   • initialData → a saved scene { elements, appState, files }.
 *
 * Mounted as `client:only="react"` — Excalidraw is browser-only (canvas, workers).
 */
interface Props {
  /** A saved Excalidraw scene: { elements, appState, files }. */
  initialData?: Record<string, unknown> | null;
  viewMode?: boolean;
}

export default function ExcalidrawCanvas({ initialData = null, viewMode = true }: Props) {
  return (
    <div style={{ position: "fixed", inset: 0 }}>
      <Excalidraw initialData={initialData} viewModeEnabled={viewMode} />
    </div>
  );
}
