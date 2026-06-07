import { Excalidraw, serializeAsJSON } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import { useCallback, useRef, useState } from "react";

type Theme = "light" | "dark";

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
  /** UI + canvas theme. Defaults to dark to match the site. */
  theme?: Theme;
}

const SAVE_DEBOUNCE_MS = 800;

/**
 * Allow only same-origin /widgets/ URLs to render as live embeddables. Excalidraw
 * blocks any embeddable URL this rejects, so visitors can't be served arbitrary
 * iframes via a tampered scene file.
 */
function validateEmbeddable(url: string): boolean {
  try {
    const u = new URL(url, window.location.origin);
    return u.origin === window.location.origin && u.pathname.startsWith("/widgets/");
  } catch {
    return false;
  }
}

/**
 * Render our own iframe for validated /widgets/ embeddables, with
 * `allow-same-origin allow-scripts` so the (same-origin) widget can load its
 * Astro hydration scripts and run live. Excalidraw's default embeddable sandbox
 * omits allow-same-origin → null origin → blocked scripts. Returning null for
 * anything else falls back to that locked-down default.
 */
function renderEmbeddable(element: { link?: string | null }) {
  const url = element.link;
  if (!url || !validateEmbeddable(url)) return null;
  return (
    <iframe
      title="widget"
      src={url}
      style={{ width: "100%", height: "100%", border: 0 }}
      sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
      allow="clipboard-write"
    />
  );
}

function detectEditable(): boolean {
  return (
    import.meta.env.DEV &&
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).has("edit")
  );
}

export default function ExcalidrawCanvas({ initialData = null, slug, editable, theme = "dark" }: Props) {
  const isEditable = editable ?? detectEditable();
  const [status, setStatus] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Excalidraw fires onChange once on mount echoing the loaded scene. Skip that
  // one so merely opening the page doesn't rewrite the scene file every load.
  const sawMountChange = useRef(false);

  const onChange = useCallback(
    (elements: any, appState: any, files: any) => {
      if (!isEditable || !slug) return;
      if (!sawMountChange.current) {
        sawMountChange.current = true;
        return;
      }
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
        theme={theme}
        viewModeEnabled={!isEditable}
        onChange={isEditable ? onChange : undefined}
        validateEmbeddable={validateEmbeddable}
        renderEmbeddable={renderEmbeddable}
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
