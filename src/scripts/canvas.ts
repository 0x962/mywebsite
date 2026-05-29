/**
 * Canvas controller. For each [data-canvas] stage on the page:
 *   - reads the active breakpoint's design width/height (set in CSS via media
 *     queries on --cv-dw / --cv-h),
 *   - computes a uniform scale = min(1, availableWidth / designWidth),
 *   - applies it as --cv-scale and sets the element's flowed height so the
 *     document scrolls correctly.
 *
 * Recomputes on resize and once web fonts settle. No JS → scale defaults to 1
 * (see global.css), so the canvas still renders, just unscaled.
 */
function updateCanvas(el: HTMLElement): void {
  const cs = getComputedStyle(el);
  const dw = parseFloat(cs.getPropertyValue('--cv-dw')) || 1280;
  const dh = parseFloat(cs.getPropertyValue('--cv-h')) || 1000;
  const maxScale = parseFloat(cs.getPropertyValue('--cv-max-scale')) || Infinity;
  const avail = el.clientWidth;
  // Zoom to fill the available width (capped only by an optional --cv-max-scale).
  const scale = Math.min(maxScale, avail / dw);
  el.style.setProperty('--cv-scale', String(scale));
  el.style.height = `${dh * scale}px`;
}

export function initCanvases(): void {
  const stages = document.querySelectorAll<HTMLElement>('[data-canvas]');
  stages.forEach((el) => {
    if (el.dataset.canvasReady) return;
    el.dataset.canvasReady = '1';

    const update = () => updateCanvas(el);
    update();

    if ('ResizeObserver' in window) {
      new ResizeObserver(update).observe(el);
    } else {
      window.addEventListener('resize', update);
    }
    if (document.fonts?.ready) document.fonts.ready.then(update);
  });
}
