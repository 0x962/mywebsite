/**
 * Marginalia controller.
 *
 * Authors place <Term>, <Note>, and <Footnote> components inline in MDX or
 * Astro prose. After page load this script restructures the DOM so each
 * note's anchor block (paragraph, list, etc.) and its note(s) sit side-by-side
 * in a `.note-row`. The note(s) live in a sticky `.note-stack` scoped to that
 * row, so they track the paragraph until it (plus its bottom margin) scrolls
 * out of view.
 */

const BLOCK_TAGS = new Set([
  'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'UL', 'OL', 'PRE', 'BLOCKQUOTE', 'FIGURE', 'DIV', 'TABLE',
]);
const isBlockTag = (el: HTMLElement) => BLOCK_TAGS.has(el.tagName);

/**
 * Walk back and forward from `seed` to collect every contiguous inline
 * sibling that doesn't cross a block boundary. Used to recover from MDX
 * leaving inline anchors un-paragraphed when a block component sits mid-prose.
 */
function collectInlineRun(seed: HTMLElement, parent: HTMLElement): Node[] {
  let start: Node = seed;
  while (start.previousSibling) {
    const prev = start.previousSibling;
    if (prev.nodeType === 1 && isBlockTag(prev as HTMLElement)) break;
    start = prev;
  }
  const out: Node[] = [];
  let cur: Node | null = start;
  while (cur) {
    if (cur.nodeType === 1 && cur !== seed && isBlockTag(cur as HTMLElement)) break;
    const next: Node | null = cur.nextSibling;
    out.push(cur);
    cur = next;
    if (cur && cur.parentNode !== parent) break;
  }
  return out;
}

function init() {
  const articleBody = document.querySelector<HTMLElement>('[data-marginalia-root]');
  if (!articleBody) return;

  // Pair each footnote ref with its two bodies (margin + inline) by DOM order.
  const refs = Array.from(articleBody.querySelectorAll<HTMLElement>('.footnote-ref'));
  const bodyQueue = Array.from(articleBody.querySelectorAll<HTMLElement>('.footnote-body'));
  refs.forEach((ref, i) => {
    const id = `fn-${i + 1}`;
    ref.dataset.fnId = id;
    for (let n = 0; n < 2 && bodyQueue.length; n++) {
      const body = bodyQueue.shift()!;
      body.dataset.fnId = id;
    }
  });

  // For each margin-note: pull it up to be a direct child of articleBody if
  // MDX nested it, then find its anchor's top-level block and wrap them in a
  // shared .note-row. Multiple notes anchored to the same block share a stack.
  const asides = Array.from(articleBody.querySelectorAll<HTMLElement>('aside.margin-note'));
  for (const aside of asides) {
    while (aside.parentElement && aside.parentElement !== articleBody) {
      const parent = aside.parentElement;
      const grandparent = parent.parentElement;
      if (!grandparent) break;
      grandparent.insertBefore(aside, parent.nextSibling);
    }

    const id = aside.dataset.noteId ?? aside.dataset.fnId;
    if (!id) continue;

    let anchor: HTMLElement | null = null;
    if (aside.dataset.fnId) {
      anchor = articleBody.querySelector<HTMLElement>(`.footnote-ref[data-fn-id="${id}"]`);
    } else {
      anchor = articleBody.querySelector<HTMLElement>(`[data-term-id="${id}"]`);
    }

    // Climb to a top-level child of articleBody. If we land on an existing
    // .note-row (because a previous note already wrapped this paragraph),
    // peel back into the row's first child so we can reuse the row's stack.
    let block: HTMLElement | null = anchor;
    while (block && block.parentElement !== articleBody) block = block.parentElement;
    if (block && block.classList.contains('note-row')) {
      block = block.firstElementChild as HTMLElement | null;
    }

    if (!block) {
      let prev = aside.previousElementSibling as HTMLElement | null;
      while (prev && (prev.matches('aside') || prev.classList.contains('note-row'))) {
        prev = prev.previousElementSibling as HTMLElement | null;
      }
      block = prev;
    }
    if (!block) continue;

    // Defensive: rebuild a synthetic <p> if the anchor is loose inline content.
    if (!isBlockTag(block)) {
      const synth = document.createElement('p');
      const run = collectInlineRun(block, articleBody);
      if (run.length === 0) continue;
      articleBody.insertBefore(synth, run[0]!);
      run.forEach((n) => synth.appendChild(n));
      block = synth;
    }

    let row: HTMLElement;
    let stack: HTMLElement;
    const existingRow = block.parentElement;
    if (existingRow && existingRow.classList.contains('note-row')) {
      row = existingRow;
      stack = row.querySelector<HTMLElement>('.note-stack')!;
    } else {
      row = document.createElement('div');
      row.className = 'note-row';
      block.parentElement!.insertBefore(row, block);
      row.appendChild(block);
      stack = document.createElement('div');
      stack.className = 'note-stack';
      row.appendChild(stack);
    }
    stack.appendChild(aside);
  }
}

/**
 * Once rows are built, fade out each note-stack as soon as the *next* row
 * with a stack is approaching its sticky position — otherwise the previous
 * note's overflowing children visually clash with the new sticky note.
 * Also fades when the current row is fully past the viewport top.
 * Throttled to rAF.
 */
function attachFade() {
  const stacks = Array.from(document.querySelectorAll<HTMLElement>('.note-row > .note-stack'));
  if (stacks.length === 0) return;

  // Read CSS `--top-margin` from the document root so we don't drift if the
  // value changes responsively.
  const readTopMargin = () =>
    parseInt(getComputedStyle(document.documentElement).getPropertyValue('--top-margin'), 10) || 88;
  const HANDOFF = 40; // px before next sticks at which we begin fading the previous

  let scheduled = false;
  const update = () => {
    scheduled = false;
    const topMargin = readTopMargin();
    for (let i = 0; i < stacks.length; i++) {
      const stack = stacks[i]!;
      const row = stack.parentElement;
      if (!row) continue;
      const rect = row.getBoundingClientRect();
      let past = false;

      // Fade if any subsequent row is already sticky-eligible (its top is
      // approaching the threshold). Use the *next* stacked row only — that's
      // the one we'd hand off to.
      const next = stacks[i + 1];
      if (next) {
        const nextRow = next.parentElement;
        if (nextRow) {
          const nextRect = nextRow.getBoundingClientRect();
          if (nextRect.top < topMargin + HANDOFF) past = true;
        }
      }

      // Always fade once this row is fully above viewport top.
      if (rect.bottom < 0) past = true;

      stack.style.opacity = past ? '0' : '1';
      stack.style.pointerEvents = past ? 'none' : '';
    }
  };

  const onScroll = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(update);
  };

  update();
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => { init(); attachFade(); });
} else {
  init();
  attachFade();
}
