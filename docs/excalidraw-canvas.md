# Excalidraw canvas posts — how it works

Blog **post** pages can be authored on an Excalidraw canvas (like Figma) instead
of markdown / the old `<Place>`/`<Canvas>` system. Design + decisions:
`docs/superpowers/specs/2026-06-07-excalidraw-canvas-posts-design.md`.

- **Author** locally in `?edit` (DEV only); changes autosave to a scene JSON in
  the repo. Commit + deploy.
- **Visitors** get the same canvas, read-only.

## One-time / fresh-clone setup

Excalidraw is vendored from source as a git submodule (`vendor/excalidraw`,
fork `0x962/excalidraw`) and **built locally** — the built `dist/` is not
committed. After cloning (or pulling a submodule bump):

```sh
git submodule update --init            # fetch vendor/excalidraw
npm i -g yarn                          # yarn classic (Homebrew node has no corepack)
cd vendor/excalidraw && yarn && yarn build:packages && cd -
npm install
```

`npm run deploy` builds the Astro site (which consumes the already-built vendor)
and uploads it. **Build the vendor before deploying** or the import won't resolve.

To change Excalidraw itself: edit under `vendor/excalidraw/packages/`, re-run
`yarn build:packages`, restart `npm run dev`. Push changes to the fork; pull
upstream by bumping the submodule.

## Authoring a post

1. Add a post entry `src/content/posts/<slug>.mdx` with frontmatter
   `title`, `date`, `summary`, and `canvas: excalidraw`. (This entry feeds the
   home post-its and RSS; the markdown body is unused for canvas posts.)
2. Add a blank scene `src/data/scenes/<slug>.json`:
   ```json
   { "type": "excalidraw", "version": 2, "source": "nvdk.co", "elements": [], "appState": { "viewBackgroundColor": "#ffffff" }, "files": {} }
   ```
   The canvas renders dark via Excalidraw's dark theme, which **inverts** colors
   (`invert(93%)`) — so keep `viewBackgroundColor` light (`#ffffff` → ~`#121212`
   on screen). The theme is set in `ExcalidrawCanvas.tsx` (`theme="dark"`).
3. Add a thin page `src/pages/wip/<slug>.astro`:
   ```astro
   ---
   import ExcalidrawPost from '../../components/excalidraw/ExcalidrawPost.astro';
   import scene from '../../data/scenes/<slug>.json';
   ---
   <ExcalidrawPost slug="<slug>" scene={scene} />
   ```
4. Add `<slug>` to the `CANVAS_PAGES` set in `src/pages/wip/[...slug].astro` so
   the generic markdown renderer skips it.
5. `npm run dev`, open `/wip/<slug>/?edit`, draw. It autosaves to the scene JSON.
   Commit the JSON + `npm run deploy`.

## Live widgets

Interactive widgets live as same-origin embeddables:

1. Build the widget as a React island, e.g. `src/components/widgets/Foo.tsx`.
2. Expose it chrome-less at `src/pages/widgets/foo.astro` (transparent bg, no
   Layout) — see `src/pages/widgets/demo.astro` for the template.
3. While editing, paste the URL `/<origin>/widgets/foo` onto the canvas; it
   becomes a live iframe. Only same-origin `/widgets/` URLs are allowed
   (`validateEmbeddable`) and they render with `allow-same-origin` so they
   hydrate (`renderEmbeddable`) — both in `ExcalidrawCanvas.tsx`.

## Files

- `vendor/excalidraw/` — Excalidraw fork (submodule), built from source
- `src/components/excalidraw/ExcalidrawCanvas.tsx` — the editor/viewer island
- `src/components/excalidraw/ExcalidrawPost.astro` — post page wrapper (head + canvas)
- `src/dev/scene-save-plugin.mjs` — dev-only `POST /__canvas/scene` writer
- `src/data/scenes/<slug>.json` — saved scenes
- `src/pages/widgets/` — chrome-less widget routes
- old `<Place>`/`<Canvas>` plot page preserved at `src/_legacy/plot-place-canvas.astro`
