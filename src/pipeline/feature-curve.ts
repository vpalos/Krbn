// A per-frame model of one feature curve for the visibility stage: its domain,
// its 3-D point at a parameter, its projected screen curve (for crossings), and
// an *exact* inverse — the feature parameter at a given screen point, recovered
// by back-projecting the viewing ray onto the curve's supporting geometry.
//
// Recovering the parameter geometrically (not by interpolating screen distance)
// is what keeps QI exact under perspective, where a line's 3-D parameter maps to
// screen position through a non-affine projective function (ai/DESIGN.md §2.4).

import type { Camera, Vec2, Vec3 } from "../math/types.js";
import type { Curve } from "../curve/types.js";
import { projectionMatrix, projectPoint, unproject, type Proj } from "../math/camera.js";
import { rayLineClosestU, rayPlanePoint } from "../math/intersect3d.js";
import { planeToScreenHomography, screenConicFromPlaneConic, projectCircle } from "../math/project.js";
import { conicToMatrix, evaluateConic } from "../curve/conic.js";
import { deCasteljau, adaptiveSample } from "../curve/sample.js";
import { toPlaneCoords } from "../math/basis.js";
import { EPS_ANGLE, EPS_DENOM, EPS_ONCURVE } from "../curve/epsilon.js";
import type { Curve2D } from "../curve/types.js";

export interface FeatureCurveModel {
  t0: number;
  t1: number;
  closed: boolean;
  /** 3-D point at parameter t (t in [t0, t1]). */
  point3(t: number): Vec3;
  /** projected screen curve, for computing crossings with occluder silhouettes */
  screen: Curve2D;
  /** feature parameter at a screen point, or null if it does not fall on the curve */
  paramOf(pt: Vec2): number | null;
}

const SAMPLE_FALLBACK = 96;

/** Sample point3 over [t0,t1] and project — a robust screen curve when the exact
 *  analytic projection degenerates (e.g. a circle seen edge-on). */
function sampledScreen(P: Proj, point3: (t: number) => Vec3, t0: number, t1: number): Curve2D {
  const pts: Vec2[] = [];
  for (let i = 0; i <= SAMPLE_FALLBACK; i++) pts.push(projectPoint(P, point3(t0 + ((t1 - t0) * i) / SAMPLE_FALLBACK)).point);
  return { kind: "polyline", pts };
}

