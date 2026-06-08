import { useCallback, useState } from "react";
import "./admin.css";

export interface HistoryEntry {
  /** Full KV key, e.g. "history:plot:2026-06-07T22:35:05.123Z" */
  key: string;
  /** ISO timestamp parsed from the key */
  ts: string;
  meta: { lastEditedAt?: string; lastEditedBy?: string } | null;
}

interface Props {
  slug: string;
  initialEntries: HistoryEntry[];
}

interface Toast {
  msg: string;
  kind: "ok" | "err";
}

const fmt = (iso: string) => new Date(iso).toLocaleString();

export default function HistoryView({ slug, initialEntries }: Props) {
  const [entries] = useState(initialEntries);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);

  const api = `/api/history/${encodeURIComponent(slug)}`;

  const showToast = useCallback((msg: string, kind: Toast["kind"] = "ok") => {
    setToast({ msg, kind });
    setTimeout(() => setToast(null), 4000);
  }, []);

  const onDownload = useCallback(
    async (ts: string) => {
      setBusy(`dl-${ts}`);
      try {
        const res = await fetch(`${api}?ts=${encodeURIComponent(ts)}`);
        if (!res.ok) {
          showToast(`fetch failed: ${res.status}`, "err");
          return;
        }
        const { scene } = await res.json();
        const blob = new Blob([JSON.stringify(scene, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${slug}-${ts}.excalidraw`;
        a.click();
        URL.revokeObjectURL(url);
      } finally {
        setBusy(null);
      }
    },
    [api, slug, showToast],
  );

  const onRestore = useCallback(
    async (ts: string) => {
      if (!confirm("Restore this snapshot? The current scene will itself be snapshotted first, so this is reversible.")) return;
      setBusy(`r-${ts}`);
      try {
        const res = await fetch(api, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ts }),
        });
        if (!res.ok) {
          showToast(`restore failed: ${res.status}`, "err");
          return;
        }
        showToast("restored. reloading…");
        setTimeout(() => window.location.reload(), 800);
      } finally {
        setBusy(null);
      }
    },
    [api, showToast],
  );

  return (
    <div className="admin-root">
      <main>
        <a className="back" href="/admin/">← admin</a>
        <h1>history · {slug}</h1>
        <div className="sub">
          {entries.length} snapshot{entries.length === 1 ? "" : "s"} · newest first · 500 retained
        </div>

        {entries.length === 0 ? (
          <div className="admin-empty">No history yet. The first save will start one.</div>
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th>when</th>
                <th>who</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => {
                const when = entry.meta?.lastEditedAt ?? entry.ts;
                const who = entry.meta?.lastEditedBy ?? "(unknown)";
                return (
                  <tr key={entry.ts}>
                    <td>{fmt(when)}</td>
                    <td>{who}</td>
                    <td className="admin-cell-actions">
                      <button
                        className="admin-btn"
                        disabled={busy === `dl-${entry.ts}`}
                        onClick={() => onDownload(entry.ts)}
                      >
                        download
                      </button>
                      <button
                        className="admin-btn admin-btn-restore"
                        disabled={busy === `r-${entry.ts}`}
                        onClick={() => onRestore(entry.ts)}
                      >
                        restore
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </main>

      {toast && <div className={`admin-toast admin-toast-${toast.kind}`}>{toast.msg}</div>}
    </div>
  );
}
