// Finite right circular cone — a quadric configuration (ai/DESIGN.md §2.3).
//
// Silhouette = two straight generators through the apex + the base rim circle.
// A generator direction is g = cosα·â + sinα·m for a unit m ⊥ â. The contour
// condition (surface normal ⟂ view) reduces — for BOTH ortho and perspective —
// to the single linear constraint
//     m · d⊥ = (â · d) · tanα ,   d = view direction (ortho) or eye−apex (persp),
// which is a clean derivation: the two solutions for m give the two generators.
// (The base rim is a crease/boundary; back-half self-occlusion is step 5.)

import type { AABB, Camera, Hit, Ray, Vec2, Vec3 } from "../math/types.js";
import type { Curve2D } from "../curve/types.js";
import type { ElementId, Feature, HatchFamily, HatchFieldOptions, HatchRegion, Light } from "../pipeline/types.js";
import type { FeatureSource } from "../scene/feature-source.js";
import { basisFromNormal } from "../math/basis.js";
import { add, addScaled, dot, length, normalize, sub } from "../math/vec3.js";
import { cameraFrame, projectionMatrix, projectPoint } from "../math/camera.js";
import { projectCircle } from "../math/project.js";
import { convexHull } from "../math/hull.js";
import { circleCurve, curveCount, screenDist, segmentCurve } from "./hatch-field.js";
import { solveQuadratic } from "../curve/roots.js";
import { EPS_ABS } from "../curve/epsilon.js";

let autoId = 0;
const nextId = (): ElementId => `cone-${autoId++}`;

const TWO_PI = Math.PI * 2;

export class Cone implements FeatureSource {
  readonly apex: Vec3;
  readonly axis: Vec3; // unit, apex → base
  readonly height: number;
  readonly baseRadius: number;
  readonly id: ElementId;

  private readonly cosA: number;
  private readonly sinA: number;
  private readonly tanA: number;
  private readonly slant: number;

  constructor(apex: Vec3, axisVec: Vec3, baseRadius: number, id: ElementId = nextId()) {
    this.apex = apex;
    this.height = length(axisVec);
    this.axis = normalize(axisVec);
    this.baseRadius = baseRadius;
    this.id = id;
    this.slant = Math.hypot(this.height, baseRadius);
    this.cosA = this.height / this.slant;
    this.sinA = baseRadius / this.slant;
    this.tanA = baseRadius / this.height;
  }

  get baseCenter(): Vec3 {
    return addScaled(this.apex, this.axis, this.height);
  }

  bounds(): AABB {
    const P = this.apex;
    const Cb = this.baseCenter;
    const half = (i: number) => this.baseRadius * Math.sqrt(Math.max(0, 1 - this.axis[i]! * this.axis[i]!));
    const min: Vec3 = [0, 1, 2].map((i) => Math.min(P[i]!, Cb[i]! - half(i))) as unknown as Vec3;
    const max: Vec3 = [0, 1, 2].map((i) => Math.max(P[i]!, Cb[i]! + half(i))) as unknown as Vec3;
    return { min, max };
  }

  hatchRegions(cam: Camera, _light: Light): HatchRegion[] {
    // Outline = convex hull of the projected base rim plus the apex (the screen
    // footprint of the convex silhouette); the scene's per-sample surface clip
    // carves the visible surface and shades it by N·L (§2.6).
    const P = projectionMatrix(cam);
    const plane = basisFromNormal(this.baseCenter, this.axis);
    const pts: Vec2[] = [projectPoint(P, this.apex).point];
    for (let i = 0; i < 32; i++) {
      const th = (2 * Math.PI * i) / 32;
      const w: Vec3 = [
        this.baseCenter[0] + this.baseRadius * (Math.cos(th) * plane.x[0] + Math.sin(th) * plane.y[0]),
        this.baseCenter[1] + this.baseRadius * (Math.cos(th) * plane.x[1] + Math.sin(th) * plane.y[1]),
        this.baseCenter[2] + this.baseRadius * (Math.cos(th) * plane.x[2] + Math.sin(th) * plane.y[2]),
      ];
      pts.push(projectPoint(P, w).point);
    }
    const outline = convexHull(pts);
    if (outline.length < 3) return [];
    return [{ owner: this.id, outline: { kind: "polyline", pts: outline }, mode: "single", angle: 0, tone: 0.5 }];
  }

