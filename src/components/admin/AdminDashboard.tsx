import { useCallback, useState } from "react";
import "./admin.css";

export interface PostRow {
  slug: string;
  title: string;
  /** ISO */
  date: string;
  summary: string;
  published: boolean;
  /** Frontmatter post whose KV override differs from the .mdx default. */
  overridden: boolean;
  source: "collection" | "kv";
}

interface Props {
  initialPosts: PostRow[];
}

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

export default function AdminDashboard({ initialPosts }: Props) {
  const [posts, setPosts] = useState<PostRow[]>(initialPosts);
  const [busySlug, setBusySlug] = useState<string | null>(null);
  const [newPost, setNewPost] = useState({ slug: "", title: "", summary: "" });
  const [newPostBusy, setNewPostBusy] = useState(false);
  const [error, setError] = useState("");

  const onCreate = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError("");
      setNewPostBusy(true);
      try {
        const res = await fetch("/api/posts", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(newPost),
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(j.error || res.statusText);
          return;
        }
        window.location.href = `/post/${j.post.slug}/?edit`;
      } finally {
        setNewPostBusy(false);
      }
    },
    [newPost],
  );

  const toggle = useCallback(async (p: PostRow) => {
    const willPublish = !p.published;
    setBusySlug(p.slug);
    try {
      const res = await fetch(`/api/posts/${encodeURIComponent(p.slug)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ published: willPublish, source: p.source }),
      });
      if (!res.ok) {
        alert(`Failed: ${res.status}`);
        return;
      }
      setPosts((prev) =>
        prev.map((row) =>
          row.slug === p.slug ? { ...row, published: willPublish } : row,
        ),
      );
    } finally {
      setBusySlug(null);
    }
  }, []);

  return (
    <div className="admin-root">
      <main>
        <h1>admin</h1>
        <div className="sub">
          {posts.length} {posts.length === 1 ? "post" : "posts"} · every save snapshots the prior version to history
        </div>

        <div className="admin-card">
          <h2>new post</h2>
          <form onSubmit={onCreate}>
            <div className="admin-row">
              <label htmlFor="slug">slug</label>
              <input
                id="slug"
                type="text"
                required
                pattern="[a-z0-9][a-z0-9-]{0,63}"
                placeholder="my-new-post"
                autoComplete="off"
                value={newPost.slug}
                onChange={(e) => setNewPost((s) => ({ ...s, slug: e.target.value }))}
              />
            </div>
            <div className="admin-row">
              <label htmlFor="title">title</label>
              <input
                id="title"
                type="text"
                required
                placeholder="My New Post"
                autoComplete="off"
                value={newPost.title}
                onChange={(e) => setNewPost((s) => ({ ...s, title: e.target.value }))}
              />
            </div>
            <div className="admin-row">
              <label htmlFor="summary">summary</label>
              <input
                id="summary"
                type="text"
                placeholder="optional"
                autoComplete="off"
                value={newPost.summary}
                onChange={(e) => setNewPost((s) => ({ ...s, summary: e.target.value }))}
              />
            </div>
            <button type="submit" className="admin-btn-primary" disabled={newPostBusy}>
              {newPostBusy ? "…" : "create + open canvas"}
            </button>
            <div className="admin-err">{error}</div>
          </form>
        </div>

        <ul className="admin-list">
          {posts.map((p) => {
            const href = p.source === "kv" ? `/post/${p.slug}/?edit` : `/wip/${p.slug}/?edit`;
            const busy = busySlug === p.slug;
            return (
              <li key={p.slug}>
                <a className="admin-post-link" href={href}>
                  <div className="admin-title">
                    <span
                      className={`admin-status ${p.published ? "admin-status-published" : "admin-status-draft"}`}
                    >
                      {p.published ? "published" : "draft"}
                    </span>
                    {p.overridden && (
                      <span className="admin-status admin-status-override" title="overridden vs frontmatter">
                        override
                      </span>
                    )}
                    {p.title}
                  </div>
                  <div className="admin-meta">
                    {p.slug} · {fmtDate(p.date)}
                    {p.source === "kv" ? " · kv-only" : ""}
                  </div>
                </a>
                <div className="admin-actions">
                  <button className="admin-btn" disabled={busy} onClick={() => toggle(p)}>
                    {busy ? "…" : p.published ? "unpublish" : "publish"}
                  </button>
                  <a className="admin-btn" href={`/admin/history/${p.slug}/`}>
                    history
                  </a>
                </div>
              </li>
            );
          })}
        </ul>
      </main>
    </div>
  );
}
