/**
 * Dev-only canvas drag editor. Mounted only under import.meta.env.DEV (see
 * Canvas.astro), so it never ships to production.
 *
 *   • drag a placed item to move it
 *   • Shift-drag to rotate it
 *   • each drop saves the CURRENT breakpoint's coords to
 *     src/data/layouts/<page>.json via the dev-only /__canvas/save endpoint
 *
 * The breakpoint is derived from the viewport width — resize the window to edit
 * the desktop / tablet / mobile arrangement; the toolbar shows which one is live.
 */
type Breakpoint = 'desktop' | 'tablet' | 'mobile';
const SUFFIX: Record<Breakpoint, string> = { desktop: 'd', tablet: 't', mobile: 'm' };

const breakpointFor = (w: number): Breakpoint => (w < 640 ? 'mobile' : w < 1024 ? 'tablet' : 'desktop');

function readVar(el: HTMLElement, name: string): number {
  return parseFloat(getComputedStyle(el).getPropertyValue(name)) || 0;
}

async function save(page: string, id: string, breakpoint: Breakpoint, patch: Record<string, number>) {
  const res = await fetch('/__canvas/save', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ page, id, breakpoint, patch }),
  });
  if (!res.ok) throw new Error(await res.text());
}

let mounted = false;

export function initCanvasEditor(): void {
  if (mounted) return;
  mounted = true;

  injectStyles();
  const ui = buildToolbar();

  document.querySelectorAll<HTMLElement>('[data-canvas][data-cv-page]').forEach((stage) => {
    const page = stage.dataset.cvPage!;
    wireStage(stage, page, ui);
  });
}

interface Toolbar {
  setBreakpoint(bp: Breakpoint): void;
  setStatus(text: string, kind?: 'ok' | 'busy' | 'err'): void;
  setActive(text: string): void;
}

function wireStage(stage: HTMLElement, page: string, ui: Toolbar) {
  let drag: {
    el: HTMLElement;
    id: string;
    bp: Breakpoint;
    sx: number;
    sy: number;
    ox: number;
    oy: number;
    orot: number;
    scale: number;
    moved: boolean;
  } | null = null;

  stage.addEventListener('pointerdown', (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('.cv-place[data-cv-id]');
    if (!el || !stage.contains(el)) return;
    const bp = breakpointFor(window.innerWidth);
    const s = SUFFIX[bp];
    drag = {
      el,
      id: el.dataset.cvId!,
      bp,
      sx: e.clientX,
      sy: e.clientY,
      ox: readVar(el, `--x-${s}`),
      oy: readVar(el, `--y-${s}`),
      orot: readVar(el, `--rot-${s}`),
      scale: readVar(stage, '--cv-scale') || 1,
      moved: false,
    };
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      /* pointer may already be released (e.g. synthetic events) */
    }
  });

  stage.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.sx;
    const dy = e.clientY - drag.sy;
    if (!drag.moved && Math.hypot(dx, dy) < 3) return;
    drag.moved = true;
    drag.el.classList.add('cv-editing');
    const s = SUFFIX[drag.bp];

    if (e.shiftKey) {
      const rot = Math.round((drag.orot + dx * 0.3) * 10) / 10;
      drag.el.style.setProperty(`--rot-${s}`, String(rot));
      ui.setActive(`#${drag.id} · rotate ${rot}°`);
    } else {
      const x = Math.round(drag.ox + dx / drag.scale);
      const y = Math.round(drag.oy + dy / drag.scale);
      drag.el.style.setProperty(`--x-${s}`, String(x));
      drag.el.style.setProperty(`--y-${s}`, String(y));
      ui.setActive(`#${drag.id} · ${x}, ${y}`);
    }
    e.preventDefault();
  });

  const finish = async (e: PointerEvent) => {
    if (!drag) return;
    const d = drag;
    drag = null;
    d.el.classList.remove('cv-editing');
    if (!d.moved) return; // a plain click — let links navigate

    // swallow the click that follows this drag so post-it links don't fire
    const swallow = (ev: Event) => {
      ev.preventDefault();
      ev.stopPropagation();
    };
    document.addEventListener('click', swallow, { capture: true, once: true });
    setTimeout(() => document.removeEventListener('click', swallow, { capture: true }), 0);

    const s = SUFFIX[d.bp];
    const patch = {
      x: readVar(d.el, `--x-${s}`),
      y: readVar(d.el, `--y-${s}`),
      rotate: readVar(d.el, `--rot-${s}`),
    };
    ui.setStatus('saving…', 'busy');
    try {
      await save(page, d.id, d.bp, patch);
      ui.setStatus(`saved ${d.id} → ${d.bp}`, 'ok');
    } catch (err) {
      ui.setStatus(`save failed: ${err}`, 'err');
    }
  };

  stage.addEventListener('pointerup', finish);
  stage.addEventListener('pointercancel', finish);
}

