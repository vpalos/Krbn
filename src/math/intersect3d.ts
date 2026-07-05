// Small ray/plane/line intersection helpers used by the visibility stage to map
// a screen-space crossing point back onto a feature's 3-D supporting geometry
// (exact parameter recovery — no screen-space parameter guessing under
// perspective, where the projected parameter is non-affine).

import type { Ray, Vec3 } from "./types.js";
import { dot, sub } from "./vec3.js";
import { EPS_ABS } from "../curve/epsilon.js";

/** Parameter t where a ray meets a plane (origin + normal), or null if parallel. */
export function rayPlaneT(ray: Ray, planeOrigin: Vec3, planeNormal: Vec3): number | null {
  const denom = dot(ray.dir, planeNormal);
  if (Math.abs(denom) <= EPS_ABS) return null;
  return dot(sub(planeOrigin, ray.origin), planeNormal) / denom;
}

/** Point where a ray meets a plane, or null if parallel. */
export function rayPlanePoint(ray: Ray, planeOrigin: Vec3, planeNormal: Vec3): Vec3 | null {
  const t = rayPlaneT(ray, planeOrigin, planeNormal);
  if (t === null) return null;
  return [ray.origin[0] + t * ray.dir[0], ray.origin[1] + t * ray.dir[1], ray.origin[2] + t * ray.dir[2]];
}

/**
 * Parameter u along segment/line a + u·(b−a) at the point of closest approach to
 * a ray. When the ray is the projection of an actual point on the line the two
 * meet and this is exact; `residual` is their distance (near 0 for a true hit).
 */
export function rayLineClosestU(
  ray: Ray,
  a: Vec3,
  b: Vec3,
): { u: number; residual: number } | null {
  const e = sub(b, a);
  const d = ray.dir;
  const w0 = sub(ray.origin, a);
  const ee = dot(e, e);
  const dd = dot(d, d);
  const ed = dot(e, d);
  const G = ee * dd - ed * ed;
  if (Math.abs(G) <= EPS_ABS) return null; // ray parallel to the line
  const ew0 = dot(e, w0);
  const dw0 = dot(d, w0);
  const u = (ew0 * dd - ed * dw0) / G;
  const s = (ee * dw0 - ed * ew0) / G;
  const lp: Vec3 = [a[0] + u * e[0], a[1] + u * e[1], a[2] + u * e[2]];
  const rp: Vec3 = [ray.origin[0] + s * d[0], ray.origin[1] + s * d[1], ray.origin[2] + s * d[2]];
  const residual = Math.hypot(lp[0] - rp[0], lp[1] - rp[1], lp[2] - rp[2]);
  return { u, residual };
}