export function buildFeatureModel(curve: Curve, cam: Camera): FeatureCurveModel {
  const P = projectionMatrix(cam);

  switch (curve.kind) {
    case "line": {
      const { a, b } = curve;
      const point3 = (t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
      return {
        t0: 0,
        t1: 1,
        closed: false,
        point3,
        screen: { kind: "line", a: projectPoint(P, a).point, b: projectPoint(P, b).point },
        paramOf: (pt) => {
          const hit = rayLineClosestU(unproject(cam, pt), a, b);
          if (!hit) return null;
          return hit.u;
        },
      };
    }

    case "arc": {
      const { center, radius, plane, a0, a1 } = curve;
      const point3 = (t: number): Vec3 => [
        center[0] + radius * (Math.cos(t) * plane.x[0] + Math.sin(t) * plane.y[0]),
        center[1] + radius * (Math.cos(t) * plane.x[1] + Math.sin(t) * plane.y[1]),
        center[2] + radius * (Math.cos(t) * plane.x[2] + Math.sin(t) * plane.y[2]),
      ];
      const exact = projectCircle(P, center, radius, plane.x, plane.y);
      return {
        t0: a0,
        t1: a1,
        closed: a1 - a0 >= 2 * Math.PI - EPS_ANGLE,
        point3,
        screen: exact ?? sampledScreen(P, point3, a0, a1),
        paramOf: (pt) => {
          const wp = rayPlanePoint(unproject(cam, pt), center, plane.z);
          if (!wp) return null;
          const [u, v] = toPlaneCoords(plane, wp);
          let theta = Math.atan2(v, u);
          // bring into [a0, a1]
          while (theta < a0 - EPS_ANGLE) theta += 2 * Math.PI;
          while (theta > a1 + EPS_ANGLE) theta -= 2 * Math.PI;
          return theta;
        },
      };
    }

    case "conic": {
      const { params, plane } = curve;
      const det = 4 * params.A * params.C - params.B * params.B;
      const cx = Math.abs(det) > EPS_DENOM ? (-2 * params.C * params.D + params.B * params.E) / det : 0;
      const cy = Math.abs(det) > EPS_DENOM ? (-2 * params.A * params.E + params.B * params.D) / det : 0;
      const Fc = evaluateConic(params, cx, cy); // value at the conic centre (< 0 inside an ellipse)
      const point3 = (theta: number): Vec3 => {
        const c = Math.cos(theta);
        const s = Math.sin(theta);
        const form = params.A * c * c + params.B * c * s + params.C * s * s;
        const ratio = Math.abs(form) > EPS_DENOM ? -Fc / form : 0; // sign-invariant
        const rho = ratio > 0 ? Math.sqrt(ratio) : 0;
        const u = cx + rho * c;
        const v = cy + rho * s;
        return [
          plane.origin[0] + u * plane.x[0] + v * plane.y[0],
          plane.origin[1] + u * plane.x[1] + v * plane.y[1],
          plane.origin[2] + u * plane.x[2] + v * plane.y[2],
        ];
      };
      const H = planeToScreenHomography(P, plane.x, plane.y, plane.origin);
      const exact = screenConicFromPlaneConic(H, conicToMatrix(params));
      return {
        t0: -Math.PI,
        t1: Math.PI,
        closed: true,
        point3,
        screen: exact ?? sampledScreen(P, point3, -Math.PI, Math.PI),
        paramOf: (pt) => {
          const wp = rayPlanePoint(unproject(cam, pt), plane.origin, plane.z);
          if (!wp) return null;
          const [u, v] = toPlaneCoords(plane, wp);
          return Math.atan2(v - cy, u - cx);
        },
      };
    }

    case "bezier": {
      // No exact screen carrier — sample to a polyline (this is the sanctioned
      // exception for genuinely free curves, ai/DESIGN.md §2.3) and reuse the
      // polyline model.
      const project = (p: Vec3): Vec2 => projectPoint(P, p).point;
      const { points } = adaptiveSample((t) => deCasteljau(curve.pts, t), 0, 1, project, {
        tolerancePx: 0.3,
        maxDepth: 18,
      });
      return buildPolylineModel(points, cam, P);
    }

    case "polyline":
      return buildPolylineModel(curve.pts, cam, P);
  }
}

function buildPolylineModel(pts: readonly Vec3[], cam: Camera, P: Proj): FeatureCurveModel {
  const n = pts.length - 1;
  const point3 = (t: number): Vec3 => {
    const clamped = Math.max(0, Math.min(n, t));
    const i = Math.min(n - 1, Math.floor(clamped));
    const local = clamped - i;
    const a = pts[i]!;
    const b = pts[i + 1]!;
    return [a[0] + (b[0] - a[0]) * local, a[1] + (b[1] - a[1]) * local, a[2] + (b[2] - a[2]) * local];
  };
  return {
    t0: 0,
    t1: n,
    closed: false,
    point3,
    screen: { kind: "polyline", pts: pts.map((p) => projectPoint(P, p).point) },
    paramOf: (pt) => {
      const ray = unproject(cam, pt);
      let best: { t: number; residual: number } | null = null;
      for (let i = 0; i < n; i++) {
        const hit = rayLineClosestU(ray, pts[i]!, pts[i + 1]!);
        if (!hit || hit.u < -EPS_ONCURVE || hit.u > 1 + EPS_ONCURVE) continue;
        if (!best || hit.residual < best.residual) best = { t: i + Math.max(0, Math.min(1, hit.u)), residual: hit.residual };
      }
      return best ? best.t : null;
    },
  };
}
