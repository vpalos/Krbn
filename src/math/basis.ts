// Orthonormal frame helpers. A `Basis` doubles as a plane description
// (origin + z normal) and as the local frame an `arc`/`conic` curve lives in.

import type { Basis, Vec3 } from "./types.js";
import { anyPerpendicular, cross, normalize, sub, dot, addScaled } from "./vec3.js";

/**
 * Build a right-handed orthonormal basis at `origin` whose z axis is `normal`.
 * The in-plane x/y axes are chosen deterministically (stable across frames, so
 * seeded wobble and arc parametrization stay coherent — ai/DESIGN.md §4).
 */
export function basisFromNormal(origin: Vec3, normal: Vec3): Basis {
  const z = normalize(normal);
  const x = anyPerpendicular(z);
  const y = cross(z, x);
  return { origin, x, y, z };
}

/**
 * Build a basis with a preferred in-plane x direction (projected onto the plane
 * and re-orthonormalized). Falls back to a stable arbitrary axis if `preferX`
 * is parallel to the normal.
 */
export function basisFromNormalAndX(origin: Vec3, normal: Vec3, preferX: Vec3): Basis {
  const z = normalize(normal);
  const proj = sub(preferX, addScaled([0, 0, 0], z, dot(preferX, z)));
  const projLenSq = proj[0] * proj[0] + proj[1] * proj[1] + proj[2] * proj[2];
  const x = projLenSq > 0 ? normalize(proj) : anyPerpendicular(z);
  const y = cross(z, x);
  return { origin, x, y, z };
}

/** Local (u, v) plane coordinates → world point on the basis plane. */
export function planePoint(b: Basis, u: number, v: number): Vec3 {
  return [
    b.origin[0] + b.x[0] * u + b.y[0] * v,
    b.origin[1] + b.x[1] * u + b.y[1] * v,
    b.origin[2] + b.x[2] * u + b.y[2] * v,
  ];
}

/** World point → local (u, v) coordinates in the basis plane (drops normal component). */
export function toPlaneCoords(b: Basis, p: Vec3): [number, number] {
  const d = sub(p, b.origin);
  return [dot(d, b.x), dot(d, b.y)];
}
