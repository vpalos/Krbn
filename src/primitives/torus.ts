// Torus — the one Phase-1 primitive that is not a quadric (ai/DESIGN.md §2.3).
// Its silhouette is a quartic image curve, so there is no conic shortcut: the
// contour generator is extracted numerically from the implicit form, and
// ray-torus intersection is a genuine quartic.
//
// Local frame: â = z, with ê1, ê2 spanning the plane ⟂ â. A surface point is
//     p(u,v) = c + (R + r·cos v)·radial(u) + r·sin v·â,   radial(u)=cos u·ê1+sin u·ê2
// and its outward normal is  n(u,v) = cos v·radial(u) + sin v·â. The silhouette
// is where n·d = 0 (d = view direction): for each toroidal angle u we solve for
// the poloidal angles v (2 for ortho, up to 4 for perspective), giving points on
// the contour generator, which we chain into loops.

import type { AABB, Basis, Camera, Hit, Ray, Vec2, Vec3 } from "../math/types.js";
import type { Curve2D } from "../curve/types.js";
import type { ElementId, Feature, HatchFamily, HatchFieldOptions, HatchRegion, Light } from "../pipeline/types.js";
import type { FeatureSource } from "../scene/feature-source.js";
import { basisFromNormal } from "../math/basis.js";
import { addScaled, dot, normalize, sub } from "../math/vec3.js";
import { cameraFrame, projectionMatrix, projectPoint } from "../math/camera.js";
import { circleCurve, dyadicLadder, paramCurve, screenDist, tagCurve } from "./hatch-field.js";
import { solveQuarticReal } from "../curve/roots.js";
import { chainPoints } from "../curve/chain.js";
import { EPS_ABS } from "../curve/epsilon.js";

let autoId = 0;
const nextId = (): ElementId => `torus-${autoId++}`;

const TWO_PI = Math.PI * 2;

/** Keep roughly `target` evenly-spaced points (a coarse polygon for clipping). */
function decimate(pts: Vec2[], target: number): Vec2[] {
  if (pts.length <= target) return pts;
  const step = Math.ceil(pts.length / target);
  return pts.filter((_, i) => i % step === 0);
}

export class Torus implements FeatureSource {
  readonly center: Vec3;
  readonly axis: Vec3; // unit
  readonly majorRadius: number; // R: centre → tube centre
  readonly minorRadius: number; // r: tube radius
  readonly id: ElementId;
  private readonly frame: Basis;

  constructor(center: Vec3, axisVec: Vec3, majorRadius: number, minorRadius: number, id: ElementId = nextId()) {
    this.center = center;
    this.axis = normalize(axisVec);
    this.majorRadius = majorRadius;
    this.minorRadius = minorRadius;
    this.id = id;
    this.frame = basisFromNormal(center, this.axis);
  }

  bounds(): AABB {
    const R = this.majorRadius;
    const r = this.minorRadius;
    const a = this.axis;
    const half = (i: number) => (R + r) * Math.sqrt(Math.max(0, 1 - a[i]! * a[i]!)) + r * Math.abs(a[i]!);
    const c = this.center;
    return {
      min: [c[0] - half(0), c[1] - half(1), c[2] - half(2)],
      max: [c[0] + half(0), c[1] + half(1), c[2] + half(2)],
    };
  }

