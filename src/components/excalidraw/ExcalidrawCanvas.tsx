import { Excalidraw, serializeAsJSON } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import { useCallback, useEffect, useRef, useState } from "react";

type Theme = "light" | "dark";

/**
 * Excalidraw canvas island. Renders the vendored-from-source Excalidraw editor.
 *
 *   • editable=false (default detect: ?edit in URL) → read-only canvas. The
 *     host controls this via prop; the live write endpoint is auth-gated by
 *     Cloudflare Access regardless, so visitors cannot edit even if they add
 *     ?edit themselves.
 *   • Scene loads on mount from `GET /api/scenes/<slug>` (KV-backed). When
 *     editing, every debounced change is serialized via Excalidraw's
 *     `serializeAsJSON` and PUT back to the same endpoint.
 *   • `initialData` prop is still supported (legacy callers can preload), but
 *     the default flow is to leave it null and let the canvas fetch.
 *
 * Mounted as `client:only="react"` — Excalidraw is browser-only (canvas, workers).
 */
interface Props {
  /** A pre-loaded Excalidraw scene; when omitted, fetched from /api/scenes/<slug>. */
  initialData?: Record<string, unknown> | null;
  /** Post slug — both the API key (KV "scene:<slug>") and the save target. */
  slug?: string;
  /**
   * Force edit/read mode. When omitted, edit mode = `?edit` in the URL on the
   * client. (Detection happens client-side because static pages strip
   * searchParams at build.) Production writes are still gated by Access.
   */
  editable?: boolean;
  /** UI + canvas theme. Defaults to dark to match the site. */
  theme?: Theme;
}

const SAVE_DEBOUNCE_MS = 800;
const API_BASE = "/api/scenes/";

function validateEmbeddable(url: string): boolean {
  try {
    const u = new URL(url, window.location.origin);
    return u.origin === window.location.origin && u.pathname.startsWith("/widgets/");
  } catch {
    return false;
  }
}

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
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).has("edit")
  );
}

export default function ExcalidrawCanvas({
  initialData = null,
  slug,
  editable,
  theme = "dark",
}: Props) {
  const isEditable = editable ?? detectEditable();
  const [scene, setScene] = useState<Record<string, unknown> | null>(initialData);
  const [status, setStatus] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Excalidraw fires onChange once on mount echoing the loaded scene. Skip that
  // one so merely opening the page doesn't rewrite the scene file every load.
  const sawMountChange = useRef(false);

  // Fetch the scene from KV on mount when no initialData was passed.
  useEffect(() => {
    if (initialData || !slug || scene) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(API_BASE + encodeURIComponent(slug), { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!cancelled) setScene(data);
      } catch (err) {
        if (!cancelled) {
          setStatus(`load failed: ${err}`);
          setScene({ elements: [], appState: { viewBackgroundColor: "#ffffff" }, files: {} });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug, initialData, scene]);

  const onChange = useCallback(
    (elements: any, appState: any, files: any) => {
      if (!isEditable || !slug) return;
      if (!sawMountChange.current) {
        sawMountChange.current = true;
        return;
      }
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(async () => {
        const sceneJson = serializeAsJSON(elements, appState, files, "local");
        setStatus("saving…");
        try {
          const res = await fetch(API_BASE + encodeURIComponent(slug), {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: sceneJson,
          });
          if (res.status === 401) {
            setStatus("unauthorized — sign in");
            return;
          }
          setStatus(res.ok ? `saved ${slug}` : `save failed: ${await res.text()}`);
        } catch (err) {
          setStatus(`save failed: ${err}`);
        }
      }, SAVE_DEBOUNCE_MS);
    },
    [isEditable, slug],
  );

  if (!scene) {
    return (
      <div
        style={{
          position: "fixed",
          inset: 0,
          display: "grid",
          placeItems: "center",
          background: "#0a0a0b",
          color: "#71717a",
          font: "12px ui-monospace, 'JetBrains Mono', monospace",
        }}
      >
        loading canvas…
      </div>
    );
  }

  return (
    <div style={{ position: "fixed", inset: 0 }}>
      {!isEditable && <style>{`.main-menu-trigger { display: none !important; }`}</style>}
      <Excalidraw
        initialData={scene}
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
