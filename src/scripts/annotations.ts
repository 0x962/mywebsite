/**
 * Annotation controller for Anchor + MarginNote pairs.
 *
 * For each <aside.ann-note data-target data-style> in the article body:
 *   1. Find the matching <Anchor data-anchor-id> (or any element with
 *      that id).
 *   2. Position the note in the right marginalia rail at the anchor's
 *      vertical center.
 *   3. Draw the requested decoration:
 *      - bracket/underline/circle/box  → rough-notation on the anchor
 *      - arrow                         → roughjs curve from note to anchor
 *
 * Recomputes positions on resize and on font load so the brackets and
 * arrows track their anchors as the layout settles.
 */
import { annotate } from 'rough-notation';
import rough from 'roughjs/bundled/rough.esm.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

// Soft off-white so the scribbles read as pencil, not a hard white marker.
const SCRIBBLE_COLOR = '#e8e8ea';

// Below this viewport width the right rail collapses, so the pencil
// scribbles (brackets + connector arrows) would point at nothing. Hide them.
const SCRIBBLE_MIN_WIDTH = 970;

type Style = 'bracket' | 'underline' | 'circle' | 'box' | 'arrow';

function init() {
  const root = document.querySelector<HTMLElement>('[data-marginalia-root]');
  if (!root) return;

  // Apply rough-notation underlines to every link in the article body.
  // This runs even if there are no MarginNotes on the page.
  annotateLinks(root);

  const notes = Array.from(root.querySelectorAll<HTMLElement>('aside.ann-note'));
  if (notes.length === 0) return;

  // One SVG overlay for all arrows, sized to and positioned over the
  // article body. pointer-events:none so it never blocks clicks.
  let svg = root.querySelector<SVGSVGElement>('svg.ann-overlay');
  if (!svg) {
    svg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
    svg.classList.add('ann-overlay');
    svg.setAttribute('aria-hidden', 'true');
    Object.assign(svg.style, {
      position: 'absolute',
      top: '0',
      left: '0',
      width: '100%',
      height: '100%',
      overflow: 'visible',
      pointerEvents: 'none',
      zIndex: '1',
    });
    root.appendChild(svg);
  }

  const rc = rough.svg(svg);

  type Pair = {
    note: HTMLElement;
    target: HTMLElement;
    style: Style;
    annotation?: ReturnType<typeof annotate>;
  };

  const pairs: Pair[] = [];

  for (const note of notes) {
    const targetId = note.dataset.target;
    const style = (note.dataset.style ?? 'bracket') as Style;
    if (!targetId) continue;
    const target =
      root.querySelector<HTMLElement>(`[data-anchor-id="${targetId}"]`) ??
      document.getElementById(targetId);
    if (!target) continue;

    let annotation: ReturnType<typeof annotate> | undefined;
    if (style !== 'arrow') {
      annotation = annotate(target, {
        type: style,
        color: SCRIBBLE_COLOR,
        strokeWidth: 1.2,
        padding: style === 'bracket' ? 10 : 4,
        animate: false,
        multiline: true,
        ...(style === 'bracket' ? { brackets: ['right'] } : {}),
      });
    }

    pairs.push({ note, target, style, annotation });
  }

  function layout() {
    const rootRect = root.getBoundingClientRect();

    // Clear arrows; rough-notation handles its own redraw via hide/show.
    while (svg.firstChild) svg.removeChild(svg.firstChild);

    // Narrow viewports have no right rail — render the notes inline (CSS)
    // and suppress the scribbles that would otherwise dangle in space.
    const showScribbles = window.innerWidth >= SCRIBBLE_MIN_WIDTH;

    for (const p of pairs) {
      // 1. Place the note next to its anchor in the right rail.
      const targetRect = p.target.getBoundingClientRect();
      const noteH = p.note.offsetHeight || 80;
      const top = targetRect.top - rootRect.top + targetRect.height / 2 - noteH / 2;
      p.note.style.top = `${Math.max(0, top)}px`;
      // Fill the marginalia rail: from content-width + 40px to the right edge
      // of the article body. Anchoring `right` (not a fixed width) keeps the
      // note inside the body, so it never spills past the viewport edge.
      p.note.style.left = `calc(var(--content-width) + 40px)`;
      p.note.style.right = '0px';
      p.note.style.width = 'auto';
      p.note.style.visibility = 'visible';

      // 2. Decorate the anchor.
      if (p.annotation) {
        p.annotation.hide();
        if (showScribbles) p.annotation.show();
      }

      // 3. Draw a connector arrow from the note to its anchor. Brackets
      // already point on their own, so they get no extra connector.
      if (showScribbles && p.style === 'arrow') {
        drawArrow(rc, svg, rootRect, p.note, p.target);
      }
    }
  }

  function scheduled(cb: () => void) {
    let pending = false;
    return () => {
      if (pending) return;
      pending = true;
      requestAnimationFrame(() => {
        pending = false;
        cb();
      });
    };
  }

  const onResize = scheduled(layout);
  window.addEventListener('resize', onResize, { passive: true });

  // Initial layout, then re-layout after fonts load and after rough-notation
  // finishes its first show() (it appends SVG that affects bounding rects
  // sometimes).
  layout();
  const fonts = (document as Document & { fonts?: { ready: Promise<unknown> } }).fonts;
  if (fonts?.ready) fonts.ready.then(() => requestAnimationFrame(layout));
  // Re-layout once images inside anchors have settled.
  for (const img of Array.from(root.querySelectorAll<HTMLImageElement>('img'))) {
    if (!img.complete) img.addEventListener('load', onResize, { once: true });
  }
}

