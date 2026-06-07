import { Excalidraw, serializeAsJSON } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_LIBRARY_ITEMS } from "../../lib/excalidraw-libs";

type Theme = "light" | "dark";

/**
 * Excalidraw canvas island. ONE mode for everyone — the canvas is always
 * fully editable. Autosave attempts hit `PUT /api/scenes/<slug>`:
 *
 *   • Admin (Access cookie present) → write succeeds, scene persists.
 *   • Anyone else → write 401s; we flip into local-only mode and stop
 *     retrying. A one-shot banner explains it auto-dismisses.
 *
 * ANTI-DATAWIPE GUARDS (NEVER REMOVE WITHOUT THINKING):
 *
 *   1. We never save unless the initial load explicitly succeeded
 *      (`loadedRealScene` ref). Fetch errors → fall through to blank, but
 *      blank can never be PUT back.
 *   2. We refuse to save a scene whose non-deleted element count is LESS
 *      than what we loaded (`loadedElementCount` ref). Real deletes still
 *      work — but only if the canvas first saw the full load. A racing
 *      mount that briefly has zero elements can't clobber a real scene.
 *
 * Both guards exist because earlier versions of this file have wiped real
 * KV content twice. The blast radius is total (KV is the source of truth).
 */
interface Props {
  initialData?: Record<string, unknown> | null;
  slug?: string;
  theme?: Theme;
}

const SAVE_DEBOUNCE_MS = 800;
const NOTICE_MS = 6000;
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

const liveCount = (elements: unknown): number => {
  if (!Array.isArray(elements)) return 0;
  let n = 0;
  for (const e of elements) {
    if (e && typeof e === "object" && !(e as { isDeleted?: boolean }).isDeleted) n++;
  }
  return n;
};

/**
 * Compute Excalidraw scrollX/scrollY so the scene's top-left corner lands
 * at viewport (PADDING, PADDING) on mount — instead of `scrollToContent`,
 * which CENTERS the bounding box (looks like content starts mid-screen).
 *
 * Excalidraw's scroll convention: viewport_x = element_x + scrollX, so to put
 * an element at viewport x = PADDING we need scrollX = PADDING − element_x.
 */
const PADDING = 40;
const topLeftScroll = (elements: unknown): { scrollX: number; scrollY: number } | null => {
  if (!Array.isArray(elements) || elements.length === 0) return null;
  let minX = Infinity, minY = Infinity, any = false;
  for (const el of elements) {
    if (!el || typeof el !== "object") continue;
    const e = el as { isDeleted?: boolean; x?: number; y?: number };
    if (e.isDeleted) continue;
    if (typeof e.x === "number" && e.x < minX) minX = e.x;
    if (typeof e.y === "number" && e.y < minY) minY = e.y;
    any = true;
  }
  if (!any) return null;
  return { scrollX: PADDING - minX, scrollY: PADDING - minY };
};

