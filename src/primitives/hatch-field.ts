// Helpers shared by the primitives that expose a curved hatch direction field
// (ai/DESIGN.md §2.6). A field is a list of *families*, each a list of exact
// iso-parameter curves given as world-space samples with normals; the scene
// projects them and clips to the visible, tonally-dark, front-facing surface.
//
// These helpers only build geometry (circles, segments) and estimate how many
// curves to emit from a projected screen size — the exactness lives in the
// primitive's own normal formula, which the caller supplies.

import type { Camera, Vec2, Vec3 } from "../math/types.js";
import type { HatchFieldCurve, HatchSample } from "../pipeline/types.js";
import { projectionMatrix, projectPoint } from "../math/camera.js";
import { normalize } from "../math/vec3.js";

/** Screen distance between two world points (for spacing-driven curve counts). */
export function screenDist(cam: Camera, a: Vec3, b: Vec3): number {
  const P = projectionMatrix(cam);
  const pa = projectPoint(P, a).point;
  const pb = projectPoint(P, b).point;
  return Math.hypot(pa[0] - pb[0], pa[1] - pb[1]);
}

/** How many iso-curves to fit across `screenSpan` px at `spacingPx`, clamped. */
export function curveCount(screenSpan: number, spacingPx: number, min: number, max: number): number {
  const n = Math.round(screenSpan / Math.max(1, spacingPx));
  return Math.max(min, Math.min(max, n));
}

/** One iso-parameter value of a dyadic ladder (see `dyadicLadder`). */
export interface LadderStop {
  /** the iso-parameter, in (0,1) (open) or [0,1) (periodic) */
  t: number;
  /** stable identity — the dyadic fraction, e.g. "3/8" */
  key: string;
}

/**
 * Dyadic iso-parameter ladder — temporal coherence for analytic hatch fields
 * (ai/DESIGN.md §3.3.7). Instead of `round(span/spacing)` evenly re-spaced
 * values (which *move every curve* whenever the camera changes the count),
 * iso-values live on a fixed dyadic grid: level 0 = {1/2} (open) or {0}
 * (periodic), and each level adds the midpoints between existing values — so
 * the union over levels 0..L is evenly spaced, refining never moves a curve,
 * and each value's fraction is a stable identity for wobble seeding.
 *
 * The density demand is **rounded to the nearest complete level** — partial
 * levels are never emitted. A partially-arrived interleaving level cannot look
 * right in a still: faded by opacity it reads as gray/black banding, by weight
 * as thick/thin banding, and arriving line-by-line as pair/gap spacing — the
 * artifact just moves channels (this was tried; see ROADMAP Phase-2 item 6.5).
 * The cost is a discrete switch when a *zoom* crosses a level boundary;
 * smoothing that transition is cross-frame-state territory (a session-side
 * crossfade), not a per-frame concern.
 *
 * `min`/`max` are *approximate* curve-count clamps, honoured as ladder levels:
 * counts are 2^(L+1)−1 (open) / 2^L (periodic).
 */
export function dyadicLadder(desired: number, opts: { periodic?: boolean; min?: number; max?: number } = {}): LadderStop[] {
  const periodic = opts.periodic ?? false;
  const toLevel = (n: number) => (periodic ? Math.log2(Math.max(1, n)) : Math.log2(Math.max(1, n) + 1) - 1);
  const minL = Math.max(0, Math.ceil(toLevel(opts.min ?? 1) - 1e-9));
  const maxL = Math.max(minL, Math.floor(toLevel(opts.max ?? 4096) + 1e-9));
  const k = Math.round(Math.min(maxL, Math.max(minL, toLevel(desired))));
  const stops: LadderStop[] = [];
  for (let L = 0; L <= k; L++) {
    if (periodic && L === 0) {
      stops.push({ t: 0, key: "0/1" });
      continue;
    }
    const den = 2 ** (periodic ? L : L + 1);
    for (let num = 1; num < den; num += 2) stops.push({ t: num / den, key: `${num}/${den}` });
  }
  return stops;
}

/** Tag a field curve with its ladder identity (in place, for chaining). */
export function tagCurve(curve: HatchFieldCurve, key: string): HatchFieldCurve {
  curve.key = key;
  return curve;
}

/**
 * A world-space circle as field samples: center + radius in the plane (ex, ey),
 * with the outward normal at each sample computed by `normalAt(point)`. The loop
 * is closed (first sample repeated) so the scene can chain it end to end.
 */
export function circleCurve(
  center: Vec3,
  ex: Vec3,
  ey: Vec3,
  radius: number,
  normalAt: (p: Vec3, cosT: number, sinT: number) => Vec3,
  segments: number,
): HatchFieldCurve {
  const samples: HatchSample[] = [];
  for (let i = 0; i <= segments; i++) {
    const th = (2 * Math.PI * i) / segments;
    const c = Math.cos(th);
    const s = Math.sin(th);
    const p: Vec3 = [
      center[0] + radius * (c * ex[0] + s * ey[0]),
      center[1] + radius * (c * ex[1] + s * ey[1]),
      center[2] + radius * (c * ex[2] + s * ey[2]),
    ];
    samples.push({ p, n: normalize(normalAt(p, c, s)) });
  }
  return { samples };
}

/**
 * A sampled world-space parametric curve p(t), t ∈ [0, 1], with a per-point
 * outward normal — for the diagonal iso-curves (helices, spiral generators,
 * (1,1) torus loops) that are neither circles nor segments. The exactness lives
 * in the caller's `at`, which evaluates the surface parametrization directly.
 */
export function paramCurve(at: (t: number) => { p: Vec3; n: Vec3 }, segments: number): HatchFieldCurve {
  const samples: HatchSample[] = [];
  for (let i = 0; i <= segments; i++) {
    const { p, n } = at(i / segments);
    samples.push({ p, n: normalize(n) });
  }
  return { samples };
}

/**
 * A world-space straight segment a→b as field samples, with a constant normal
 * (rulings/generators keep the same surface normal along their length).
 */
export function segmentCurve(a: Vec3, b: Vec3, normal: Vec3, segments: number): HatchFieldCurve {
  const n = normalize(normal);
  const samples: HatchSample[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    samples.push({
      p: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t],
      n,
    });
  }
  return { samples };
}

// re-export for primitives that want the same 2-D type name
export type { Vec2 };
