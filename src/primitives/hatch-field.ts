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
