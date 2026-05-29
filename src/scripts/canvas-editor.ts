/**
 * Dev-only canvas editor. Mounted only under import.meta.env.DEV with `?edit`
 * in the URL (see Canvas.astro), so it never ships to production.
 *
 *   • click an element to select it (blue outline + a rotate knob appears above)
 *   • drag its body to move it
 *   • drag the knob to rotate it around its center (hold Shift to snap to 15°)
 *   • every drop saves the CURRENT breakpoint's { x, y, rotate } to
 *     src/data/layouts/<page>.json via the dev-only /__canvas/save endpoint
 *
 * Breakpoint follows the viewport width — resize to edit desktop / tablet /
 * mobile; the toolbar shows which one is live.
 */
type Breakpoint = 'desktop' | 'tablet' | 'mobile';
const SUFFIX: Record<Breakpoint, string> = { desktop: 'd', tablet: 't', mobile: 'm' };

const breakpointFor = (w: number): Breakpoint => (w < 640 ? 'mobile' : w < 1024 ? 'tablet' : 'desktop');
const suffixNow = () => SUFFIX[breakpointFor(window.innerWidth)];

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

interface Toolbar {
  setBreakpoint(bp: Breakpoint): void;
  setStatus(text: string, kind?: 'ok' | 'busy' | 'err'): void;
  setActive(text: string): void;
}

let mounted = false;

