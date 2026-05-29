# Open Canvas Workspace — Design

**Date:** 2026-05-28
**Status:** Approved, building (start with home page)

## Goal

Make every page feel like an open scratch pad — a Figma-like workspace where
anything (text, post-its, scribbles, images, mockups, live components, ASCII,
cat photos) can be placed anywhere — instead of a standard column/row site.
This is "my workspace, not a portfolio."

## Decisions (from brainstorming)

- **Authoring model:** Author composes freely in code. Visitors *view* a
  hand-composed canvas; they do not edit/draw live.
- **Canvas model:** Bounded, scroll-only (vertical). Not infinite pan/zoom. Stays
  a real, crawlable, fast website — no whiteboard engine.
- **Mark vocabulary:** Anything. The base component positions arbitrary content;
  a small kit supplies common pieces (scribbles, post-its).
- **Responsive:** Scale the whole stage uniformly *within* a breakpoint band so a
  composition never collides with itself, and *re-author the arrangement between*
  bands so phones get a legible looser layout.
- **Tech:** HTML absolute-positioning on a scaled stage + inline SVG (roughjs) for
  marks. Chosen over an SVG/foreignObject canvas or a whiteboard lib because it
  keeps every content type first-class and the page crawlable/accessible.

## Coordinate & breakpoint model

Author in plain design-pixels on a known design width per breakpoint:

| Breakpoint | Applies at  | Design width |
|------------|-------------|--------------|
| `desktop`  | ≥ 1024px    | 1280         |
| `tablet`   | 640–1023px  | 760          |
| `mobile`   | < 640px     | 380          |

A canvas controller sets `--cv-scale = min(1, containerWidth / designWidth)` and
the stage height, updating on resize. Scale capped at 1 → on wide screens the
canvas stays bounded and centered with black side margins. No JS → scale 1,
still readable.

## Component kit (`src/components/canvas/`)

- **`Canvas.astro`** — establishes the stage, holds per-breakpoint heights, runs
  the controller (`src/scripts/canvas.ts`). One per page.
- **`Place.astro`** — placement primitive. Positions any slotted content via
  `x / y / rotate / z / w`, with selective `tablet={…}` / `mobile={…}` overrides.
  Desktop props are the base. Pure CSS (custom properties swapped in media
  queries); coords are design-px, Canvas scale handles fit.
- **`Scribble.astro`** — hand-drawn marks via roughjs, rendered to **static inline
  SVG at build time** with a fixed seed (crawlable, zero client JS, no CLS).
  Types: `circle`, `box`, `underline`, `line`, `arrow`, `squiggle`.
- **`PostIt.astro`** — sticky-note card for posts: `title`, `summary`, `href`,
  `color`, rotation. Real `<a>` with real text.

Free handwritten text is just a styled block inside `<Place>` (reuses the Caveat
`.wip-intro` styling); no dedicated component until needed.

## Home page composition

Cursive intro up top-left; the three posts as scattered post-its with slight
rotations; a few scribbles tying it together (arrow from intro toward a post-it,
one circled word, an underline); room to grow. Tablet/mobile re-flow into a
looser vertical arrangement.

## Keeping it a real website (non-negotiable)

- Post-its are real links with real text; a real `<h1>` exists.
- **DOM order = reading order** (intro → posts → decoration), independent of
  scattered visual order — good for SEO and screen readers.
- All scribbles are `aria-hidden` decoration.
- `prefers-reduced-motion` respected; crawlable; fast.

## Files

- `src/components/canvas/{Canvas,Place,Scribble,PostIt}.astro`
- `src/scripts/canvas.ts`
- canvas styles (scoped in components + shared bits in global.css)
- rewritten `src/pages/index.astro`

Posts: collection `posts`, schema `{ title, date, summary, draft }`, routed at
`/wip/{id}/`. Summaries currently empty → post-its lead with title + date.