  hatchRegions(cam: Camera, _light: Light): HatchRegion[] {
    // Footprint = the annulus between the two silhouette loops (outer outline
    // minus the hole). Kept as the straight-hatch fallback; the scene prefers the
    // exact toroidal/poloidal direction field from `hatchField` when hatching.
    const loops = this.silhouetteLoops(cam);
    if (loops.length === 0) return [];
    const P = projectionMatrix(cam);
    // coarser loops are plenty for polygon clipping
    const projected = loops.map((loop) => decimate(loop.map((p) => projectPoint(P, p).point), 160));
    const bboxArea = (pts: Vec2[]) => {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const [x, y] of pts) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
      return (maxX - minX) * (maxY - minY);
    };
    projected.sort((a, b) => bboxArea(b) - bboxArea(a)); // outer (largest) first
    const outer = projected[0]!;
    if (outer.length < 3) return [];
    const holes: Curve2D[] = projected.slice(1).filter((h) => h.length >= 3).map((pts) => ({ kind: "polyline", pts }));
    return [{ owner: this.id, outline: { kind: "polyline", pts: outer }, holes, mode: "single", angle: 0, tone: 0.5 }];
  }

  /** Exact curved direction field (§2.6): poloidal (tube) + toroidal circles
   *  (+ (1,1) diagonal loops as the third family for `triple`). */
  hatchField(cam: Camera, opts: HatchFieldOptions): HatchFamily[] {
    const c = this.center;
    const R = this.majorRadius;
    const r = this.minorRadius;
    const { x: e1, y: e2, z: a } = this.frame;
    // outward torus normal at any surface point: p − (its nearest tube-centre).
    const torusNormal = (p: Vec3): Vec3 => {
      const rel = sub(p, c);
      const inPlane = sub(rel, addScaled([0, 0, 0], a, dot(rel, a)));
      const rad = normalize(inPlane);
      return sub(p, addScaled(c, rad, R));
    };
    const radial = (u: number): Vec3 => addScaled(addScaled([0, 0, 0], e1, Math.cos(u)), e2, Math.sin(u));
    const families: HatchFamily[] = [];

    // Family 0 — poloidal circles (tube cross-sections, one per toroidal angle u).
    // Iso-values sit on a dyadic ladder (temporal coherence): a density change
    // adds or removes complete levels, never moving existing curves.
    const spacing = Math.max(1, opts.spacingPx);
    const majDiam = screenDist(cam, addScaled(c, e1, R), addScaled(c, e1, -R));
    const poloidal = [];
    for (const s of dyadicLadder((Math.PI * majDiam) / spacing, { periodic: true, min: 8, max: 72 })) {
      const rad = radial(TWO_PI * s.t);
      poloidal.push(tagCurve(circleCurve(addScaled(c, rad, R), rad, a, r, torusNormal, 48), `p:${s.key}`));
    }
    families.push({ curves: poloidal });

    if (opts.maxFamilies >= 2) {
      // Family 1 — toroidal circles (around the axis, one per poloidal angle v).
      const minDiam = screenDist(cam, addScaled(c, e1, R + r), addScaled(c, e1, R - r));
      const toroidal = [];
      for (const s of dyadicLadder((Math.PI * minDiam) / spacing, { periodic: true, min: 4, max: 48 })) {
        const v = TWO_PI * s.t;
        const center = addScaled(c, a, r * Math.sin(v));
        toroidal.push(tagCurve(circleCurve(center, e1, e2, R + r * Math.cos(v), torusNormal, 96), `t:${s.key}`));
      }
      families.push({ curves: toroidal });
    }

    if (opts.maxFamilies >= 3) {
      // Family 2 — (1,1) diagonal loops: u and v advance together through one
      // full turn (u = u0 + 2πt, v = 2πt), the diagonal iso-curves of the
      // (u, v) chart. Each closes after winding once around the axis and once
      // around the tube, crossing both circle families obliquely — the darkest
      // `triple` band. Normal is the exact closed form cos v·radial(u) + sin v·â.
      const diagonal = [];
      for (const s of dyadicLadder((Math.PI * majDiam) / Math.SQRT2 / spacing, { periodic: true, min: 6, max: 64 })) {
        const u0 = TWO_PI * s.t;
        diagonal.push(
          tagCurve(
            paramCurve((t) => {
              const u = u0 + TWO_PI * t;
              const v = TWO_PI * t;
              const rad = radial(u);
              const p = addScaled(addScaled(c, rad, R + r * Math.cos(v)), a, r * Math.sin(v));
              const n = addScaled(addScaled([0, 0, 0], rad, Math.cos(v)), a, Math.sin(v));
              return { p, n };
            }, 128),
            `d:${s.key}`,
            
          ),
        );
      }
      families.push({ curves: diagonal });
    }
    return families;
  }

  extractFeatures(cam: Camera): Feature[] {
    return this.silhouetteLoops(cam).map((loop) => ({
      type: "silhouette" as const,
      owner: this.id,
      curve: { kind: "polyline" as const, pts: loop },
      attrs: {},
    }));
  }

  projectedSilhouettes(cam: Camera): Curve2D[] {
    const P = projectionMatrix(cam);
    return this.silhouetteLoops(cam).map((loop) => ({
      kind: "polyline" as const,
      pts: loop.map((p) => projectPoint(P, p).point),
    }));
  }

  /** Closed-form ray–torus: a quartic in t (ai/DESIGN.md §2.3). */
  raycast(ray: Ray): Hit[] {
    const { x: e1, y: e2, z: e3 } = this.frame;
    const oc = sub(ray.origin, this.center);
    // ray in the torus-local (axis-aligned) frame
    const o: Vec3 = [dot(oc, e1), dot(oc, e2), dot(oc, e3)];
    const d: Vec3 = [dot(ray.dir, e1), dot(ray.dir, e2), dot(ray.dir, e3)];
    const R = this.majorRadius;
    const r = this.minorRadius;
    const K = R * R - r * r;

    const alpha = dot(d, d);
    const beta = 2 * dot(o, d);
    const gamma = dot(o, o);
    const c4 = alpha * alpha;
    const c3 = 2 * alpha * beta;
    const c2 = beta * beta + 2 * alpha * gamma + 2 * (K - 2 * R * R) * alpha + 4 * R * R * d[2] * d[2];
    const c1 = 2 * beta * gamma + 2 * (K - 2 * R * R) * beta + 8 * R * R * o[2] * d[2];
    const c0 = gamma * gamma + 2 * (K - 2 * R * R) * gamma + K * K + 4 * R * R * o[2] * o[2];

    const hits: Hit[] = [];
    for (const t of solveQuarticReal(c4, c3, c2, c1, c0)) {
      const point: Vec3 = [ray.origin[0] + t * ray.dir[0], ray.origin[1] + t * ray.dir[1], ray.origin[2] + t * ray.dir[2]];
      const lp: Vec3 = [o[0] + t * d[0], o[1] + t * d[1], o[2] + t * d[2]];
      const rho = Math.hypot(lp[0], lp[1]);
      // outward normal: local point minus the nearest tube-centre point (R·radial)
      const k = rho > EPS_ABS ? 1 - R / rho : 1;
      const nLocal: Vec3 = [lp[0] * k, lp[1] * k, lp[2]];
      const n = normalize([
        nLocal[0] * e1[0] + nLocal[1] * e2[0] + nLocal[2] * e3[0],
        nLocal[0] * e1[1] + nLocal[1] * e2[1] + nLocal[2] * e3[1],
        nLocal[0] * e1[2] + nLocal[1] * e2[2] + nLocal[2] * e3[2],
      ]);
      hits.push({ t, point, normal: n, frontFacing: dot(n, ray.dir) < 0 });
    }
    return hits.sort((p, q) => p.t - q.t);
  }

  // --- silhouette --------------------------------------------------------

  private silhouetteLoops(cam: Camera): Vec3[][] {
    const { x: e1, y: e2, z: a } = this.frame;
    const R = this.majorRadius;
    const r = this.minorRadius;
    const persp = cam.projection === "perspective";
    const forward = cameraFrame(cam).forward;

    const point = (radial: Vec3, v: number): Vec3 => {
      const cr = R + r * Math.cos(v);
      const sv = r * Math.sin(v);
      return [
        this.center[0] + cr * radial[0] + sv * a[0],
        this.center[1] + cr * radial[1] + sv * a[1],
        this.center[2] + cr * radial[2] + sv * a[2],
      ];
    };
    // n·d at (radial, v)
    const g = (radial: Vec3, v: number): number => {
      const n: Vec3 = [
        Math.cos(v) * radial[0] + Math.sin(v) * a[0],
        Math.cos(v) * radial[1] + Math.sin(v) * a[1],
        Math.cos(v) * radial[2] + Math.sin(v) * a[2],
      ];
      const p = point(radial, v);
      const d = persp ? sub(p, cam.eye) : forward;
      return dot(n, d);
    };

    // Dense in u so the chord between consecutive silhouette points dips inside
    // the true outline by less than the occlusion nudge (otherwise interpolated
    // points on a grazing silhouette read as self-occluded).
    const U = 720;
    const V = 64;
    const pts: Vec3[] = [];
    for (let i = 0; i < U; i++) {
      const u = (TWO_PI * i) / U;
      const radial: Vec3 = [
        Math.cos(u) * e1[0] + Math.sin(u) * e2[0],
        Math.cos(u) * e1[1] + Math.sin(u) * e2[1],
        Math.cos(u) * e1[2] + Math.sin(u) * e2[2],
      ];
      let prevV = 0;
      let prevG = g(radial, 0);
      for (let j = 1; j <= V; j++) {
        const v = (TWO_PI * j) / V;
        const cur = g(radial, v);
        if (prevG === 0 || (prevG < 0) !== (cur < 0)) {
          // bisect the sign change to a precise poloidal angle
          let lo = prevV;
          let hi = v;
          let glo = prevG;
          for (let k = 0; k < 24; k++) {
            const mid = 0.5 * (lo + hi);
            const gm = g(radial, mid);
            if ((glo < 0) === (gm < 0)) {
              lo = mid;
              glo = gm;
            } else hi = mid;
          }
          pts.push(point(radial, 0.5 * (lo + hi)));
        }
        prevV = v;
        prevG = cur;
      }
    }
    return chainPoints(pts, { gapFactor: 6 });
  }
}
