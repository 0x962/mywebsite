/**
 * Public "desktop" — lets ANY visitor drag the placed items on an interactive
 * Canvas around, like icons on a desktop. Mounted by Canvas.astro on stages
 * marked [data-cv-interactive] (the home page), and never alongside the dev
 * `?edit` authoring editor.
 *
 * Active on tablet/desktop widths (≥640px). On mobile the curated static layout
 * stands so page-scroll isn't hijacked by drags on full-width tiles.
 *
 * Persistence:
 *   • Guests → arrangement saved to localStorage, re-applied on reload. Per
 *     visitor, never shared.
 *   • Owner  → if a Cloudflare Access session is present (detected by GETting
 *     the Access-gated /api/layout/<page>), each drag is PUT to R2 and becomes
 *     the shared baseline everyone loads. The owner also gets an authoring UI:
 *     an "+ add to desk" button (link / post-it / text / image / embed) and a
 *     delete handle on each item they've added.
 *
 * The server baseline is rendered into the CSS vars at SSR time, so the page
 * already starts "where the owner left things" before this script runs.
 */
type Breakpoint = 'desktop' | 'tablet' | 'mobile';
const SUFFIX: Record<Breakpoint, 'd' | 't' | 'm'> = { desktop: 'd', tablet: 't', mobile: 'm' };
const bpFor = (w: number): Breakpoint => (w < 640 ? 'mobile' : w < 1024 ? 'tablet' : 'desktop');
const INTERACTIVE_MIN = 640;
const DRAG_THRESHOLD = 4;

interface Patch { x?: number; y?: number; rotate?: number }
type LocalLayout = Record<string, Partial<Record<Breakpoint, Patch>>>;

const readVar = (el: HTMLElement, name: string) =>
  parseFloat(getComputedStyle(el).getPropertyValue(name)) || 0;