  /** Exact curved direction field (§2.6): circumferential rings + apex generators. */
  hatchField(cam: Camera, opts: HatchFieldOptions): HatchFamily[] {
    const plane = basisFromNormal(this.baseCenter, this.axis);
    const cos2 = this.cosA * this.cosA;
    // outward cone normal at a lateral point p: rel·cos²α − axis·(rel·axis)
    const coneNormal = (p: Vec3): Vec3 => {
      const rel = sub(p, this.apex);
      return sub(addScaled([0, 0, 0], rel, cos2), addScaled([0, 0, 0], this.axis, dot(rel, this.axis)));
    };
    const families: HatchFamily[] = [];

    // Family 0 — circumferential rings; radius grows 0 → R from apex to base,
    // then continues as concentric rings across the base cap (normal = axis), so
    // the field covers the whole surface (an axis-on view still shades the cap).
    const nRings = curveCount(screenDist(cam, this.apex, this.baseCenter), opts.spacingPx, 2, 40);
    const rings = [];
    for (let k = 1; k <= nRings; k++) {
      const frac = k / (nRings + 1);
      const c = addScaled(this.apex, this.axis, frac * this.height);
      rings.push(circleCurve(c, plane.x, plane.y, frac * this.baseRadius, coneNormal, 96));
    }
    const rScreen = screenDist(cam, this.baseCenter, addScaled(this.baseCenter, plane.x, this.baseRadius));
    const nCap = curveCount(rScreen, opts.spacingPx, 2, 24);
    for (let k = 1; k <= nCap; k++) {
      rings.push(circleCurve(this.baseCenter, plane.x, plane.y, (k / (nCap + 1)) * this.baseRadius, () => this.axis, 96));
    }
    families.push({ curves: rings });

    if (opts.maxFamilies >= 2) {
      // Family 1 — straight generators from the apex to the base rim.
      const diam = screenDist(cam, addScaled(this.baseCenter, plane.x, this.baseRadius), addScaled(this.baseCenter, plane.x, -this.baseRadius));
      const nGen = curveCount(Math.PI * diam, opts.spacingPx, 4, 64);
      const gens = [];
      for (let j = 0; j < nGen; j++) {
        const th = (2 * Math.PI * j) / nGen;
        const end = add(this.baseCenter, add(addScaled([0, 0, 0], plane.x, this.baseRadius * Math.cos(th)), addScaled([0, 0, 0], plane.y, this.baseRadius * Math.sin(th))));
        gens.push(segmentCurve(this.apex, end, coneNormal(end), 40));
      }
      families.push({ curves: gens });
    }
    return families;
  }

  extractFeatures(cam: Camera): Feature[] {
    const feats: Feature[] = [];
    const gens = this.silhouetteGenerators(cam);
    for (const end of gens) {
      feats.push({
        type: "silhouette",
        owner: this.id,
        curve: { kind: "line", a: this.apex, b: end },
        attrs: {},
      });
    }
    const plane = basisFromNormal(this.baseCenter, this.axis);
    feats.push({
      type: "boundary",
      owner: this.id,
      curve: { kind: "arc", center: this.baseCenter, radius: this.baseRadius, plane, a0: 0, a1: TWO_PI },
      attrs: {},
    });
    return feats;
  }

