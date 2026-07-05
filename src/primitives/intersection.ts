// Intersection-curve features (ai/DESIGN.md §2.5): the "waterline" where two
// analytic surfaces meet. Exact for the cases below; each is emitted as a
// first-class `Feature` of type `intersection` that flows through the same
// visibility + styling pipeline as any other curve.
//
//   • quadric ∩ plane  → a conic (sphere/ellipsoid section; the flagship circle)
//   • sphere ∩ sphere  → a circle (section by the radical plane)
//   • plane ∩ plane     → a line
//
// quadric ∩ quadric in general is a quartic space curve; we have no exact quartic
// carrier yet, so that pairing throws rather than approximating (exactness is a
// project value — .claude/rules).

import type { AABB, Basis, Vec3 } from "../math/types.js";
import type { Curve, ConicParams } from "../curve/types.js";
import type { Mat4 } from "../math/mat4.js";
import type { ElementId, Feature, HatchRegion, Light } from "../pipeline/types.js";
import type { Camera, Ray, Hit } from "../math/types.js";
import type { Curve2D } from "../curve/types.js";
import type { FeatureSource } from "../scene/feature-source.js";
import { basisFromNormal } from "../math/basis.js";
import { aabbFromPoints } from "../math/aabb.js";
import { add, addScaled, cross, dot, length, normalize, sub } from "../math/vec3.js";
import { adjugate, det, mulVec, type Mat3 } from "../math/mat3.js";
import { evaluateConic, intersectConicConic } from "../curve/conic.js";
import { mulVec4, quadricNormal } from "../math/mat4.js";
import { quadricPlaneConic } from "./quadric.js";
import { EPS_ABS, EPS_DENOM, EPS_REL } from "../curve/epsilon.js";

export interface Section {
  curve: Curve;
  bounds: AABB;
}

/** A curve (or curves) where two surfaces meet, as a `FeatureSource`. A 1-D curve
 *  does not occlude, so raycast / silhouettes are empty (like a Line). A quartic
 *  intersection may have more than one loop, hence a list of sections. */
export class IntersectionCurve implements FeatureSource {
  private readonly sections: readonly Section[];

  constructor(sections: Section | Section[] | null, readonly id: ElementId) {
    this.sections = sections === null ? [] : Array.isArray(sections) ? sections : [sections];
  }

  bounds(): AABB {
    if (this.sections.length === 0) return { min: [0, 0, 0], max: [0, 0, 0] };
    let b = this.sections[0]!.bounds;
    for (let i = 1; i < this.sections.length; i++) {
      const o = this.sections[i]!.bounds;
      b = { min: [Math.min(b.min[0], o.min[0]), Math.min(b.min[1], o.min[1]), Math.min(b.min[2], o.min[2])], max: [Math.max(b.max[0], o.max[0]), Math.max(b.max[1], o.max[1]), Math.max(b.max[2], o.max[2])] };
    }
    return b;
  }

  extractFeatures(_cam: Camera): Feature[] {
    return this.sections.map((s) => ({ type: "intersection" as const, owner: this.id, curve: s.curve, attrs: {} }));
  }

  hatchRegions(_cam: Camera, _light: Light): HatchRegion[] {
    return [];
  }
  raycast(_ray: Ray): Hit[] {
    return [];
  }
  projectedSilhouettes(_cam: Camera): Curve2D[] {
    return [];
  }
}

// ---------------------------------------------------------------------------
// builders
// ---------------------------------------------------------------------------

const conicCenter = (k: ConicParams): [number, number] => {
  const d = 4 * k.A * k.C - k.B * k.B;
  if (Math.abs(d) < EPS_DENOM) return [0, 0];
  return [(-2 * k.C * k.D + k.B * k.E) / d, (-2 * k.A * k.E + k.B * k.D) / d];
};

