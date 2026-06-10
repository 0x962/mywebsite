import { useCallback, useEffect, useState } from "react";
import "./admin.css";

interface Post {
  slug: string;
  title: string;
  summary: string;
  embedUrl: string;
  createdAt: string;
  updatedAt: string;
  published: boolean;
}

type Draft = Pick<Post, "slug" | "title" | "summary" | "embedUrl">;

const EMPTY: Draft = { slug: "", title: "", summary: "", embedUrl: "" };
const EMBED_PREFIX = "https://link.excalidraw.com/readonly/";

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

async function api(path: string, init?: RequestInit): Promise<{ ok: boolean; status: number; body: any }> {
  const res = await fetch(path, {
    headers: { "content-type": "application/json" },
    ...init,
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body };
}

export default function AdminApp() {
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [error, setError] = useState("");
  const [busySlug, setBusySlug] = useState<string | null>(null);
  /** null = closed, "" = create form, "<slug>" = editing that post */
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const r = await api("/api/posts");
    if (!r.ok) {
      setError(r.body.error || `failed to load posts (${r.status})`);
      return;
    }
    setPosts(r.body.posts);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const openCreate = () => { setDraft(EMPTY); setEditing(""); setError(""); };
  const openEdit = (p: Post) => {
    setDraft({ slug: p.slug, title: p.title, summary: p.summary, embedUrl: p.embedUrl });
    setEditing(p.slug);
    setError("");
  };

  const save = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      const r = editing === ""
        ? await api("/api/posts", { method: "POST", body: JSON.stringify(draft) })
        : await api(`/api/posts/${encodeURIComponent(editing!)}`, {
            method: "PATCH",
            body: JSON.stringify({ title: draft.title, summary: draft.summary, embedUrl: draft.embedUrl }),
          });
      if (!r.ok) {
        setError(r.body.error || `save failed (${r.status})`);
        return;
      }
      setEditing(null);
      await load();
    } finally {
      setSaving(false);
    }
  }, [draft, editing, load]);

  const togglePublish = useCallback(async (p: Post) => {
    setError("");
    setBusySlug(p.slug);
    try {
      const r = await api(`/api/posts/${encodeURIComponent(p.slug)}`, {
        method: "PATCH",
        body: JSON.stringify({ published: !p.published }),
      });
      if (!r.ok) {
        setError(r.body.error || `toggle failed (${r.status})`);
        return;
      }
      setPosts((prev) => prev!.map((row) => (row.slug === p.slug ? r.body.post : row)));
    } finally {
      setBusySlug(null);
    }
  }, []);

  const remove = useCallback(async (p: Post) => {
    if (!window.confirm(`Delete "${p.title}" (${p.slug})? The Excalidraw+ scene is untouched; only the post entry goes away.`)) return;
    setError("");
    setBusySlug(p.slug);
    try {
      const r = await api(`/api/posts/${encodeURIComponent(p.slug)}`, { method: "DELETE" });
      if (!r.ok) {
        setError(r.body.error || `delete failed (${r.status})`);
        return;
      }
      setPosts((prev) => prev!.filter((row) => row.slug !== p.slug));
    } finally {
      setBusySlug(null);
    }
  }, []);

  const previewUrl = draft.embedUrl.startsWith(EMBED_PREFIX) ? draft.embedUrl : "";

  if (posts === null) {
    return <div className="admin-root"><main><h1>admin</h1><div className="sub">{error || "loading…"}</div></main></div>;
  }

  return (
    <div className="admin-root">
      <main>
        <h1>admin</h1>
        <div className="sub">
          {posts.length} {posts.length === 1 ? "post" : "posts"} · authored in Excalidraw+, published here
        </div>
        <div className="admin-err">{error}</div>

        {editing === null ? (
          <button className="admin-btn-primary" onClick={openCreate}>new post</button>
        ) : (
          <div className="admin-card">
            <h2>{editing === "" ? "new post" : `edit: ${editing}`}</h2>
            <form onSubmit={save}>
              {editing === "" && (
                <div className="admin-row">
                  <label htmlFor="slug">slug</label>
                  <input id="slug" type="text" required pattern="[a-z0-9][a-z0-9-]{0,63}"
                    placeholder="my-new-post" autoComplete="off" value={draft.slug}
                    onChange={(e) => setDraft((s) => ({ ...s, slug: e.target.value }))} />
                </div>
              )}
              <div className="admin-row">
                <label htmlFor="title">title</label>
                <input id="title" type="text" required placeholder="My New Post" autoComplete="off"
                  value={draft.title} onChange={(e) => setDraft((s) => ({ ...s, title: e.target.value }))} />
              </div>
              <div className="admin-row">
                <label htmlFor="summary">summary</label>
                <input id="summary" type="text" placeholder="optional" autoComplete="off"
                  value={draft.summary} onChange={(e) => setDraft((s) => ({ ...s, summary: e.target.value }))} />
              </div>
              <div className="admin-row">
                <label htmlFor="embedUrl">embed url</label>
                <input id="embedUrl" type="url" placeholder={`${EMBED_PREFIX}…`} autoComplete="off"
                  value={draft.embedUrl} onChange={(e) => setDraft((s) => ({ ...s, embedUrl: e.target.value }))} />
              </div>
              {draft.embedUrl && !previewUrl && (
                <div className="admin-err">embed url must start with {EMBED_PREFIX}</div>
              )}
              {previewUrl && (
                <iframe className="admin-preview" src={previewUrl} title="embed preview" loading="lazy" />
              )}
              <button type="submit" className="admin-btn-primary" disabled={saving || Boolean(draft.embedUrl && !previewUrl)}>
                {saving ? "…" : "save"}
              </button>
              <button type="button" className="admin-btn" onClick={() => setEditing(null)}>cancel</button>
            </form>
          </div>
        )}

        <ul className="admin-list">
          {posts.map((p) => {
            const busy = busySlug === p.slug;
            return (
              <li key={p.slug}>
                <a className="admin-post-link" href={`/post/${p.slug}/`}>
                  <div className="admin-title">
                    <span className={`admin-status ${p.published ? "admin-status-published" : "admin-status-draft"}`}>
                      {p.published ? "published" : "draft"}
                    </span>
                    {p.title}
                  </div>
                  <div className="admin-meta">
                    {p.slug} · {fmtDate(p.createdAt)}
                    {p.embedUrl ? "" : " · no embed yet"}
                  </div>
                </a>
                <div className="admin-actions">
                  <button className="admin-btn" disabled={busy || (!p.published && !p.embedUrl)}
                    title={!p.published && !p.embedUrl ? "set an embed url first" : undefined}
                    onClick={() => togglePublish(p)}>
                    {busy ? "…" : p.published ? "unpublish" : "publish"}
                  </button>
                  <button className="admin-btn" disabled={busy} onClick={() => openEdit(p)}>edit</button>
                  <button className="admin-btn" disabled={busy} onClick={() => remove(p)}>delete</button>
                </div>
              </li>
            );
          })}
        </ul>
      </main>
    </div>
  );
}
