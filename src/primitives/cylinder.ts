// Finite circular cylinder — a quadric configuration (ai/DESIGN.md §2.3).
//
// Silhouette = two rulings (lines parallel to the axis) + the two rim circles.
// The rulings are exact: for an orthographic view direction v the tangent
// offset is r·normalize(â × v); for a perspective eye they pass through the two
// tangent points from the eye to the base circle. The back half is
// self-occluded — that is the visibility stage's job (step 5), not here.

import type { AABB, Camera, Hit, Ray, Vec2, Vec3 } from "../math/types.js";
import type { Curve2D } from "../curve/types.js";
import type { ElementId, Feature, HatchFamily, HatchFieldOptions, HatchRegion, Light } from "../pipeline/types.js";
import type { FeatureSource } from "../scene/feature-source.js";
import { basisFromNormal } from "../math/basis.js";
import { add, addScaled, cross, dot, length, normalize, sub } from "../math/vec3.js";
import { cameraFrame, projectionMatrix, projectPoint } from "../math/camera.js";
import { projectCircle } from "../math/project.js";
import { convexHull } from "../math/hull.js";
import { circleCurve, curveCount, paramCurve, screenDist, segmentCurve } from "./hatch-field.js";
import { solveQuadratic } from "../curve/roots.js";
import { EPS_ABS, EPS_REL } from "../curve/epsilon.js";

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

  hatchRegions(cam: Camera, _light: Light): HatchRegion[] {
    // Outline = convex hull of the two projected rim ellipses (the exact screen
    // footprint of the convex silhouette). The scene's per-sample surface clip
    // then carves the visible surface and shades it by N·L (§2.6).
    const P = projectionMatrix(cam);
    const plane = basisFromNormal(this.base, this.axis);
    const pts: Vec2[] = [];
    for (const c of [this.base, this.top]) {
      for (let i = 0; i < 32; i++) {
        const th = (2 * Math.PI * i) / 32;
        const w: Vec3 = [
          c[0] + this.radius * (Math.cos(th) * plane.x[0] + Math.sin(th) * plane.y[0]),
          c[1] + this.radius * (Math.cos(th) * plane.x[1] + Math.sin(th) * plane.y[1]),
          c[2] + this.radius * (Math.cos(th) * plane.x[2] + Math.sin(th) * plane.y[2]),
        ];
        pts.push(projectPoint(P, w).point);
      }
    }
    const outline = convexHull(pts);
    if (outline.length < 3) return [];
    return [{ owner: this.id, outline: { kind: "polyline", pts: outline }, mode: "single", angle: 0, tone: 0.5 }];
  }

  /** Exact curved direction field (§2.6): circumferential rings + axial rulings
   *  (+ 45° helices as the diagonal third family for `triple`). */
  hatchField(cam: Camera, opts: HatchFieldOptions): HatchFamily[] {
    const plane = basisFromNormal(this.base, this.axis);
    const top = this.top;
    const diam = screenDist(cam, addScaled(this.base, plane.x, this.radius), addScaled(this.base, plane.x, -this.radius));
    const families: HatchFamily[] = [];

    // Family 0 — circumferential rings (constant height); normal is radial. The
    // two end caps get concentric rings too (normal ±axis), so the field covers
    // the whole surface (an axis-on view still shades the visible cap).
    const nRings = curveCount(screenDist(cam, this.base, top), opts.spacingPx, 2, 40);
    const rings = [];
    for (let k = 0; k < nRings; k++) {
      const s = ((k + 0.5) / nRings) * this.height;
      const c = addScaled(this.base, this.axis, s);
      rings.push(circleCurve(c, plane.x, plane.y, this.radius, (p) => sub(p, c), 96));
    }
    const rScreen = screenDist(cam, this.base, addScaled(this.base, plane.x, this.radius));
    const nCap = curveCount(rScreen, opts.spacingPx, 2, 24);
    for (const [c, sign] of [[this.base, -1], [top, 1]] as const) {
      const nrm: Vec3 = [sign * this.axis[0], sign * this.axis[1], sign * this.axis[2]];
      for (let k = 1; k <= nCap; k++) {
        rings.push(circleCurve(c, plane.x, plane.y, (k / (nCap + 1)) * this.radius, () => nrm, 96));
      }
    }
    families.push({ curves: rings });

    if (opts.maxFamilies >= 2) {
      // Family 1 — axial rulings (constant angle); normal is the radial offset dir.
      const nRul = curveCount(Math.PI * diam, opts.spacingPx, 4, 64);
      const rulings = [];
      for (let j = 0; j < nRul; j++) {
        const th = (2 * Math.PI * j) / nRul;
        const off = add(addScaled([0, 0, 0], plane.x, this.radius * Math.cos(th)), addScaled([0, 0, 0], plane.y, this.radius * Math.sin(th)));
        rulings.push(segmentCurve(add(this.base, off), add(top, off), off, 40));
      }
      families.push({ curves: rulings });
    }

    if (opts.maxFamilies >= 3) {
      // Family 2 — 45° helices, the diagonal iso-curves of the (θ, z) chart: on
      // the unrolled lateral surface z = r·(θ − θ0), so each helix crosses the
      // rings and rulings at 45° and the darkest `triple` band still follows
      // curvature. Adjacent helices sit 2πr/n apart along the circumference,
      // i.e. (2πr/n)/√2 apart perpendicular to the stroke — hence the /√2.
      const dTheta = this.height / this.radius; // winding angle base → top
      const nHel = curveCount((Math.PI * diam) / Math.SQRT2, opts.spacingPx, 4, 64);
      const segs = Math.max(24, Math.ceil((dTheta / TWO_PI) * 96));
      const helices = [];
      for (let j = 0; j < nHel; j++) {
        const th0 = (TWO_PI * j) / nHel;
        helices.push(
          paramCurve((t) => {
            const th = th0 + t * dTheta;
            const off = add(addScaled([0, 0, 0], plane.x, this.radius * Math.cos(th)), addScaled([0, 0, 0], plane.y, this.radius * Math.sin(th)));
            return { p: add(addScaled(this.base, this.axis, t * this.height), off), n: off };
          }, segs),
        );
      }
      families.push({ curves: helices });
    }
    return families;
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
      if (length(axb) <= EPS_REL) return null; // view ∥ axis
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