function buildToolbar(): Toolbar {
  const root = document.createElement('div');
  root.className = 'cv-editor-bar';
  root.innerHTML = `
    <div class="cv-editor-row">
      <span class="cv-editor-dot"></span>
      <strong>canvas editor</strong>
      <span class="cv-editor-bp"></span>
    </div>
    <div class="cv-editor-hint">drag to move · shift-drag to rotate</div>
    <div class="cv-editor-active">—</div>
    <div class="cv-editor-status">ready</div>`;
  document.body.appendChild(root);

  const bpEl = root.querySelector<HTMLElement>('.cv-editor-bp')!;
  const activeEl = root.querySelector<HTMLElement>('.cv-editor-active')!;
  const statusEl = root.querySelector<HTMLElement>('.cv-editor-status')!;

  const ui: Toolbar = {
    setBreakpoint: (bp) => {
      bpEl.textContent = `editing: ${bp.toUpperCase()}`;
    },
    setStatus: (text, kind = 'ok') => {
      statusEl.textContent = text;
      statusEl.dataset.kind = kind;
    },
    setActive: (text) => {
      activeEl.textContent = text;
    },
  };

  const sync = () => ui.setBreakpoint(breakpointFor(window.innerWidth));
  sync();
  window.addEventListener('resize', sync);
  return ui;
}

function injectStyles(): void {
  const css = `
    .cv-place[data-cv-id] { cursor: grab; }
    .cv-place[data-cv-id]:hover { outline: 1px dashed rgba(59,130,246,0.7); outline-offset: 4px; }
    .cv-place[data-cv-id] .cv-scribble { pointer-events: auto; }
    .cv-place.cv-editing { cursor: grabbing; outline: 1px solid #3b82f6 !important; }
    .cv-editor-bar {
      position: fixed; left: 16px; bottom: 16px; z-index: 99999;
      font-family: var(--font-mono, monospace); font-size: 11px; line-height: 1.5;
      color: #d4d4d8; background: rgba(10,10,11,0.92); border: 1px solid #27272a;
      border-radius: 6px; padding: 8px 10px; min-width: 200px;
      backdrop-filter: blur(6px); pointer-events: none; user-select: none;
    }
    .cv-editor-row { display: flex; align-items: center; gap: 7px; }
    .cv-editor-row strong { color: #fff; font-weight: 600; }
    .cv-editor-dot { width: 7px; height: 7px; border-radius: 50%; background: #3b82f6; }
    .cv-editor-bp { margin-left: auto; color: #3b82f6; letter-spacing: 0.04em; }
    .cv-editor-hint { color: #71717a; margin-top: 4px; }
    .cv-editor-active { color: #a1a1aa; margin-top: 4px; }
    .cv-editor-status { margin-top: 4px; }
    .cv-editor-status[data-kind="ok"] { color: #86efac; }
    .cv-editor-status[data-kind="busy"] { color: #fbbf24; }
    .cv-editor-status[data-kind="err"] { color: #fca5a5; }`;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
}