export function initCanvasEditor(): void {
  if (mounted) return;
  mounted = true;

  injectStyles();
  const ui = buildToolbar();

  // single rotate knob, repositioned over the selected element
  const knob = document.createElement('div');
  knob.className = 'cv-rot-knob';
  knob.title = 'drag to rotate (Shift = snap 15°)';
  knob.textContent = '⟳';
  knob.style.display = 'none';
  document.body.appendChild(knob);

  let selected: HTMLElement | null = null;
  type Ctx =
    | { mode: 'move'; el: HTMLElement; s: string; sx: number; sy: number; ox: number; oy: number; scale: number; moved: boolean }
    | { mode: 'rotate'; el: HTMLElement; s: string; cx: number; cy: number; start: number; orot: number; moved: boolean };
  let ctx: Ctx | null = null;

  const stageOf = (el: HTMLElement) => el.closest<HTMLElement>('[data-canvas][data-cv-page]');

  function positionKnob() {
    if (!selected) {
      knob.style.display = 'none';
      return;
    }
    const r = selected.getBoundingClientRect();
    knob.style.display = 'flex';
    knob.style.left = `${r.left + r.width / 2}px`;
    knob.style.top = `${r.top - 26}px`;
  }

  function select(el: HTMLElement | null) {
    if (selected) selected.classList.remove('cv-selected');
    selected = el;
    if (el) el.classList.add('cv-selected');
    positionKnob();
  }

  document.addEventListener('pointerdown', (e) => {
    const target = e.target as HTMLElement;

    // start a rotation when grabbing the knob
    if (target === knob && selected) {
      const r = selected.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      ctx = {
        mode: 'rotate',
        el: selected,
        s: suffixNow(),
        cx,
        cy,
        start: Math.atan2(e.clientY - cy, e.clientX - cx),
        orot: readVar(selected, `--rot-${suffixNow()}`),
        moved: false,
      };
      knob.setPointerCapture?.(e.pointerId);
      e.preventDefault();
      return;
    }

    const el = target.closest<HTMLElement>('.cv-place[data-cv-id]');
    if (el && stageOf(el)) {
      select(el);
      const s = suffixNow();
      ctx = {
        mode: 'move',
        el,
        s,
        sx: e.clientX,
        sy: e.clientY,
        ox: readVar(el, `--x-${s}`),
        oy: readVar(el, `--y-${s}`),
        scale: readVar(stageOf(el)!, '--cv-scale') || 1,
        moved: false,
      };
    } else if (!target.closest('.cv-editor-bar') && target !== knob) {
      select(null);
    }
  });

  document.addEventListener('pointermove', (e) => {
    if (!ctx) return;
    if (ctx.mode === 'move') {
      const dx = e.clientX - ctx.sx;
      const dy = e.clientY - ctx.sy;
      if (!ctx.moved && Math.hypot(dx, dy) < 3) return;
      ctx.moved = true;
      ctx.el.classList.add('cv-editing');
      const x = Math.round(ctx.ox + dx / ctx.scale);
      const y = Math.round(ctx.oy + dy / ctx.scale);
      ctx.el.style.setProperty(`--x-${ctx.s}`, String(x));
      ctx.el.style.setProperty(`--y-${ctx.s}`, String(y));
      ui.setActive(`#${ctx.el.dataset.cvId} · ${x}, ${y}`);
    } else {
      const ang = Math.atan2(e.clientY - ctx.cy, e.clientX - ctx.cx);
      let deg = ctx.orot + ((ang - ctx.start) * 180) / Math.PI;
      if (e.shiftKey) deg = Math.round(deg / 15) * 15;
      deg = Math.round(deg * 10) / 10;
      ctx.moved = true;
      ctx.el.style.setProperty(`--rot-${ctx.s}`, String(deg));
      ui.setActive(`#${ctx.el.dataset.cvId} · ${deg}°`);
    }
    positionKnob();
    e.preventDefault();
  });

  const finish = async () => {
    if (!ctx) return;
    const c = ctx;
    ctx = null;
    c.el.classList.remove('cv-editing');
    if (!c.moved) return; // a plain click — let links/selection stand

    // swallow the click that follows a drag so links don't fire
    const swallow = (ev: Event) => {
      ev.preventDefault();
      ev.stopPropagation();
    };
    document.addEventListener('click', swallow, { capture: true, once: true });
    setTimeout(() => document.removeEventListener('click', swallow, { capture: true }), 0);

    const stage = stageOf(c.el);
    if (!stage) return;
    const page = stage.dataset.cvPage!;
    const id = c.el.dataset.cvId!;
    const bp = breakpointFor(window.innerWidth);
    const patch = {
      x: readVar(c.el, `--x-${c.s}`),
      y: readVar(c.el, `--y-${c.s}`),
      rotate: readVar(c.el, `--rot-${c.s}`),
    };
    ui.setStatus('saving…', 'busy');
    try {
      await save(page, id, bp, patch);
      ui.setStatus(`saved ${id} → ${bp}`, 'ok');
    } catch (err) {
      ui.setStatus(`save failed: ${err}`, 'err');
    }
  };

  document.addEventListener('pointerup', finish);
  document.addEventListener('pointercancel', finish);
  window.addEventListener('scroll', positionKnob, { passive: true });
  window.addEventListener('resize', positionKnob);
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
    <div class="cv-editor-hint">click to select · drag to move · drag the ⟳ knob to rotate (Shift snaps)</div>
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
    .cv-place[data-cv-id]:hover { outline: 1px dashed rgba(59,130,246,0.5); outline-offset: 4px; }
    .cv-place[data-cv-id] .cv-scribble, .cv-place[data-cv-id] .cv-doodle { pointer-events: auto; }
    .cv-place.cv-selected { outline: 1px solid #3b82f6 !important; outline-offset: 4px; }
    .cv-place.cv-editing { cursor: grabbing; }
    .cv-rot-knob {
      position: fixed; z-index: 100000;
      width: 22px; height: 22px; margin: -11px 0 0 -11px;
      align-items: center; justify-content: center;
      border-radius: 50%; background: #3b82f6; color: #fff;
      font-size: 13px; line-height: 1; cursor: grab; user-select: none;
      box-shadow: 0 2px 6px rgba(0,0,0,0.5);
    }
    .cv-rot-knob:active { cursor: grabbing; }
    .cv-editor-bar {
      position: fixed; left: 16px; bottom: 16px; z-index: 99999;
      font-family: var(--font-mono, monospace); font-size: 11px; line-height: 1.5;
      color: #d4d4d8; background: rgba(10,10,11,0.92); border: 1px solid #27272a;
      border-radius: 6px; padding: 8px 10px; min-width: 200px; max-width: 320px;
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
