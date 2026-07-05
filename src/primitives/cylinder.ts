// Finite circular cylinder — a quadric configuration (ai/DESIGN.md §2.3).
//
// Silhouette = two rulings (lines parallel to the axis) + the two rim circles.
// The rulings are exact: for an orthographic view direction v the tangent
// offset is r·normalize(â × v); for a perspective eye they pass through the two
// tangent points from the eye to the base circle. The back half is
// self-occluded — that is the visibility stage's job (step 5), not here.

import type { AABB, Camera, Hit, Ray, Vec3 } from "../math/types.js";
import type { Curve2D } from "../curve/types.js";
import type { ElementId, Feature, HatchRegion, Light } from "../pipeline/types.js";
import type { FeatureSource } from "../scene/feature-source.js";
import { basisFromNormal } from "../math/basis.js";
import { add, addScaled, cross, dot, length, normalize, sub } from "../math/vec3.js";
import { cameraFrame, projectionMatrix, projectPoint } from "../math/camera.js";
import { projectCircle } from "../math/project.js";
import { solveQuadratic } from "../curve/roots.js";
import { EPS_ABS } from "../curve/epsilon.js";

let autoId = 0;
const nextId = (): ElementId => `cylinder-${autoId++}`;

const TWO_PI = Math.PI * 2;

export class Cylinder implements FeatureSource {
  readonly base: Vec3; // center of the base cap
  readonly axis: Vec3; // unit axis, base → top
  readonly height: number;
  readonly radius: number;
  readonly id: ElementId;

  constructor(base: Vec3, axisVec: Vec3, radius: number, id: ElementId = nextId()) {
    this.base = base;
    this.height = length(axisVec);
    this.axis = normalize(axisVec);
    this.radius = radius;
    this.id = id;
  }

  private get top(): Vec3 {
    return addScaled(this.base, this.axis, this.height);
  }

  bounds(): AABB {
    const c0 = this.base;
    const c1 = this.top;
    const half = (i: number) => this.radius * Math.sqrt(Math.max(0, 1 - this.axis[i]! * this.axis[i]!));
    const min: Vec3 = [0, 0, 0].map((_, i) => Math.min(c0[i]!, c1[i]!) - half(i)) as unknown as Vec3;
    const max: Vec3 = [0, 0, 0].map((_, i) => Math.max(c0[i]!, c1[i]!) + half(i)) as unknown as Vec3;
    return { min, max };
  }

  hatchRegions(_cam: Camera, _light: Light): HatchRegion[] {
    return [];
  }

  extractFeatures(cam: Camera): Feature[] {
    const feats: Feature[] = [];
    const basePts = this.silhouetteBasePoints(cam);
    if (basePts) {
      for (const p of basePts) {
        feats.push({
          type: "silhouette",
          owner: this.id,
          curve: { kind: "line", a: p, b: addScaled(p, this.axis, this.height) },
          attrs: {},
        });
      }
    }
    // Rim circles as boundary features (open edges of the finite surface).
    for (const c of [this.base, this.top]) {
      const plane = basisFromNormal(c, this.axis);
      feats.push({
        type: "boundary",
        owner: this.id,
        curve: { kind: "arc", center: c, radius: this.radius, plane, a0: 0, a1: TWO_PI },
        attrs: {},
      });
    }
    return feats;
  }

  projectedSilhouettes(cam: Camera): Curve2D[] {
    const P = projectionMatrix(cam);
    const out: Curve2D[] = [];
    const basePts = this.silhouetteBasePoints(cam);
    if (basePts) {
      for (const p of basePts) {
        out.push({
          kind: "line",
          a: projectPoint(P, p).point,
          b: projectPoint(P, addScaled(p, this.axis, this.height)).point,
        });
      }
    }
    // Rim ellipses (exact projected circles) as crossing-event curves.
    const plane = basisFromNormal(this.base, this.axis);
    for (const c of [this.base, this.top]) {
      const conic = projectCircle(P, c, this.radius, plane.x, plane.y);
      if (conic) out.push(conic);
    }
    return out;
  }

  /** Finite-solid raycast: lateral surface clipped to [0,h] plus the two caps. */
  raycast(ray: Ray): Hit[] {
    const { origin: o, dir: d } = ray;
    const a = this.axis;
    const oc = sub(o, this.base);
    const dDotA = dot(d, a);
    const ocDotA = dot(oc, a);
    const dPerp = sub(d, addScaled([0, 0, 0], a, dDotA));
    const ocPerp = sub(oc, addScaled([0, 0, 0], a, ocDotA));

    const hits: Hit[] = [];

    // Lateral surface: |ocPerp + t·dPerp|² = r².
    const qa = dot(dPerp, dPerp);
    const qb = 2 * dot(ocPerp, dPerp);
    const qc = dot(ocPerp, ocPerp) - this.radius * this.radius;
    const ts: number[] = [];
    const roots = solveQuadratic(qa, qb, qc);
    if (roots.kind === "two") ts.push(roots.x0, roots.x1);
    else if (roots.kind === "double") ts.push(roots.x);
    else if (roots.kind === "single") ts.push(roots.x);
    for (const t of ts) {
      const s = ocDotA + t * dDotA; // axial coordinate
      if (s < -EPS_ABS || s > this.height + EPS_ABS) continue;
      const point = addScaled(o, d, t);
      const radial = sub(point, addScaled(this.base, a, s));
      const n = normalize(radial);
      hits.push({ t, point, normal: n, frontFacing: dot(n, d) < 0 });
    }

    // Caps at s = 0 and s = h.
    if (Math.abs(dDotA) > EPS_ABS) {
      for (const [s, capCenter, capNormal] of [
        [0, this.base, [-a[0], -a[1], -a[2]] as Vec3],
        [this.height, this.top, a],
      ] as const) {
        const t = (s - ocDotA) / dDotA;
        const point = addScaled(o, d, t);
        const radial = sub(point, capCenter);
        if (dot(radial, radial) <= this.radius * this.radius + EPS_ABS) {
          const n = capNormal;
          hits.push({ t, point, normal: n, frontFacing: dot(n, d) < 0 });
        }
      }
    }

    return hits.sort((p, q) => p.t - q.t);
  }

  // --- silhouette geometry -----------------------------------------------

  /** The two points on the base rim where the silhouette rulings start, or null
   *  when the view is along the axis (silhouette degenerates to the rim). */
  private silhouetteBasePoints(cam: Camera): [Vec3, Vec3] | null {
    const plane = basisFromNormal(this.base, this.axis);
    if (cam.projection === "orthographic") {
      const v = cameraFrame(cam).forward;
      const axb = cross(this.axis, v);
      if (length(axb) <= 1e-9) return null; // view ∥ axis
      const u = normalize(axb);
      return [addScaled(this.base, u, this.radius), addScaled(this.base, u, -this.radius)];
    }
    // Perspective: tangent points from the eye projected into the base plane.
    const eyeRel = sub(cam.eye, this.base);
    const ex = dot(eyeRel, plane.x);
    const ey = dot(eyeRel, plane.y);
    const dist = Math.hypot(ex, ey);
    if (dist <= this.radius) return null; // eye inside the cylinder radius
    const phi0 = Math.atan2(ey, ex);
    const alpha = Math.acos(this.radius / dist);
    const at = (phi: number): Vec3 =>
      add(this.base, add(addScaled([0, 0, 0], plane.x, this.radius * Math.cos(phi)), addScaled([0, 0, 0], plane.y, this.radius * Math.sin(phi))));
    return [at(phi0 + alpha), at(phi0 - alpha)];
  }
}
