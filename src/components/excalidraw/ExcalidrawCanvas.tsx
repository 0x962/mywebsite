import { Excalidraw, serializeAsJSON } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_LIBRARY_ITEMS } from "../../lib/excalidraw-libs";

type Theme = "light" | "dark";

/**
 * Excalidraw canvas island. ONE mode for everyone — the canvas is always
 * fully editable. Autosave attempts hit `PUT /api/scenes/<slug>`:
 *
 *   • Admin (Access JWT cookie present) → write succeeds, scene persists.
 *   • Anyone else → write 401s; we show a small "local-only" banner and
 *     stop retrying for the session. The visitor can keep editing in their
 *     browser and use Excalidraw's hamburger menu → "Save to disk" to grab
 *     a .excalidraw file.
 *
 * Mounted as `client:only="react"` — Excalidraw is browser-only.
 */
interface Props {
  /** A pre-loaded Excalidraw scene; when omitted, fetched from /data/scenes/<slug>. */
  initialData?: Record<string, unknown> | null;
  /** Post slug — both the API key and the save target. */
  slug?: string;
  /** UI + canvas theme. Defaults to dark to match the site. */
  theme?: Theme;
}

const SAVE_DEBOUNCE_MS = 800;
const READ_BASE = "/data/scenes/";
const WRITE_BASE = "/api/scenes/";

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

export default function ExcalidrawCanvas({ initialData = null, slug, theme = "dark" }: Props) {
  const [scene, setScene] = useState<Record<string, unknown> | null>(initialData);
  const [loadError, setLoadError] = useState<string>("");
  const [localOnly, setLocalOnly] = useState(false);
  const [savingLabel, setSavingLabel] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sawMountChange = useRef(false);

  // Fetch the scene from KV on mount (always; visitors and admin both).
  useEffect(() => {
    if (initialData || !slug || scene) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(READ_BASE + encodeURIComponent(slug), { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!cancelled) setScene(data);
      } catch (err) {
        if (cancelled) return;
        setLoadError(String(err));
        setScene({ elements: [], appState: { viewBackgroundColor: "#ffffff" }, files: {} });
      }
    })();
    return () => { cancelled = true; };
  }, [slug, initialData, scene]);

  const onChange = useCallback(
    (elements: any, appState: any, files: any) => {
      if (!slug || localOnly) return;
      // Excalidraw fires onChange once on mount echoing the loaded scene.
      // Skip that first one so opening the page never rewrites the file.
      if (!sawMountChange.current) {
        sawMountChange.current = true;
        return;
      }
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(async () => {
        const sceneJson = serializeAsJSON(elements, appState, files, "local");
        setSavingLabel("saving…");
        try {
          const res = await fetch(WRITE_BASE + encodeURIComponent(slug), {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: sceneJson,
            redirect: "manual", // Don't follow Access's cross-origin login redirect (CORS-blocks anyway).
          });
          if (res.ok) {
            setSavingLabel("saved");
            setTimeout(() => setSavingLabel(""), 1200);
            return;
          }
          // Anything non-2xx (401, 403, opaqueredirect, etc.) → not authed.
          setLocalOnly(true);
          setSavingLabel("");
        } catch {
          // Network error / CORS / opaqueredirect — treat as not authed.
          setLocalOnly(true);
          setSavingLabel("");
        }
      }, SAVE_DEBOUNCE_MS);
    },
    [slug, localOnly],
  );

  if (!scene) {
    return (
      <div
        className="excalidraw-stage"
        style={{
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
    <div className="excalidraw-stage">
      <Excalidraw
        // scrollToContent auto-fits the viewport to existing elements on mount,
        // so visitors land on the actual drawing instead of an empty corner.
        initialData={{ ...scene, libraryItems: DEFAULT_LIBRARY_ITEMS, scrollToContent: true }}
        theme={theme}
        onChange={slug ? onChange : undefined}
        validateEmbeddable={validateEmbeddable}
        renderEmbeddable={renderEmbeddable}
      />
      {(localOnly || savingLabel || loadError) && (
        <div
          style={{
            position: "fixed",
            left: 16,
            bottom: 16,
            zIndex: 100000,
            maxWidth: 360,
            font: "11px/1.4 ui-monospace, 'JetBrains Mono', monospace",
            color: "#d4d4d8",
            background: "rgba(10, 10, 11, 0.92)",
            border: "1px solid #27272a",
            borderRadius: 6,
            padding: "8px 11px",
            pointerEvents: "none",
            letterSpacing: "0.01em",
          }}
        >
          {loadError && <div style={{ color: "#f87171" }}>load failed: {loadError}</div>}
          {localOnly && (
            <div>
              edits stay in your browser only. sign in at <span style={{ color: "#60a5fa" }}>/admin</span> to
              persist — or use the hamburger menu → <em>Save to…</em> to download.
            </div>
          )}
          {!localOnly && savingLabel && <div>{savingLabel}</div>}
        </div>
      )}
    </div>
  );
}
