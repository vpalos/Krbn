// Adaptive screen-flatness sampling of an analytic curve (ai/DESIGN.md §2.3,
// stage-5 emit). We subdivide a parameter interval only where the curve's
// *projected* midpoint strays from the chord by more than a pixel tolerance, so
// straight or nearly-straight spans stay cheap while tight bends get resolved —
// resolution-independence without a fixed step count.

import type { Vec2, Vec3 } from "../math/types.js";

export interface SampleOptions {
  /** max allowed screen deviation of the chord from the true curve, in pixels */
  tolerancePx: number;
  /** recursion guard */
  maxDepth: number;
  /**
   * Force uniform subdivision to at least this depth (2^minDepth segments) before
   * the deviation test can stop. Guards against *midpoint aliasing*: a curve that
   * is symmetric about an interval's centre has its midpoint sitting on the chord
   * (deviation ≈ 0), so a single-midpoint test would wrongly declare it flat and
   * collapse an oscillation (or a symmetric Bézier) to a straight line. A small
   * floor breaks that symmetry so the adaptive pass sees the real shape. Default 0
   * (pure adaptive) for curves with no such symmetry — e.g. conic emit sampling.
   */
  minDepth?: number;
}

export const DEFAULT_SAMPLE: SampleOptions = { tolerancePx: 0.3, maxDepth: 20 };

/** Perpendicular distance from p to segment a–b, in screen units. */
function segmentDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const len2 = abx * abx + aby * aby;
  if (len2 <= 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  let t = ((p[0] - a[0]) * abx + (p[1] - a[1]) * aby) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * abx), p[1] - (a[1] + t * aby));
}

export interface SampleResult {
  ts: number[];
  points: Vec3[];
}

/**
 * Sample `f` over [t0, t1] so the projected polyline is flat to `tolerancePx`.
 * `project` maps an object-space point to screen pixels (the flatness metric).
 * Returns object-space points at the chosen parameters (ordered, endpoints included).
 */
export function adaptiveSample(
  f: (t: number) => Vec3,
  t0: number,
  t1: number,
  project: (p: Vec3) => Vec2,
  opts: SampleOptions = DEFAULT_SAMPLE,
): SampleResult {
  const ts: number[] = [t0];
  const points: Vec3[] = [f(t0)];

  const minDepth = opts.minDepth ?? 0;
  const recurse = (ta: number, pa: Vec3, tb: number, pb: Vec3, depth: number): void => {
    const tm = 0.5 * (ta + tb);
    const pm = f(tm);
    const dev = segmentDistance(project(pm), project(pa), project(pb));
    // subdivide while below the uniform floor, then only where the chord strays
    if ((depth < minDepth || dev > opts.tolerancePx) && depth < opts.maxDepth) {
      recurse(ta, pa, tm, pm, depth + 1);
      ts.push(tm);
      points.push(pm);
      recurse(tm, pm, tb, pb, depth + 1);
    }
  };

  const pEnd = f(t1);
  recurse(t0, points[0]!, t1, pEnd, 0);
  ts.push(t1);
  points.push(pEnd);
  return { ts, points };
}

/** de Casteljau evaluation of a Bézier curve of any degree at parameter t ∈ [0,1]. */
export function deCasteljau(control: readonly Vec3[], t: number): Vec3 {
  if (control.length === 0) throw new Error("Bézier needs at least one control point");
  const pts: Vec3[] = control.map((p) => [p[0], p[1], p[2]]);
  for (let k = pts.length - 1; k > 0; k--) {
    for (let i = 0; i < k; i++) {
      const a = pts[i]!;
      const b = pts[i + 1]!;
      pts[i] = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    }
  }
  return pts[0]!;
}
