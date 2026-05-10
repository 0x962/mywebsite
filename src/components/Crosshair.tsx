import { useEffect, useRef, useState } from 'react';

/**
 * Crosshair cursor that updates via CSS vars on a ref — no React state on
 * mousemove, so no re-renders.
 */
export default function Crosshair() {
  const ref = useRef<HTMLDivElement | null>(null);
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    const fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    if (!fine) return;
    setEnabled(true);

    const el = ref.current;
    if (!el) return;

    let frame = 0;
    let x = -100;
    let y = -100;

    const onMove = (e: MouseEvent) => {
      x = e.clientX;
      y = e.clientY;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        el.style.setProperty('--cursor-x', `${x}px`);
        el.style.setProperty('--cursor-y', `${y}px`);
        frame = 0;
      });
    };

    window.addEventListener('mousemove', onMove, { passive: true });
    return () => {
      window.removeEventListener('mousemove', onMove);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  if (!enabled) return null;
  return (
    <div ref={ref} className="custom-cursor" aria-hidden="true">
      <div className="cursor-line line-v" />
      <div className="cursor-line line-h" />
    </div>
  );
}