export default function ExcalidrawCanvas({ initialData = null, slug, theme = "dark" }: Props) {
  const [scene, setScene] = useState<Record<string, unknown> | null>(initialData);
  const [loadError, setLoadError] = useState<string>("");
  const localOnly = useRef(false);
  const [noticeVisible, setNoticeVisible] = useState(false);
  const noticeShown = useRef(false);
  const [savingLabel, setSavingLabel] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sawMountChange = useRef(false);

  // Guards against accidental wipes — see file header.
  const loadedRealScene = useRef(initialData != null);
  const loadedElementCount = useRef(
    initialData && Array.isArray((initialData as { elements?: unknown }).elements)
      ? liveCount((initialData as { elements?: unknown[] }).elements)
      : 0,
  );

  useEffect(() => {
    if (initialData || !slug || scene) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(READ_BASE + encodeURIComponent(slug), { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (cancelled) return;
        loadedRealScene.current = true;
        loadedElementCount.current = liveCount((data as { elements?: unknown }).elements);
        setScene(data);
      } catch (err) {
        if (cancelled) return;
        setLoadError(String(err));
        // IMPORTANT: do NOT set loadedRealScene = true here. The fallback
        // exists only so React can render *something* for the user; the
        // save path stays disabled so this blank can never be PUT back.
        setScene({ elements: [], appState: { viewBackgroundColor: "#ffffff" }, files: {} });
      }
    })();
    return () => { cancelled = true; };
  }, [slug, initialData, scene]);

  const flipToLocalOnly = useCallback(() => {
    if (localOnly.current) return;
    localOnly.current = true;
    setSavingLabel("");
    if (noticeShown.current) return;
    noticeShown.current = true;
    setNoticeVisible(true);
    setTimeout(() => setNoticeVisible(false), NOTICE_MS);
  }, []);

  const onChange = useCallback(
    (elements: any, appState: any, files: any) => {
      if (!slug || localOnly.current) return;

      // GUARD 1: never save if the initial load failed.
      if (!loadedRealScene.current) return;

      // Skip the synthetic onChange Excalidraw fires on mount echoing the loaded scene.
      if (!sawMountChange.current) {
        sawMountChange.current = true;
        return;
      }

      // GUARD 2: refuse to shrink. If the in-canvas scene has fewer live
      // elements than what we loaded, it's almost certainly a mount race
      // (Excalidraw briefly reports an empty state during scrollToContent
      // / library hydration / theme change). Skip the save — wait for a
      // change that at least matches the loaded count.
      const now = liveCount(elements);
      if (now < loadedElementCount.current) return;

      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(async () => {
        const sceneJson = serializeAsJSON(elements, appState, files, "local");
        setSavingLabel("saving…");
        try {
          const res = await fetch(WRITE_BASE + encodeURIComponent(slug), {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: sceneJson,
            redirect: "manual",
          });
          if (res.ok) {
            // Successful save → the canvas size IS the new baseline.
            loadedElementCount.current = now;
            setSavingLabel("saved");
            setTimeout(() => setSavingLabel(""), 1200);
            return;
          }
          flipToLocalOnly();
        } catch {
          flipToLocalOnly();
        }
      }, SAVE_DEBOUNCE_MS);
    },
    [slug, flipToLocalOnly],
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

  const scroll = topLeftScroll((scene as { elements?: unknown }).elements);
  const sceneAppState = (scene as { appState?: Record<string, unknown> }).appState ?? {};
  const initial: Record<string, unknown> = {
    ...scene,
    libraryItems: DEFAULT_LIBRARY_ITEMS,
    appState: scroll ? { ...sceneAppState, scrollX: scroll.scrollX, scrollY: scroll.scrollY } : sceneAppState,
  };

  return (
    <div className="excalidraw-stage">
      <Excalidraw
        initialData={initial}
        theme={theme}
        onChange={slug ? onChange : undefined}
        validateEmbeddable={validateEmbeddable}
        renderEmbeddable={renderEmbeddable}
      />
      {(noticeVisible || savingLabel || loadError) && (
        <div
          style={{
            position: "fixed",
            left: 16,
            bottom: 16,
            zIndex: 100000,
            maxWidth: 340,
            font: "11px/1.4 ui-monospace, 'JetBrains Mono', monospace",
            color: "#d4d4d8",
            background: "rgba(10, 10, 11, 0.92)",
            border: "1px solid #27272a",
            borderRadius: 6,
            padding: "8px 11px",
            pointerEvents: "none",
            letterSpacing: "0.01em",
            transition: "opacity 0.4s ease",
          }}
        >
          {loadError && <div style={{ color: "#f87171" }}>load failed: {loadError}</div>}
          {noticeVisible && (
            <div>
              you're free to play with this — your changes stay in your browser and won't change the post.
              hamburger menu → <em>Save to…</em> to download a copy.
            </div>
          )}
          {!noticeVisible && savingLabel && <div>{savingLabel}</div>}
        </div>
      )}
    </div>
  );
}