/** Build the section curve for a plane conic, or null if it has no real points. */
function conicSection(plane: Basis, params: ConicParams): Section | null {
  const [cx, cy] = conicCenter(params);
  const Fc = evaluateConic(params, cx, cy);
  const worldPts: Vec3[] = [];
  for (let i = 0; i < 48; i++) {
    const th = (2 * Math.PI * i) / 48;
    const c = Math.cos(th);
    const s = Math.sin(th);
    const form = params.A * c * c + params.B * c * s + params.C * s * s;
    if (Math.abs(form) < EPS_DENOM) continue;
    const ratio = -Fc / form;
    if (ratio <= 0) continue;
    const rho = Math.sqrt(ratio);
    const u = cx + rho * c;
    const v = cy + rho * s;
    worldPts.push([
      plane.origin[0] + u * plane.x[0] + v * plane.y[0],
      plane.origin[1] + u * plane.x[1] + v * plane.y[1],
      plane.origin[2] + u * plane.x[2] + v * plane.y[2],
    ]);
  }
  if (worldPts.length < 3) return null; // plane misses the quadric
  return { curve: { kind: "conic", params, plane }, bounds: aabbFromPoints(worldPts) };
}

/** quadric ∩ plane → conic section (null if the plane misses the surface). */
export function intersectQuadricPlane(Q: Mat4, planePoint: Vec3, planeNormal: Vec3): Section | null {
  const plane = basisFromNormal(planePoint, planeNormal);
  return conicSection(plane, quadricPlaneConic(Q, plane));
}

/** The radical plane of two quadrics whose quadratic parts match (spheres, or two
 *  equal-shape quadrics): their difference is linear. Null otherwise. */
function radicalPlane(Q1: Mat4, Q2: Mat4): { point: Vec3; normal: Vec3 } | null {
  const a = Q1[0] as number;
  const b = Q2[0] as number;
  if (Math.abs(a) < EPS_ABS || Math.abs(b) < EPS_ABS) return null;
  const s1 = 1 / a;
  const s2 = 1 / b;
  const D = new Array<number>(16);
  for (let i = 0; i < 16; i++) D[i] = (Q1[i] as number) * s1 - (Q2[i] as number) * s2;
  const quadraticLeftover =
    Math.abs(D[0]!) + Math.abs(D[1]!) + Math.abs(D[2]!) + Math.abs(D[5]!) + Math.abs(D[6]!) + Math.abs(D[10]!);
  if (quadraticLeftover > EPS_REL) return null; // genuinely different quadratics
  const n: Vec3 = [2 * D[3]!, 2 * D[7]!, 2 * D[11]!];
  const nn = n[0] * n[0] + n[1] * n[1] + n[2] * n[2];
  if (nn <= EPS_ABS) return null; // concentric
  const t = -D[15]! / nn;
  return { point: [n[0] * t, n[1] * t, n[2] * t], normal: n };
}

/**
 * quadric ∩ quadric, general. Uses the radical-plane shortcut when the quadratic
 * parts match (sphere ∩ sphere and equal-shape quadrics → an exact conic), and
 * otherwise traces the quartic (`intersectQuadricQuadric`). Returns 0, 1, or 2
 * section curves.
 */
export function intersectQuadrics(Q1: Mat4, Q2: Mat4, b1: AABB, b2: AABB): Section[] {
  const radical = radicalPlane(Q1, Q2);
  if (radical) {
    const sec = intersectQuadricPlane(Q1, radical.point, radical.normal);
    return sec ? [sec] : [];
  }
  return intersectQuadricQuadric(Q1, Q2, b1, b2);
}

/** Centre of a quadric (where the gradient vanishes): A·c = −b, or null if the
 *  3×3 part A is singular (an unbounded quadric with no unique centre). */
function quadricCenter(Q: Mat4): Vec3 | null {
  const A: Mat3 = [Q[0] as number, Q[1] as number, Q[2] as number, Q[4] as number, Q[5] as number, Q[6] as number, Q[8] as number, Q[9] as number, Q[10] as number];
  const b: Vec3 = [Q[3] as number, Q[7] as number, Q[11] as number];
  const d = det(A);
  if (Math.abs(d) <= EPS_DENOM) return null;
  const c = mulVec(adjugate(A), [-b[0], -b[1], -b[2]]);
  return [c[0] / d, c[1] / d, c[2] / d];
}

function aabbRangeAlong(box: AABB, dir: Vec3): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < 8; i++) {
    const x = i & 1 ? box.max[0] : box.min[0];
    const y = i & 2 ? box.max[1] : box.min[1];
    const z = i & 4 ? box.max[2] : box.min[2];
    const s = x * dir[0] + y * dir[1] + z * dir[2];
    if (s < lo) lo = s;
    if (s > hi) hi = s;
  }
  return [lo, hi];
}