const cssEscape = (s: string) =>
  typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(s) : s.replace(/["\\]/g, '\\$&');

let mounted = false;

export function initCanvasDesktop(): void {
  if (mounted) return;
  mounted = true;
  injectStyles();
  document
    .querySelectorAll<HTMLElement>('[data-canvas][data-cv-interactive][data-cv-page]')
    .forEach(setupStage);
}

function setupStage(canvas: HTMLElement): void {
  const page = canvas.dataset.cvPage!;
  const storeKey = `nvdk:layout:${page}`;

  // Guests' personal arrangement — load + apply over the SSR baseline at once.
  const local = loadLocal(storeKey);
  applyLocal(canvas, local);

  // Assume guest; confirm owner asynchronously. Drags before this resolves are
  // queued behind ownerReady so they route to the right place.
  let owner = false;
  const ownerReady = detectOwner(page).then((isOwner) => {
    owner = isOwner;
    if (owner) {
      // Owner authors against the shared baseline, not a personal copy.
      localStorage.removeItem(storeKey);
      for (const k of Object.keys(local)) delete local[k];
      mountOwnerUI(page, canvas);
    }
  });

  type Ctx = {
    el: HTMLElement; s: 'd' | 't' | 'm'; pid: number;
    sx: number; sy: number; ox: number; oy: number; scale: number; moved: boolean;
  };
  let ctx: Ctx | null = null;
  let zTop = 50;

  // Posts/images are real <a>/<img>; the browser's native drag-and-drop fires
  // on press-and-move and cancels our pointer sequence (the tile never moves,
  // a link "ghost" follows the cursor instead). Suppress it on the stage.
  canvas.addEventListener('dragstart', (e) => e.preventDefault());

  canvas.addEventListener('pointerdown', (e) => {
    if (window.innerWidth < INTERACTIVE_MIN) return; // mobile: leave native behaviour
    if (e.button !== undefined && e.button !== 0) return; // primary button / touch only
    const t = e.target as HTMLElement;
    if (t.closest('.cv-del')) return; // delete handle — not a drag
    const el = t.closest<HTMLElement>('.cv-place[data-cv-id]');
    if (!el || !canvas.contains(el)) return;
    const s = SUFFIX[bpFor(window.innerWidth)];
    ctx = {
      el, s, pid: e.pointerId,
      sx: e.clientX, sy: e.clientY,
      ox: readVar(el, `--x-${s}`), oy: readVar(el, `--y-${s}`),
      scale: readVar(canvas, '--cv-scale') || 1,
      moved: false,
    };
    // NB: no setPointerCapture — capturing on the .cv-place tile (while the
    // move listener lives on an ancestor) silently swallowed drags on the real
    // <a> post tiles. The dev editor tracks on `document` without capture and
    // works, so we mirror it: document-level move/up keep firing even when the
    // pointer leaves the tile or the canvas.
  });

  document.addEventListener('pointermove', (e) => {
    if (!ctx || e.pointerId !== ctx.pid) return;
    const dx = e.clientX - ctx.sx;
    const dy = e.clientY - ctx.sy;
    if (!ctx.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    if (!ctx.moved) {
      ctx.moved = true;
      ctx.el.classList.add('cv-dragging');
      ctx.el.style.setProperty(`--z-${ctx.s}`, String(++zTop)); // raise to front
    }
    ctx.el.style.setProperty(`--x-${ctx.s}`, String(Math.round(ctx.ox + dx / ctx.scale)));
    ctx.el.style.setProperty(`--y-${ctx.s}`, String(Math.round(ctx.oy + dy / ctx.scale)));
    e.preventDefault();
  });

  const finish = async (e: PointerEvent) => {
    if (!ctx || e.pointerId !== ctx.pid) return;
    const c = ctx;
    ctx = null;
    c.el.classList.remove('cv-dragging');
    if (!c.moved) return; // a plain click — let links/selection stand

    swallowNextClick(); // the click that trails a drag must not fire the link

    const id = c.el.dataset.cvId!;
    const bp = bpFor(window.innerWidth);
    const patch: Patch = { x: readVar(c.el, `--x-${c.s}`), y: readVar(c.el, `--y-${c.s}`) };

    await ownerReady;
    if (owner) {
      saveServer(page, id, bp, patch).catch(() => {/* keep the on-screen position */});
    } else {
      local[id] = { ...local[id], [bp]: { ...local[id]?.[bp], ...patch } };
      saveLocal(storeKey, local);
    }
  };
  document.addEventListener('pointerup', finish);
  document.addEventListener('pointercancel', finish);
}

async function detectOwner(page: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/layout/${encodeURIComponent(page)}`, {
      method: 'GET',
      redirect: 'manual',
      headers: { accept: 'application/json' },
      cache: 'no-store',
    });
    return res.ok && res.type !== 'opaqueredirect';
  } catch {
    return false;
  }
}

async function saveServer(page: string, id: string, breakpoint: Breakpoint, patch: Patch): Promise<void> {
  const res = await fetch(`/api/layout/${encodeURIComponent(page)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id, breakpoint, patch }),
  });
  if (!res.ok) throw new Error(await res.text());
}

function applyLocal(canvas: HTMLElement, local: LocalLayout): void {
  for (const [id, bps] of Object.entries(local)) {
    const el = canvas.querySelector<HTMLElement>(`.cv-place[data-cv-id="${cssEscape(id)}"]`);
    if (!el) continue;
    for (const bp of ['desktop', 'tablet', 'mobile'] as const) {
      const p = bps[bp];
      if (!p) continue;
      const s = SUFFIX[bp];
      if (p.x != null) el.style.setProperty(`--x-${s}`, String(p.x));
      if (p.y != null) el.style.setProperty(`--y-${s}`, String(p.y));
      if (p.rotate != null) el.style.setProperty(`--rot-${s}`, String(p.rotate));
    }
  }
}

function loadLocal(key: string): LocalLayout {
  try {
    const raw = localStorage.getItem(key);
    const obj = raw ? JSON.parse(raw) : null;
    return obj && typeof obj === 'object' ? (obj as LocalLayout) : {};
  } catch {
    return {};
  }
}

function saveLocal(key: string, layout: LocalLayout): void {
  try {
    localStorage.setItem(key, JSON.stringify(layout));
  } catch {/* private mode / quota — drags just stay ephemeral */}
}

function swallowNextClick(): void {
  const swallow = (ev: Event) => {
    ev.preventDefault();
    ev.stopPropagation();
  };
  document.addEventListener('click', swallow, { capture: true, once: true });
  setTimeout(() => document.removeEventListener('click', swallow, { capture: true }), 0);
}

