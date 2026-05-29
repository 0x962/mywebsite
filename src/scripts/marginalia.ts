/**
 * Marginalia controller.
 *
 * Authors place <Term>, <Note>, and <Footnote> components inline. After page
 * load this script hoists each margin-note to be a direct child of the
 * article body and positions it absolutely in the right rail, vertically
 * aligned with its anchor. When two anchors are too close together, the
 * second note is pushed down so it starts after the first one ends — notes
 * stack and never overlap. Content paragraphs stay in normal flow.
 */

const GAP = 24;

function init() {
  const articleBody = document.querySelector<HTMLElement>('[data-marginalia-root]');
  if (!articleBody) return;

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

  const asides = Array.from(articleBody.querySelectorAll<HTMLElement>('aside.margin-note'));
  for (const aside of asides) {
    let block: HTMLElement | null = aside;
    while (block && block.parentElement !== articleBody) {
      block = block.parentElement;
    }
    if (!block) continue;
    if (aside.parentElement !== articleBody) {
      articleBody.insertBefore(aside, block.nextSibling);
    }
  }

  layout(articleBody);
  attachHoverPairing(articleBody);

  let scheduled = false;
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      layout(articleBody);
    });
  };
  window.addEventListener('resize', schedule, { passive: true });

  const fonts = (document as Document & { fonts?: { ready: Promise<unknown> } }).fonts;
  if (fonts?.ready) fonts.ready.then(() => layout(articleBody));

  const noteImages = articleBody.querySelectorAll<HTMLImageElement>('aside.margin-note img');
  for (const img of Array.from(noteImages)) {
    if (img.complete) continue;
    img.addEventListener('load', schedule, { once: true });
    img.addEventListener('error', schedule, { once: true });
  }
}

function layout(articleBody: HTMLElement) {
  articleBody.style.minHeight = '';

  const asides = Array.from(
    articleBody.querySelectorAll<HTMLElement>(':scope > aside.margin-note')
  );
  if (asides.length === 0) return;
  if (getComputedStyle(asides[0]!).display === 'none') return;

  const bodyTop = articleBody.getBoundingClientRect().top + window.scrollY;

  let cursor = 0;
  let lastBottom = 0;
  for (const aside of asides) {
    const id = aside.dataset.noteId ?? aside.dataset.fnId;
    if (!id) continue;
    const anchor = aside.dataset.fnId
      ? articleBody.querySelector<HTMLElement>(`.footnote-ref[data-fn-id="${id}"]`)
      : articleBody.querySelector<HTMLElement>(`[data-term-id="${id}"]`);
    if (!anchor) continue;

    const anchorTop = anchor.getBoundingClientRect().top + window.scrollY - bodyTop;
    const top = Math.max(anchorTop, cursor);
    aside.style.top = `${top}px`;
    const height = aside.offsetHeight;
    cursor = top + height + GAP;
    lastBottom = top + height;
  }

  if (lastBottom > articleBody.offsetHeight) {
    articleBody.style.minHeight = `${lastBottom}px`;
  }
}

function attachHoverPairing(articleBody: HTMLElement) {
  const findAside = (id: string) =>
    articleBody.querySelector<HTMLElement>(
      `:scope > aside.margin-note[data-note-id="${id}"], :scope > aside.margin-note[data-fn-id="${id}"]`
    );

  const linkPair = (a: HTMLElement, b: HTMLElement) => {
    const on = () => { a.classList.add('is-active'); b.classList.add('is-active'); };
    const off = () => { a.classList.remove('is-active'); b.classList.remove('is-active'); };
    a.addEventListener('mouseenter', on);
    a.addEventListener('mouseleave', off);
    a.addEventListener('focusin', on);
    a.addEventListener('focusout', off);
  };

  for (const term of Array.from(articleBody.querySelectorAll<HTMLElement>('[data-term-id]'))) {
    const aside = findAside(term.dataset.termId!);
    if (!aside) continue;
    linkPair(term, aside);
    linkPair(aside, term);
  }

  for (const ref of Array.from(articleBody.querySelectorAll<HTMLElement>('.footnote-ref[data-fn-id]'))) {
    const aside = findAside(ref.dataset.fnId!);
    if (!aside) continue;
    linkPair(ref, aside);
    linkPair(aside, ref);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
