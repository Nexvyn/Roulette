import { useLayoutEffect, useRef, useState } from "react";

/* Squircle (continuous-corner) path, the curve Figma draws with "corner smoothing".
   `r` is the corner radius, `s` the smoothing 0..1 (0.6 matches iOS). */
export function squirclePath(w: number, h: number, r: number, s = 0.6) {
  const budget = Math.min(w, h) / 2;
  r = Math.min(r, budget);
  let p = (1 + s) * r;
  if (p > budget) {
    s = Math.max(0, Math.min(s, budget / r - 1));
    p = Math.min(p, budget);
  }
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const arcMeasure = 90 * (1 - s);
  const l = Math.sin(rad(arcMeasure / 2)) * r * Math.SQRT2;
  const alpha = (90 - arcMeasure) / 2;
  const p34 = r * Math.tan(rad(alpha / 2));
  const beta = 45 * s;
  const c = p34 * Math.cos(rad(beta));
  const d = c * Math.tan(rad(beta));
  const b = (p - l - c - d) / 3;
  const a = 2 * b;
  const n = (v: number) => +v.toFixed(3);
  const [A, C, D, L, R] = [a, c, d, l, r].map(n);
  const abc = n(a + b + c), bc = n(b + c), ab = n(a + b);
  return [
    `M ${n(w - p)} 0`,
    `c ${A} 0 ${ab} 0 ${abc} ${D} a ${R} ${R} 0 0 1 ${L} ${L} c ${D} ${C} ${D} ${bc} ${D} ${abc}`,
    `L ${n(w)} ${n(h - p)}`,
    `c 0 ${A} 0 ${ab} ${-D} ${abc} a ${R} ${R} 0 0 1 ${-L} ${L} c ${-C} ${D} ${-bc} ${D} ${-abc} ${D}`,
    `L ${n(p)} ${n(h)}`,
    `c ${-A} 0 ${-ab} 0 ${-abc} ${-D} a ${R} ${R} 0 0 1 ${-L} ${-L} c ${-D} ${-C} ${-D} ${-bc} ${-D} ${-abc}`,
    `L 0 ${n(p)}`,
    `c 0 ${-A} 0 ${-ab} ${D} ${-abc} a ${R} ${R} 0 0 1 ${L} ${-L} c ${C} ${-D} ${bc} ${-D} ${abc} ${-D}`,
    "Z",
  ].join(" ");
}

export function useSquircle<T extends HTMLElement>(radius: number, smoothing = 0.8) {
  const ref = useRef<T>(null);
  const [clip, setClip] = useState<string | undefined>(undefined);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const { offsetWidth: w, offsetHeight: h } = el;
      if (w && h) setClip(`path("${squirclePath(w, h, radius, smoothing)}")`);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [radius, smoothing]);
  const style: React.CSSProperties = clip ? { clipPath: clip, WebkitClipPath: clip } : { borderRadius: radius };
  return { ref, style };
}

/* A box with squircle corners. Clip paths also cut off borders and shadows, so a hairline edge
   is drawn back on with an SVG stroke (`edge`); a shadow goes on a separate layer behind it. */
export function Squircle({
  radius,
  smoothing = 0.8,
  edge,
  className = "",
  style,
  children,
}: {
  radius: number;
  smoothing?: number;
  edge?: string;
  className?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () =>
      setSize((s) => (s && s.w === el.offsetWidth && s.h === el.offsetHeight ? s : { w: el.offsetWidth, h: el.offsetHeight }));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const d = size && size.w && size.h ? squirclePath(size.w, size.h, radius, smoothing) : null;
  const clip = d ? `path("${d}")` : undefined;
  return (
    <div
      ref={ref}
      className={`sp-squircle ${className}`}
      style={{ ...style, ...(clip ? { clipPath: clip, WebkitClipPath: clip } : { borderRadius: radius }) }}
    >
      {children}
      {edge && d ? (
        <svg aria-hidden className="sp-squircle-edge" width={size!.w} height={size!.h}>
          {/* half of a 1px stroke sits outside the clip, leaving a 0.5px hairline */}
          <path d={d} fill="none" stroke={edge} strokeWidth={1} />
        </svg>
      ) : null}
    </div>
  );
}
