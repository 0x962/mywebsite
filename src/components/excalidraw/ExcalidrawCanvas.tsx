import { Excalidraw, serializeAsJSON } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import { useCallback, useRef, useState } from "react";

/**
 * Excalidraw canvas island. Renders the vendored-from-source Excalidraw editor.
 *
 *   • editable=false (default) → read-only canvas for visitors (viewModeEnabled).
 *     The host controls this, so visitors cannot toggle back into edit mode.
 *   • editable=true (DEV + ?edit) → full editor. Every change is debounced,
 *     serialized with Excalidraw's serializeAsJSON, and POSTed to the dev-only
 *     /__canvas/scene endpoint, which writes src/data/scenes/<slug>.json.
 *   • initialData → a saved scene { elements, appState, files }.
 *
 * Mounted as `client:only="react"` — Excalidraw is browser-only (canvas, workers).
 */
interface Props {
  /** A saved Excalidraw scene: { elements, appState, files }. */
  initialData?: Record<string, unknown> | null;
  /** Post slug — the scene file key (src/data/scenes/<slug>.json). */
  slug?: string;
  /**
   * Force edit/read mode. When omitted, edit mode auto-detects: DEV build + ?edit
   * in the URL. (Detection must happen client-side — Astro strips searchParams
   * from statically-rendered pages, and import.meta.env.DEV compiles to false in
   * the production bundle, so this can never enable editing for visitors.)
   */
  editable?: boolean;
}

const SAVE_DEBOUNCE_MS = 800;

function detectEditable(): boolean {
  return (
    import.meta.env.DEV &&
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).has("edit")
  );
}

export default function ExcalidrawCanvas({ initialData = null, slug, editable }: Props) {
  const isEditable = editable ?? detectEditable();
  const [status, setStatus] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onChange = useCallback(
    (elements: any, appState: any, files: any) => {
      if (!isEditable || !slug) return;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(async () => {
        const json = serializeAsJSON(elements, appState, files, "local");
        setStatus("saving…");
        try {
          const res = await fetch("/__canvas/scene", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ slug, json }),
          });
          setStatus(res.ok ? `saved ${slug}` : `save failed: ${await res.text()}`);
        } catch (err) {
          setStatus(`save failed: ${err}`);
        }
      }, SAVE_DEBOUNCE_MS);
    },
    [isEditable, slug],
  );

  return (
    <div style={{ position: "fixed", inset: 0 }}>
      <Excalidraw
        initialData={initialData}
        viewModeEnabled={!isEditable}
        onChange={isEditable ? onChange : undefined}
      />
      {isEditable && (
        <div
          style={{
            position: "fixed",
            left: 16,
            bottom: 16,
            zIndex: 100000,
            font: "11px var(--font-mono, monospace)",
            color: "#d4d4d8",
            background: "rgba(10,10,11,0.92)",
            border: "1px solid #27272a",
            borderRadius: 6,
            padding: "6px 9px",
            pointerEvents: "none",
          }}
        >
          {status || `editing ${slug ?? "(no slug)"}`}
        </div>
      )}
    </div>
  );
}