/* ─── owner authoring UI ─────────────────────────────────────────────────── */

const COLORS = ['amber', 'blue', 'green', 'pink', 'paper', 'white'] as const;
type Color = (typeof COLORS)[number];
const SWATCH: Record<Color, string> = {
  amber: '#e6cd7e', blue: '#aecbe2', green: '#b9d4a2',
  pink: '#e6b6bf', paper: '#e9e3d5', white: '#fbfbf7',
};

type Kind = 'link' | 'postit' | 'text' | 'image' | 'embed';
const KINDS: { kind: Kind; label: string }[] = [
  { kind: 'link', label: 'Link' },
  { kind: 'postit', label: 'Post-it' },
  { kind: 'text', label: 'Text' },
  { kind: 'image', label: 'Image' },
  { kind: 'embed', label: 'Embed' },
];

function mountOwnerUI(page: string, canvas: HTMLElement): void {
  addDeleteHandles(page, canvas);

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'cv-add-btn';
  addBtn.textContent = '+ add to desk';
  addBtn.addEventListener('click', () => openAddPanel(page));
  document.body.appendChild(addBtn);
}

function addDeleteHandles(page: string, canvas: HTMLElement): void {
  canvas.querySelectorAll<HTMLElement>('.cv-place.cv-item[data-cv-id]').forEach((place) => {
    if (place.querySelector(':scope > .cv-del')) return;
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'cv-del';
    del.title = 'Remove this item';
    del.textContent = '×';
    del.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!confirm('Remove this item from the desk?')) return;
      try {
        const res = await fetch(`/api/layout/${encodeURIComponent(page)}`, {
          method: 'DELETE',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: place.dataset.cvId }),
        });
        if (!res.ok) throw new Error(await res.text());
        location.reload();
      } catch (err) {
        alert('Could not remove item: ' + (err instanceof Error ? err.message : 'error'));
      }
    });
    place.appendChild(del);
  });
}