function drawArrow(
  rc: ReturnType<typeof rough.svg>,
  svg: SVGSVGElement,
  rootRect: DOMRect,
  note: HTMLElement,
  target: HTMLElement,
) {
  const noteRect = note.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();

  // Start just left of the note, end just past the target's right edge.
  const x1 = noteRect.left - rootRect.left - 6;
  const y1 = noteRect.top - rootRect.top + 14;
  const x2 = targetRect.right - rootRect.left + 6;
  const y2 = targetRect.top - rootRect.top + Math.min(targetRect.height / 2, 70);

  // Gentle hand-drawn curve. Control points biased toward each end so the
  // line eases out of the note and into the target.
  const path = `M ${x1} ${y1} C ${x1 - (x1 - x2) * 0.35} ${y1}, ${x2 + (x1 - x2) * 0.35} ${y2}, ${x2} ${y2}`;
  svg.appendChild(
    rc.path(path, {
      stroke: SCRIBBLE_COLOR,
      strokeWidth: 1.1,
      roughness: 1.2,
      bowing: 1.5,
    }),
  );

  // Hand-drawn arrowhead at the target end, aligned to the curve's final
  // direction (roughly horizontal, pointing left into the target).
  const headSize = 9;
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const ax1 = x2 - Math.cos(angle - Math.PI / 7) * headSize;
  const ay1 = y2 - Math.sin(angle - Math.PI / 7) * headSize;
  const ax2 = x2 - Math.cos(angle + Math.PI / 7) * headSize;
  const ay2 = y2 - Math.sin(angle + Math.PI / 7) * headSize;
  svg.appendChild(
    rc.line(x2, y2, ax1, ay1, { stroke: SCRIBBLE_COLOR, strokeWidth: 1.1, roughness: 1 }),
  );
  svg.appendChild(
    rc.line(x2, y2, ax2, ay2, { stroke: SCRIBBLE_COLOR, strokeWidth: 1.1, roughness: 1 }),
  );
}

function annotateLinks(root: HTMLElement) {
  const links = Array.from(root.querySelectorAll<HTMLAnchorElement>('a[href]'))
    .filter((a) => !a.closest('aside.ann-note, aside.margin-note, .inline-footnote'));

  // Resolve --accent-color once. Rough-notation passes the color straight
  // through to roughjs which draws SVG attributes — CSS vars don't work
  // there, so we read the computed value.
  const accent =
    getComputedStyle(document.documentElement)
      .getPropertyValue('--accent-color')
      .trim() || '#3b82f6';

  const annotations = links.map((link) => {
    const a = annotate(link, {
      type: 'underline',
      color: accent,
      strokeWidth: 1.5,
      padding: 1,
      animate: false,
      multiline: true,
      iterations: 1,
    });
    a.show();
    link.dataset.roughUnderlined = 'true';
    return a;
  });

  // Rough-notation draws at one point in time; on resize the underline still
  // sits where it was, so we hide+show every annotation to redraw at the new
  // position. Throttled to one redraw per frame.
  let scheduled = false;
  const redraw = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      for (const a of annotations) {
        a.hide();
        a.show();
      }
    });
  };
  window.addEventListener('resize', redraw, { passive: true });
  const fonts = (document as Document & { fonts?: { ready: Promise<unknown> } }).fonts;
  if (fonts?.ready) fonts.ready.then(redraw);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
