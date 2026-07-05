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
import { evaluateConic } from "../curve/conic.js";
import { quadricPlaneConic } from "./quadric.js";
import { EPS_ABS } from "../curve/epsilon.js";

export interface Section {
  curve: Curve;
  bounds: AABB;
}

/** A curve where two surfaces meet, as a `FeatureSource`. A 1-D curve does not
 *  occlude, so raycast / silhouettes are empty (like a Line). */
export class IntersectionCurve implements FeatureSource {
  constructor(
    private readonly section: Section | null,
    readonly id: ElementId,
  ) {}

  bounds(): AABB {
    return this.section?.bounds ?? { min: [0, 0, 0], max: [0, 0, 0] };
  }

  extractFeatures(_cam: Camera): Feature[] {
    if (!this.section) return [];
    return [{ type: "intersection", owner: this.id, curve: this.section.curve, attrs: {} }];
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
  if (Math.abs(d) < 1e-15) return [0, 0];
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
    if (Math.abs(form) < 1e-15) continue;
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

/** sphere ∩ sphere → circle via the radical plane. Throws for a genuine
 *  quadric ∩ quadric quartic (unequal quadratic parts). */
export function intersectSpheres(Q1: Mat4, Q2: Mat4): Section | null {
  const a = Q1[0] as number;
  const b = Q2[0] as number;
  if (Math.abs(a) < EPS_ABS || Math.abs(b) < EPS_ABS) {
    throw new Error("intersectSpheres: inputs are not spheres (no x² term)");
  }
  // Normalize leading coefficients, then subtract: the quadratic parts must cancel.
  const s1 = 1 / a;
  const s2 = 1 / b;
  const D = new Array<number>(16);
  for (let i = 0; i < 16; i++) D[i] = (Q1[i] as number) * s1 - (Q2[i] as number) * s2;
  const quadraticLeftover =
    Math.abs(D[0]!) + Math.abs(D[1]!) + Math.abs(D[2]!) + Math.abs(D[5]!) + Math.abs(D[6]!) + Math.abs(D[10]!);
  if (quadraticLeftover > 1e-9) {
    throw new Error("quadric ∩ quadric is a quartic; only sphere ∩ sphere is supported");
  }
  const n: Vec3 = [2 * D[3]!, 2 * D[7]!, 2 * D[11]!];
  const nn = n[0] * n[0] + n[1] * n[1] + n[2] * n[2];
  if (nn <= EPS_ABS) return null; // concentric: no radical plane
  const dConst = D[15]!;
  const t = -dConst / nn;
  const planePoint: Vec3 = [n[0] * t, n[1] * t, n[2] * t];
  return intersectQuadricPlane(Q1, planePoint, n);
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
  if (L <= 1e-9) return null; // parallel planes
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