function openAddPanel(page: string): void {
  document.querySelector('.cv-add-overlay')?.remove();

  const overlay = document.createElement('div');
  overlay.className = 'cv-add-overlay';
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });

  const panel = document.createElement('div');
  panel.className = 'cv-add-panel';
  overlay.appendChild(panel);

  let kind: Kind = 'link';
  let color: Color = 'amber';

  const h = document.createElement('div');
  h.className = 'cv-add-head';
  h.textContent = 'Add to desk';
  panel.appendChild(h);

  // kind tabs
  const tabs = document.createElement('div');
  tabs.className = 'cv-add-tabs';
  panel.appendChild(tabs);

  const fields = document.createElement('div');
  fields.className = 'cv-add-fields';
  panel.appendChild(fields);

  const field = (label: string, el: HTMLElement) => {
    const wrap = document.createElement('label');
    wrap.className = 'cv-add-field';
    const span = document.createElement('span');
    span.textContent = label;
    wrap.append(span, el);
    return wrap;
  };
  const input = (placeholder: string) => {
    const i = document.createElement('input');
    i.type = 'text';
    i.placeholder = placeholder;
    return i;
  };
  const textarea = (placeholder: string) => {
    const t = document.createElement('textarea');
    t.placeholder = placeholder;
    t.rows = 3;
    return t;
  };
  const colorRow = () => {
    const row = document.createElement('div');
    row.className = 'cv-add-colors';
    COLORS.forEach((c) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'cv-swatch' + (c === color ? ' is-on' : '');
      b.style.background = SWATCH[c];
      b.title = c;
      b.addEventListener('click', () => {
        color = c;
        row.querySelectorAll('.cv-swatch').forEach((s) => s.classList.remove('is-on'));
        b.classList.add('is-on');
      });
      row.appendChild(b);
    });
    return field('Colour', row);
  };

  // per-kind inputs, rebuilt on tab switch
  let getPayload: () => Record<string, unknown> | string = () => ({});

  function renderFields() {
    fields.replaceChildren();
    if (kind === 'link') {
      const url = input('https://example.com');
      const label = input('Label (optional)');
      fields.append(field('URL', url), field('Label', label));
      getPayload = () => (url.value.trim() ? { kind, href: url.value.trim(), title: label.value.trim() || undefined } : 'Enter a URL.');
    } else if (kind === 'postit') {
      const title = input('Heading (optional)');
      const body = textarea('Note…');
      const href = input('Link URL (optional)');
      fields.append(field('Heading', title), field('Body', body), colorRow(), field('Link', href));
      getPayload = () =>
        title.value.trim() || body.value.trim()
          ? { kind, title: title.value.trim() || undefined, text: body.value.trim() || undefined, href: href.value.trim() || undefined, color }
          : 'Enter a heading or body.';
    } else if (kind === 'text') {
      const body = textarea('Text…');
      fields.append(field('Text', body), colorRow());
      getPayload = () => (body.value.trim() ? { kind, text: body.value.trim(), color } : 'Enter some text.');
    } else if (kind === 'image') {
      const src = input('https://…/image.png');
      const width = input('Width px (optional, e.g. 320)');
      const href = input('Link URL (optional)');
      fields.append(field('Image URL', src), field('Width', width), field('Link', href));
      getPayload = () => {
        if (!src.value.trim()) return 'Enter an image URL.';
        const w = parseInt(width.value, 10);
        return { kind, src: src.value.trim(), w: Number.isFinite(w) ? w : undefined, href: href.value.trim() || undefined };
      };
    } else {
      const src = input('https://…  (embed URL)');
      const width = input('Width px (default 560)');
      const height = input('Height px (default 360)');
      fields.append(field('Embed URL', src), field('Width', width), field('Height', height));
      getPayload = () => {
        if (!/^https:\/\//.test(src.value.trim())) return 'Enter an https embed URL.';
        const w = parseInt(width.value, 10);
        const ht = parseInt(height.value, 10);
        return { kind, src: src.value.trim(), w: Number.isFinite(w) ? w : undefined, h: Number.isFinite(ht) ? ht : undefined };
      };
    }
  }

  KINDS.forEach(({ kind: k, label }) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'cv-add-tab' + (k === kind ? ' is-on' : '');
    b.textContent = label;
    b.addEventListener('click', () => {
      kind = k;
      tabs.querySelectorAll('.cv-add-tab').forEach((t) => t.classList.remove('is-on'));
      b.classList.add('is-on');
      renderFields();
    });
    tabs.appendChild(b);
  });
  renderFields();

  const err = document.createElement('div');
  err.className = 'cv-add-err';

  const actions = document.createElement('div');
  actions.className = 'cv-add-actions';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'cv-add-cancel';
  cancel.textContent = 'Cancel';
  cancel.addEventListener('click', () => overlay.remove());
  const submit = document.createElement('button');
  submit.type = 'button';
  submit.className = 'cv-add-submit';
  submit.textContent = 'Add';
  submit.addEventListener('click', async () => {
    const payload = getPayload();
    if (typeof payload === 'string') { err.textContent = payload; return; }
    // Scatter it onto a busy desk: random tilt + a random spot in the upper
    // working area. The owner drags from there to fine-tune.
    const item = {
      ...payload,
      rotate: Math.round((Math.random() * 9 - 4.5) * 10) / 10, // ~ -4.5°..4.5°
      x: 130 + Math.floor(Math.random() * 660),
      y: 110 + Math.floor(Math.random() * 430),
    };
    err.textContent = '';
    submit.disabled = true;
    submit.textContent = 'Adding…';
    try {
      const res = await fetch(`/api/layout/${encodeURIComponent(page)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ item }),
      });
      if (!res.ok) throw new Error(await res.text());
      location.reload();
    } catch (e) {
      err.textContent = e instanceof Error ? e.message : 'Could not add item.';
      submit.disabled = false;
      submit.textContent = 'Add';
    }
  });
  actions.append(cancel, submit);
  panel.append(err, actions);

  document.body.appendChild(overlay);
}

function injectStyles(): void {
  const css = `
    @media (min-width: ${INTERACTIVE_MIN}px) {
      [data-cv-interactive] .cv-place[data-cv-id] {
        cursor: grab; touch-action: none; user-select: none; -webkit-user-select: none;
      }
      [data-cv-interactive] .cv-place[data-cv-id] a,
      [data-cv-interactive] .cv-place[data-cv-id] img {
        -webkit-user-drag: none; user-drag: none;
      }
      [data-cv-interactive] .cv-place[data-cv-id].cv-dragging { cursor: grabbing; }
      [data-cv-interactive] .cv-place[data-cv-id].cv-dragging * { cursor: grabbing !important; }
    }
    .cv-del {
      position: absolute; top: -10px; right: -10px; z-index: 60;
      width: 22px; height: 22px; border-radius: 999px;
      display: grid; place-items: center; cursor: pointer;
      font: 600 14px/1 var(--font-mono, ui-monospace, monospace);
      color: #fff; background: #d23; border: 1px solid rgba(0,0,0,0.3);
      box-shadow: 0 2px 6px rgba(0,0,0,0.4);
      opacity: 0; transition: opacity .12s ease; padding: 0;
    }
    .cv-place.cv-item:hover .cv-del { opacity: 1; }
    @media (max-width: ${INTERACTIVE_MIN - 1}px) { .cv-del, .cv-add-btn { display: none; } }

    .cv-add-btn {
      position: fixed; right: 16px; bottom: 16px; z-index: 9999;
      font: 500 12px/1 var(--font-mono, ui-monospace, monospace);
      color: #0a0a0b; background: #fff;
      border: 1px solid rgba(255,255,255,0.2); border-radius: 999px;
      padding: 10px 16px; cursor: pointer;
      box-shadow: 0 6px 20px rgba(0,0,0,0.45);
      transition: transform .15s ease, opacity .15s ease;
    }
    .cv-add-btn:hover { transform: translateY(-2px); }

    .cv-add-overlay {
      position: fixed; inset: 0; z-index: 10000;
      background: rgba(0,0,0,0.55); backdrop-filter: blur(3px);
      display: grid; place-items: center; padding: 20px;
    }
    .cv-add-panel {
      width: min(440px, 100%); max-height: 88vh; overflow: auto;
      background: #141416; color: #f4f4f5;
      border: 1px solid rgba(255,255,255,0.12); border-radius: 14px;
      padding: 20px; box-shadow: 0 24px 64px rgba(0,0,0,0.6);
      font-family: var(--font-mono, ui-monospace, monospace);
    }
    .cv-add-head { font-size: 15px; font-weight: 600; margin-bottom: 14px; }
    .cv-add-tabs { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 16px; }
    .cv-add-tab {
      flex: 1 1 auto; padding: 7px 10px; cursor: pointer;
      font: 500 12px/1 inherit; color: #a1a1aa;
      background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.1);
      border-radius: 8px;
    }
    .cv-add-tab.is-on { color: #0a0a0b; background: #fff; border-color: #fff; }
    .cv-add-fields { display: flex; flex-direction: column; gap: 12px; }
    .cv-add-field { display: flex; flex-direction: column; gap: 5px; }
    .cv-add-field > span { font-size: 11px; color: #a1a1aa; letter-spacing: .03em; }
    .cv-add-field input, .cv-add-field textarea {
      width: 100%; box-sizing: border-box; padding: 9px 11px;
      font: 13px/1.4 inherit; color: #fff;
      background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.14);
      border-radius: 8px; resize: vertical;
    }
    .cv-add-field input:focus, .cv-add-field textarea:focus {
      outline: none; border-color: #5b9bff;
    }
    .cv-add-colors { display: flex; gap: 8px; }
    .cv-swatch {
      width: 26px; height: 26px; border-radius: 999px; cursor: pointer;
      border: 2px solid transparent; padding: 0;
    }
    .cv-swatch.is-on { border-color: #5b9bff; box-shadow: 0 0 0 2px rgba(91,155,255,0.3); }
    .cv-add-err { color: #ff8a8a; font-size: 12px; min-height: 1em; margin-top: 12px; }
    .cv-add-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 10px; }
    .cv-add-cancel, .cv-add-submit {
      padding: 9px 18px; cursor: pointer; font: 500 13px/1 inherit; border-radius: 8px;
    }
    .cv-add-cancel { color: #d4d4d8; background: transparent; border: 1px solid rgba(255,255,255,0.18); }
    .cv-add-submit { color: #0a0a0b; background: #fff; border: 1px solid #fff; }
    .cv-add-submit:disabled { opacity: 0.6; cursor: default; }`;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
}