/**
 * quadric ∩ quadric → the quartic space curve, as sampled polyline(s). No exact
 * low-degree carrier exists for a quartic, so it is traced: sweep cutting planes;
 * in each plane both quadrics section to conics whose *exact* intersections
 * (conic∩conic kernel) are points on the quartic. Points are then chained into
 * one or more polyline loops (ai/DESIGN.md §2.5).
 */
export function intersectQuadricQuadric(Q1: Mat4, Q2: Mat4, b1: AABB, b2: AABB): Section[] {
  const c1 = quadricCenter(Q1);
  const c2 = quadricCenter(Q2);
  let dir: Vec3 = [0, 0, 1];
  if (c1 && c2) {
    const dd = sub(c2, c1);
    if (length(dd) > EPS_REL) dir = normalize(dd);
  }
  const [lo1, hi1] = aabbRangeAlong(b1, dir);
  const [lo2, hi2] = aabbRangeAlong(b2, dir);
  const lo = Math.max(lo1, lo2);
  const hi = Math.min(hi1, hi2);
  if (hi - lo <= EPS_ABS) return [];

  const N = 160;
  const pts: Vec3[] = [];
  const plane0 = basisFromNormal([dir[0] * lo, dir[1] * lo, dir[2] * lo], dir);
  for (let i = 1; i < N; i++) {
    const s = lo + ((hi - lo) * i) / N;
    const origin: Vec3 = [dir[0] * s, dir[1] * s, dir[2] * s];
    const plane = { origin, x: plane0.x, y: plane0.y, z: plane0.z };
    const k1 = quadricPlaneConic(Q1, plane);
    const k2 = quadricPlaneConic(Q2, plane);
    const res = intersectConicConic(k1, k2);
    if (res.kind !== "points") continue;
    for (const p of res.points) {
      pts.push([
        origin[0] + p.point[0] * plane.x[0] + p.point[1] * plane.y[0],
        origin[1] + p.point[0] * plane.x[1] + p.point[1] * plane.y[1],
        origin[2] + p.point[0] * plane.x[2] + p.point[1] * plane.y[2],
      ]);
    }
  }
  if (pts.length < 4) return [];

  return chainPoints(pts).map((chain) => {
    const refined = refineChain(chain, Q1, Q2);
    return { curve: { kind: "polyline", pts: refined }, bounds: aabbFromPoints(refined) };
  });
}

/** f(x) = (x,1)ᵀ Q (x,1) — the quadric's implicit value at x. */
function quadricValue(Q: Mat4, p: Vec3): number {
  const q = mulVec4(Q, p[0], p[1], p[2], 1);
  return p[0] * q[0] + p[1] * q[1] + p[2] * q[2] + q[3];
}

/**
 * Snap a point onto the intersection curve Q1=0 ∩ Q2=0 by a few Newton steps in
 * the plane spanned by the two gradients (minimum-norm correction). Makes refined
 * samples lie *exactly* on both surfaces rather than on straight chords.
 */
function projectToCurve(Q1: Mat4, Q2: Mat4, p0: Vec3): Vec3 {
  let x = p0;
  for (let k = 0; k < 5; k++) {
    const n1 = quadricNormal(Q1, x);
    const n2 = quadricNormal(Q2, x);
    const G1: Vec3 = [2 * n1[0], 2 * n1[1], 2 * n1[2]];
    const G2: Vec3 = [2 * n2[0], 2 * n2[1], 2 * n2[2]];
    const f1 = quadricValue(Q1, x);
    const f2 = quadricValue(Q2, x);
    if (Math.abs(f1) + Math.abs(f2) < 1e-13) break;
    const a = dot(G1, G1);
    const b = dot(G1, G2);
    const c = dot(G2, G2);
    const detJ = a * c - b * b;
    if (Math.abs(detJ) <= EPS_ABS) break; // gradients parallel (tangency)
    // w = (J Jᵀ)⁻¹ r,   δ = −Jᵀ w
    const w0 = (c * f1 - b * f2) / detJ;
    const w1 = (a * f2 - b * f1) / detJ;
    x = [x[0] - (w0 * G1[0] + w1 * G2[0]), x[1] - (w0 * G1[1] + w1 * G2[1]), x[2] - (w0 * G1[2] + w1 * G2[2])];
  }
  return x;
}

