# Excalidraw-native Canvas Posts — Design

**Date:** 2026-06-07
**Status:** Approved, building (Milestone 1: build-from-source spike)
**Supersedes (for post pages):** parts of `2026-05-28-open-canvas-workspace-design.md`

## Goal

Author blog posts on nvdk.co like using Figma — a real canvas where you
create text/shapes/images/widgets directly on the surface, drag, resize,
rotate — instead of hand-writing 600-line `.astro` files of `<Place>`
wrappers across three breakpoints. Edit mode is for the author only; visitors
get a read-only canvas.

## Key decisions (from brainstorming)

- **Engine:** Excalidraw, **vendored as a fork and built from source**, so we
  can modify Excalidraw itself when we need a feature. Chosen over tldraw
  (license/feel) and over extending the existing HTML canvas (would mean
  rebuilding Figma mechanics by hand).
- **Read mode = render the canvas directly.** The "clean crawlable HTML"
  non-negotiable from the 2026-05-28 spec is **dropped** for post pages — this
  is a personal workspace, not a portfolio to be indexed. Accepted costs:
  weaker SEO, weaker screen-reader support, heavier page loads.
- **Edit model:** local-only. Author in `npm run dev` (edit gated to DEV +
  `?edit`), save scene JSON to the repo via a dev-only endpoint, commit +
  `npm run deploy`. **No backend, no auth, no DB** — same loop as today.
- **Live widgets:** Excalidraw `embeddable` elements pointing at chrome-less
  Astro routes, allow-listed via `validateEmbeddable`. Widgets stay 100% live.
  A fork-based custom element type is held in reserve, not v1.
- **No migration.** `plot` / `browser-plugin` / `prompt` are not recreated.
  Start fresh with new Excalidraw posts.
- **Scope:** only post pages go Excalidraw in v1. Home/about/index stay on the
  current Place/Canvas system; canvas-ify them later if desired.

## Confirmed Excalidraw facts

- Yarn monorepo. Consumable package `@excalidraw/excalidraw` under `packages/`;
  `excalidraw-app/` is the excalidraw.com app. React + TypeScript + SCSS.
- Read mode: `viewModeEnabled` prop (host-controlled; visitors can't toggle out).
- A scene is `initialData = { elements, appState, files }`; persist via
  `onChange`, reload via `initialData`. `files` carries embedded images.
- External live content: `embeddable` elements gated by `validateEmbeddable`.

## Architecture

### 1. Excalidraw from source (vendored fork)
- Fork `excalidraw/excalidraw`; add as a **git submodule** at `vendor/excalidraw`.
- Build the `@excalidraw/excalidraw` package with Excalidraw's own toolchain
  (its package has SCSS/fonts/workers that don't consume cleanly as raw source),
  producing `dist/`.
- Astro app consumes the built output via a **Vite alias / `file:` dependency**.
  To change a feature: edit submodule source → rebuild package → app picks it up.
  Pull upstream by updating the submodule.
- ⚠️ **Riskiest step** (React 19 compat + cross-toolchain build). Milestone 1 is
  a throwaway spike to prove it mounts before building anything on top.

### 2. Post page (read + edit in one island)
- Each post page mounts Excalidraw as a React island (`client:only="react"`).
- **Read mode (default/prod):** `viewModeEnabled` + committed scene as `initialData`.
- **Edit mode (`import.meta.env.DEV` + `?edit`):** full editor; `onChange`
  (debounced) POSTs the scene to a dev-only save endpoint.

### 3. Persistence (repo files, no backend)
- One scene per post: `src/data/scenes/<slug>.json` = `{ elements, appState, files }`.
- Dev-only save endpoint writes the file — mirrors existing
  `src/dev/canvas-save-plugin.mjs`. Commit + `npm run deploy`.
- ⚠️ Inline data-URL images bloat JSON. Default: extract image `files` to
  `public/scenes/<slug>/` and reference them; keep the spike simple, harden later.

### 4. Live widgets via embeddables
- Each widget = a chrome-less Astro route `src/pages/widgets/<name>.astro`
  (transparent bg, no Layout).
- Place an Excalidraw `embeddable` pointing at `/widgets/<name>?…params`,
  allow-listed via `validateEmbeddable` (same-origin `/widgets/` only).

### 5. Post metadata & rest of site
- Keep the `posts` content collection for `{ title, date, summary }` — home
  post-its, archive, and RSS still read it. A post = metadata entry + scene JSON.
- Out of scope v1: home/about/index stay on the current Place/Canvas system.

## Milestones

1. **Spike** — vendor + build Excalidraw from source, mount one read-only scene
   in Astro. *(Prove the risky part first.)*
2. **Edit mode + dev save endpoint** — author + persist a scene to the repo.
3. **Widget embeddable pattern** — chrome-less `/widgets/<name>` routes +
   `validateEmbeddable`.
4. **Post wiring** — metadata/routing so a new Excalidraw post shows on home + RSS.
