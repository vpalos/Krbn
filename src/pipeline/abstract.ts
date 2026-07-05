// Stage 3 — abstraction (ai/DESIGN.md §2.7). Lighter here than in the mesh
// regime: an analytic arc is already one confident stroke, so simplification is
// mostly a no-op. What still runs:
//   • screen-size thresholding — drop a feature whose projected extent < N px,
//     recomputed per frame so detail thins as you zoom out. Importance modulates
//     the cutoff (high importance keeps detail; low raises the bar).
//   • tone quantization — snap shading to k discrete levels before hatching.
// Cross-primitive consolidation (§2.7) is not yet implemented.

import type { Curve2D } from "../curve/types.js";
import type { ElementId, Stroke } from "./types.js";
import { EPS_DENOM } from "../curve/epsilon.js";

/** Projected screen extent (bounding-box diagonal, px) of a curve. */
export function screenExtent(curve: Curve2D): number {
  switch (curve.kind) {
    case "line":
      return Math.hypot(curve.b[0] - curve.a[0], curve.b[1] - curve.a[1]);
    case "arc":
      return 2 * curve.radius;
    case "polyline":
      return bboxDiag(curve.pts);
    case "conic": {
      const k = curve.params;
      const d = 4 * k.A * k.C - k.B * k.B;
      const cx = Math.abs(d) < EPS_DENOM ? 0 : (-2 * k.C * k.D + k.B * k.E) / d;
      const cy = Math.abs(d) < EPS_DENOM ? 0 : (-2 * k.A * k.E + k.B * k.D) / d;
      const Fc = k.A * cx * cx + k.B * cx * cy + k.C * cy * cy + k.D * cx + k.E * cy + k.F;
      const pts: [number, number][] = [];
      for (let i = 0; i < 32; i++) {
        const th = (2 * Math.PI * i) / 32;
        const c = Math.cos(th);
        const s = Math.sin(th);
        const form = k.A * c * c + k.B * c * s + k.C * s * s;
        if (Math.abs(form) < EPS_DENOM) continue;
        const ratio = -Fc / form;
        if (ratio <= 0) continue;
        const rho = Math.sqrt(ratio);
        pts.push([cx + rho * c, cy + rho * s]);
      }
      return pts.length ? bboxDiag(pts) : 0;
    }
  }
}

function bboxDiag(pts: readonly (readonly [number, number])[]): number {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return Math.hypot(maxX - minX, maxY - minY);
}

/**
 * Effective feature-size cutoff for an element, given the base cutoff and the
 * element's importance (0..1). Importance 1 → cutoff 0 (never dropped);
 * importance 0 → the full base cutoff.
 */
export function cutoffFor(importance: number, baseCutoffPx: number): number {
  return Math.max(0, baseCutoffPx * (1 - Math.max(0, Math.min(1, importance))));
}

export interface AbstractionOptions {
  /** base screen-size cutoff in px (0 disables thresholding) */
  minFeaturePx: number;
  /** importance lookup by owner (defaults to 0.5 if unknown) */
  importanceOf?: (owner: ElementId) => number;
}

/** Drop strokes whose projected extent falls below the importance-scaled cutoff. */
export function applyAbstraction(strokes: readonly Stroke[], opts: AbstractionOptions): Stroke[] {
  if (opts.minFeaturePx <= 0) return [...strokes];
  const importanceOf = opts.importanceOf ?? (() => 0.5);
  return strokes.filter(
    (st) => screenExtent(st.screen) >= cutoffFor(importanceOf(st.feature.owner), opts.minFeaturePx),
  );
}

/** Snap a 0..1 tone to `levels` discrete steps (k-level shading, §2.7). */
export function quantizeTone(tone: number, levels: number): number {
  if (levels <= 0) return tone;
  const t = Math.max(0, Math.min(1, tone));
  return Math.round(t * levels) / levels;
}