  projectedSilhouettes(cam: Camera): Curve2D[] {
    const P = projectionMatrix(cam);
    const out: Curve2D[] = [];
    for (const end of this.silhouetteGenerators(cam)) {
      out.push({ kind: "line", a: projectPoint(P, this.apex).point, b: projectPoint(P, end).point });
    }
    const plane = basisFromNormal(this.baseCenter, this.axis);
    const rim = projectCircle(P, this.baseCenter, this.baseRadius, plane.x, plane.y);
    if (rim) out.push(rim);
    return out;
  }

  /** Closed-form ray–cone hit on the forward nappe within [0,H], plus the base cap. */
  raycast(ray: Ray): Hit[] {
    const { origin: o, dir: d } = ray;
    const a = this.axis;
    const w = sub(o, this.apex);
    const cos2 = this.cosA * this.cosA;

    const dA = dot(d, a);
    const wA = dot(w, a);
    const A = dA * dA - cos2 * dot(d, d);
    const B = 2 * (dA * wA - cos2 * dot(d, w));
    const C = wA * wA - cos2 * dot(w, w);

    const hits: Hit[] = [];
    const ts: number[] = [];
    const roots = solveQuadratic(A, B, C);
    if (roots.kind === "two") ts.push(roots.x0, roots.x1);
    else if (roots.kind === "double") ts.push(roots.x);
    else if (roots.kind === "single") ts.push(roots.x);
    for (const t of ts) {
      const point = addScaled(o, d, t);
      const s = dot(sub(point, this.apex), a); // axial coordinate from apex
      if (s < -EPS_ABS || s > this.height + EPS_ABS) continue; // wrong nappe or past base
      const rel = sub(point, this.apex);
      const n = normalize(sub(addScaled([0, 0, 0], rel, cos2), addScaled([0, 0, 0], a, dot(rel, a))));
      hits.push({ t, point, normal: n, frontFacing: dot(n, d) < 0 });
    }

    // Base cap disk.
    if (Math.abs(dA) > EPS_ABS) {
      const t = (this.height - wA) / dA;
      const point = addScaled(o, d, t);
      const radial = sub(point, this.baseCenter);
      if (dot(radial, radial) <= this.baseRadius * this.baseRadius + EPS_ABS) {
        hits.push({ t, point, normal: a, frontFacing: dot(a, d) < 0 });
      }
    }

    return hits.sort((p, q) => p.t - q.t);
  }

  // --- silhouette geometry -----------------------------------------------

  /** Endpoints (on the base rim) of the two silhouette generators, or [] when
   *  the view is inside the cone's angular cone-of-silhouette (e.g. along axis). */
  private silhouetteGenerators(cam: Camera): Vec3[] {
    const d =
      cam.projection === "perspective" ? sub(cam.eye, this.apex) : cameraFrame(cam).forward;
    const plane = basisFromNormal(this.apex, this.axis);
    const dAxis = dot(d, this.axis);
    const dPerp = sub(d, addScaled([0, 0, 0], this.axis, dAxis));
    const d1 = dot(dPerp, plane.x);
    const d2 = dot(dPerp, plane.y);
    const D = Math.hypot(d1, d2);
    const k = dAxis * this.tanA;
    if (D <= EPS_ABS) return []; // view along axis → silhouette is the base rim
    const ratio = k / D;
    if (Math.abs(ratio) > 1) return []; // no real generator (looking into the cone)
    const phi = Math.atan2(d2, d1);
    const delta = Math.acos(Math.max(-1, Math.min(1, ratio)));

    const endpointFor = (psi: number): Vec3 => {
      const m = add(
        addScaled([0, 0, 0], plane.x, Math.cos(psi)),
        addScaled([0, 0, 0], plane.y, Math.sin(psi)),
      );
      const g = add(addScaled([0, 0, 0], this.axis, this.cosA), addScaled([0, 0, 0], m, this.sinA));
      return addScaled(this.apex, g, this.slant); // apex + slant·g lands on the base rim
    };
    return [endpointFor(phi + delta), endpointFor(phi - delta)];
  }
}