const dist3 = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Adaptively subdivide a chained polyline, projecting each inserted midpoint
 *  onto the exact curve, until segments are short (smooth, high-res, exact). */
function refineChain(chain: readonly Vec3[], Q1: Mat4, Q2: Mat4): Vec3[] {
  if (chain.length < 2) return chain.map((p) => [p[0], p[1], p[2]]);
  const bb = aabbFromPoints(chain);
  const maxSeg = Math.max(dist3(bb.min, bb.max) * 0.02, 1e-4);
  const out: Vec3[] = [[chain[0]![0], chain[0]![1], chain[0]![2]]];
  const recurse = (a: Vec3, b: Vec3, depth: number): void => {
    if (depth > 0 && dist3(a, b) > maxSeg) {
      const mid = projectToCurve(Q1, Q2, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]);
      recurse(a, mid, depth - 1);
      out.push(mid);
      recurse(mid, b, depth - 1);
    }
  };
  for (let i = 1; i < chain.length; i++) {
    recurse(chain[i - 1]!, chain[i]!, 6);
    out.push([chain[i]![0], chain[i]![1], chain[i]![2]]);
  }
  return out;
}

/** Greedy nearest-neighbour chaining of a point cloud on a smooth curve into
 *  ordered polylines, closing a chain when its ends meet. */
function chainPoints(points: readonly Vec3[]): Vec3[][] {
  const n = points.length;
  const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  // adaptive gap threshold from the median nearest-neighbour distance
  const nn: number[] = [];
  for (let i = 0; i < n; i++) {
    let best = Infinity;
    for (let j = 0; j < n; j++) if (j !== i) best = Math.min(best, dist(points[i]!, points[j]!));
    nn.push(best);
  }
  const sorted = [...nn].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] || 1;
  const maxGap = 5 * median;

  const used = new Array<boolean>(n).fill(false);
  const nearestUnused = (from: number): number => {
    let best = -1;
    let bestD = maxGap;
    for (let j = 0; j < n; j++) {
      if (used[j]) continue;
      const d = dist(points[from]!, points[j]!);
      if (d < bestD) {
        bestD = d;
        best = j;
      }
    }
    return best;
  };

  const chains: Vec3[][] = [];
  for (let start = 0; start < n; start++) {
    if (used[start]) continue;
    const idx: number[] = [start];
    used[start] = true;
    // grow forward, then backward
    for (let cur = nearestUnused(start); cur >= 0; cur = nearestUnused(idx[idx.length - 1]!)) {
      idx.push(cur);
      used[cur] = true;
    }
    for (let cur = nearestUnused(start); cur >= 0; cur = nearestUnused(idx[0]!)) {
      idx.unshift(cur);
      used[cur] = true;
    }
    if (idx.length < 3) continue;
    const chain = idx.map((k) => points[k]!);
    if (dist(chain[0]!, chain[chain.length - 1]!) <= maxGap) chain.push(chain[0]!); // close the loop
    chains.push(chain);
  }
  return chains;
}

/** plane ∩ plane → a line, clipped to ±`extent` about the closest point. */
export function intersectPlanes(
  pA: Vec3,
  nA: Vec3,
  pB: Vec3,
  nB: Vec3,
  extent: number,
): Section | null {
  const dirRaw = cross(nA, nB);
  const L = length(dirRaw);
  if (L <= EPS_REL) return null; // parallel planes
  const dir = normalize(dirRaw);
  // Solve [nA; nB; dir]·p = [nA·pA, nB·pB, 0] for the point p0 on both planes.
  const M: Mat3 = [nA[0], nA[1], nA[2], nB[0], nB[1], nB[2], dir[0], dir[1], dir[2]];
  const d = det(M);
  if (Math.abs(d) <= EPS_ABS) return null;
  const rhs: Vec3 = [dot(nA, pA), dot(nB, pB), 0];
  // p0 = M⁻¹ rhs = (adj(M)/det) rhs
  const p0 = mulVec(adjugate(M), rhs);
  const p0s: Vec3 = [p0[0] / d, p0[1] / d, p0[2] / d];
  const a = addScaled(p0s, dir, -extent);
  const b = add(p0s, addScaled([0, 0, 0], dir, extent));
  return { curve: { kind: "line", a, b }, bounds: aabbFromPoints([a, b]) };
}
