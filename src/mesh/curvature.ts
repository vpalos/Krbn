// Phase-2 step 2: per-vertex curvature precompute (docs/DESIGN.md §3.3.2).
//
// A faithful port of Rusinkiewicz, "Estimating Curvatures and Their Derivatives
// on Triangle Meshes" (SGP 2004) — the method trimesh2 uses. For each face we fit
// the second fundamental form by least squares from the variation of the vertex
// normals across its edges, rotate it into each vertex's tangent frame, and
// area-weight-average. Diagonalizing gives principal curvatures κ1, κ2 and their
// directions. The third-order tensor `dcurv` (the derivative of curvature) is fit
// the same way and feeds suggestive contours (§3.3.5) later.
//
// Static — view-independent, paid once. Noise-sensitive by nature; smoothing of
// the input mesh is the standard mitigation.

import type { Vec3 } from "../math/types.js";
import { add, cross, dot, length, lengthSq, normalize, scale, sub } from "../math/vec3.js";
import type { HalfEdgeMesh } from "./halfedge.js";

export interface VertexCurvature {
  /** principal curvatures, |κ1| ≥ |κ2| */
  k1: number;
  k2: number;
  /** unit principal directions (tangent), for κ1 and κ2 */
  dir1: Vec3;
  dir2: Vec3;
}

export interface CurvatureField {
  perVertex: VertexCurvature[];
  /** derivative-of-curvature tensor per vertex, 4 unique coefficients (a,b,c,d) in
   *  the (dir1,dir2) frame — the rate of change of the shape operator */
  dcurv: [number, number, number, number][];
  /** mixed-Voronoi area assigned to each vertex */
  pointAreas: number[];
  mean(v: number): number;
  gaussian(v: number): number;
}

// --- small dense symmetric solver (LDL^T, Numerical-Recipes style) -----------
// Row-major flat Float64Array so TS indexed access stays `number`.

/** In-place LDL^T factor of the upper triangle of `A` (n×n flat); returns 1/diag,
 *  or null if not positive-definite. Lower triangle is overwritten with L. */
function ldltdc(A: Float64Array, n: number): Float64Array | null {
  const rdiag = new Float64Array(n);
  const v = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < i; k++) v[k] = A[i * n + k]! * rdiag[k]!;
    for (let j = i; j < n; j++) {
      let sum = A[i * n + j]!;
      for (let k = 0; k < i; k++) sum -= v[k]! * A[j * n + k]!;
      if (i === j) {
        if (sum <= 0) return null;
        rdiag[i] = 1 / sum;
      } else {
        A[j * n + i] = sum;
      }
    }
  }
  return rdiag;
}

/** Solve A x = b using the factor from `ldltdc`. */
function ldltsl(A: Float64Array, rdiag: Float64Array, b: Float64Array, n: number): Float64Array {
  const x = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let sum = b[i]!;
    for (let k = 0; k < i; k++) sum -= A[i * n + k]! * x[k]!;
    x[i] = sum * rdiag[i]!;
  }
  for (let i = n - 1; i >= 0; i--) {
    let sum = 0;
    for (let k = i + 1; k < n; k++) sum += A[k * n + i]! * x[k]!;
    x[i] = x[i]! - sum * rdiag[i]!;
  }
  return x;
}

// --- frame transport + tensor projection (Rusinkiewicz appendix) -------------

/** Rotate an orthonormal tangent frame (u,v) to be perpendicular to `newNorm`,
 *  by the minimal rotation. */
function rotCoordSys(u: Vec3, v: Vec3, newNorm: Vec3): [Vec3, Vec3] {
  const oldNorm = cross(u, v);
  const ndot = dot(oldNorm, newNorm);
  if (ndot <= -1) return [scale(u, -1), scale(v, -1)];
  const perpOld = sub(newNorm, scale(oldNorm, ndot)); // component of newNorm ⟂ oldNorm
  const dperp = scale(add(oldNorm, newNorm), 1 / (1 + ndot));
  return [sub(u, scale(dperp, dot(u, perpOld))), sub(v, scale(dperp, dot(v, perpOld)))];
}

/** Reproject a curvature tensor (ku,kuv,kv) from frame (ou,ov) into frame (nu,nv). */
function projCurv(ou: Vec3, ov: Vec3, ku: number, kuv: number, kv: number, nu: Vec3, nv: Vec3): [number, number, number] {
  const [ru, rv] = rotCoordSys(nu, nv, cross(ou, ov));
  const u1 = dot(ru, ou);
  const v1 = dot(ru, ov);
  const u2 = dot(rv, ou);
  const v2 = dot(rv, ov);
  return [
    ku * u1 * u1 + kuv * (2 * u1 * v1) + kv * v1 * v1,
    ku * u1 * u2 + kuv * (u1 * v2 + u2 * v1) + kv * v1 * v2,
    ku * u2 * u2 + kuv * (2 * u2 * v2) + kv * v2 * v2,
  ];
}

/** Diagonalize (ku,kuv,kv) in frame (ou,ov) about `newNorm` → principal curvatures
 *  and directions, ordered |k1| ≥ |k2|. */
function diagonalizeCurv(
  ou: Vec3,
  ov: Vec3,
  ku: number,
  kuv: number,
  kv: number,
  newNorm: Vec3,
): VertexCurvature {
  const [ru, rv] = rotCoordSys(ou, ov, newNorm);
  let c = 1;
  let s = 0;
  let tt = 0;
  if (kuv !== 0) {
    const h = (0.5 * (kv - ku)) / kuv;
    tt = h < 0 ? 1 / (h - Math.sqrt(1 + h * h)) : 1 / (h + Math.sqrt(1 + h * h));
    c = 1 / Math.sqrt(1 + tt * tt);
    s = tt * c;
  }
  let k1 = ku - tt * kuv;
  let k2 = kv + tt * kuv;
  let dir1: Vec3;
  if (Math.abs(k1) >= Math.abs(k2)) {
    dir1 = sub(scale(ru, c), scale(rv, s));
  } else {
    [k1, k2] = [k2, k1];
    dir1 = add(scale(ru, s), scale(rv, c));
  }
  return { k1, k2, dir1, dir2: cross(newNorm, dir1) };
}

/** Reproject the derivative-of-curvature tensor between frames. */
function projDcurv(
  ou: Vec3,
  ov: Vec3,
  d: readonly [number, number, number, number],
  nu: Vec3,
  nv: Vec3,
): [number, number, number, number] {
  const [ru, rv] = rotCoordSys(nu, nv, cross(ou, ov));
  const u1 = dot(ru, ou);
  const v1 = dot(ru, ov);
  const u2 = dot(rv, ou);
  const v2 = dot(rv, ov);
  const [d0, d1, d2, d3] = d;
  return [
    d0 * u1 * u1 * u1 + d1 * 3 * u1 * u1 * v1 + d2 * 3 * u1 * v1 * v1 + d3 * v1 * v1 * v1,
    d0 * u1 * u1 * u2 + d1 * (u1 * u1 * v2 + 2 * u1 * v1 * u2) + d2 * (u2 * v1 * v1 + 2 * u1 * v1 * v2) + d3 * v1 * v1 * v2,
    d0 * u1 * u2 * u2 + d1 * (u2 * u2 * v1 + 2 * u1 * u2 * v2) + d2 * (u1 * v2 * v2 + 2 * u2 * v1 * v2) + d3 * v1 * v2 * v2,
    d0 * u2 * u2 * u2 + d1 * 3 * u2 * u2 * v2 + d2 * 3 * u2 * v2 * v2 + d3 * v2 * v2 * v2,
  ];
}

// --- mixed-Voronoi point areas (Meyer et al., as in trimesh2) ----------------

function pointAreas(mesh: HalfEdgeMesh): { point: number[]; corner: [number, number, number][] } {
  const point = new Array<number>(mesh.vertexCount).fill(0);
  const corner: [number, number, number][] = [];
  const P = mesh.positions;
  for (let f = 0; f < mesh.faceCount; f++) {
    const t = mesh.triangles[f]!;
    const e0 = sub(P[t[2]]!, P[t[1]]!);
    const e1 = sub(P[t[0]]!, P[t[2]]!);
    const e2 = sub(P[t[1]]!, P[t[0]]!);
    const area = 0.5 * length(cross(e0, e1));
    const l2: [number, number, number] = [lengthSq(e0), lengthSq(e1), lengthSq(e2)];
    const ew: [number, number, number] = [
      l2[0] * (l2[1] + l2[2] - l2[0]),
      l2[1] * (l2[2] + l2[0] - l2[1]),
      l2[2] * (l2[0] + l2[1] - l2[2]),
    ];
    let ca: [number, number, number];
    if (ew[0] <= 0) {
      const c1 = (-0.25 * l2[2] * area) / dot(e0, e2);
      const c2 = (-0.25 * l2[1] * area) / dot(e0, e1);
      ca = [area - c1 - c2, c1, c2];
    } else if (ew[1] <= 0) {
      const c2 = (-0.25 * l2[0] * area) / dot(e1, e0);
      const c0 = (-0.25 * l2[2] * area) / dot(e1, e2);
      ca = [c0, area - c2 - c0, c2];
    } else if (ew[2] <= 0) {
      const c0 = (-0.25 * l2[1] * area) / dot(e2, e1);
      const c1 = (-0.25 * l2[0] * area) / dot(e2, e0);
      ca = [c0, c1, area - c0 - c1];
    } else {
      const s = (0.5 * area) / (ew[0] + ew[1] + ew[2]);
      ca = [s * (ew[1] + ew[2]), s * (ew[2] + ew[0]), s * (ew[0] + ew[1])];
    }
    corner.push(ca);
    point[t[0]] = point[t[0]]! + ca[0];
    point[t[1]] = point[t[1]]! + ca[1];
    point[t[2]] = point[t[2]]! + ca[2];
  }
  return { point, corner };
}

/** Per-vertex principal curvatures + directions and the curvature-derivative
 *  tensor, area-weighted from per-face least-squares fits. */
export function computeCurvature(mesh: HalfEdgeMesh): CurvatureField {
  const nv = mesh.vertexCount;
  const P = mesh.positions;
  const N = mesh.vertexNormals;
  const { point, corner } = pointAreas(mesh);

  // Per-vertex tangent frame, seeded from an incident edge.
  const pdir1: Vec3[] = P.map(() => [0, 0, 0] as Vec3);
  for (let f = 0; f < mesh.faceCount; f++) {
    const t = mesh.triangles[f]!;
    pdir1[t[0]] = sub(P[t[1]]!, P[t[0]]!);
    pdir1[t[1]] = sub(P[t[2]]!, P[t[1]]!);
    pdir1[t[2]] = sub(P[t[0]]!, P[t[2]]!);
  }
  const pdir2: Vec3[] = new Array<Vec3>(nv);
  for (let v = 0; v < nv; v++) {
    pdir1[v] = normalize(cross(pdir1[v]!, N[v]!));
    pdir2[v] = cross(N[v]!, pdir1[v]!);
  }

  const curv1 = new Float64Array(nv);
  const curv12 = new Float64Array(nv);
  const curv2 = new Float64Array(nv);

  // --- second fundamental form per face → accumulate to vertices ---
  for (let f = 0; f < mesh.faceCount; f++) {
    const t = mesh.triangles[f]!;
    const e: [Vec3, Vec3, Vec3] = [sub(P[t[2]]!, P[t[1]]!), sub(P[t[0]]!, P[t[2]]!), sub(P[t[1]]!, P[t[0]]!)];
    const tang = normalize(e[0]);
    const bin = normalize(cross(cross(e[0], e[1]), tang));

    let w00 = 0;
    let w01 = 0;
    let w22 = 0;
    let m0 = 0;
    let m1 = 0;
    let m2 = 0;
    for (let j = 0; j < 3; j++) {
      const u = dot(e[j]!, tang);
      const vv = dot(e[j]!, bin);
      w00 += u * u;
      w01 += u * vv;
      w22 += vv * vv;
      const dn = sub(N[t[(j + 2) % 3]!]!, N[t[(j + 1) % 3]!]!);
      const dnu = dot(dn, tang);
      const dnv = dot(dn, bin);
      m0 += dnu * u;
      m1 += dnu * vv + dnv * u;
      m2 += dnv * vv;
    }
    // 3×3 normal system for (II_uu, II_uv, II_vv), full symmetric
    const w = Float64Array.of(w00, w01, 0, w01, w00 + w22, w01, 0, w01, w22);
    const diag = ldltdc(w, 3);
    if (!diag) continue;
    const ii = ldltsl(w, diag, Float64Array.of(m0, m1, m2), 3);

    for (let j = 0; j < 3; j++) {
      const vj = t[j]!;
      const [c1, c12, c2] = projCurv(tang, bin, ii[0]!, ii[1]!, ii[2]!, pdir1[vj]!, pdir2[vj]!);
      const wt = corner[f]![j]! / point[vj]!;
      curv1[vj]! += wt * c1;
      curv12[vj]! += wt * c12;
      curv2[vj]! += wt * c2;
    }
  }

  // --- diagonalize per vertex ---
  const perVertex: VertexCurvature[] = new Array<VertexCurvature>(nv);
  for (let v = 0; v < nv; v++) {
    const c = diagonalizeCurv(pdir1[v]!, pdir2[v]!, curv1[v]!, curv12[v]!, curv2[v]!, N[v]!);
    perVertex[v] = c;
    pdir1[v] = c.dir1; // principal frame for the derivative pass
    pdir2[v] = c.dir2;
    curv1[v] = c.k1;
    curv2[v] = c.k2;
  }

  // --- derivative-of-curvature tensor per face → accumulate to vertices ---
  const dcurv: [number, number, number, number][] = P.map(() => [0, 0, 0, 0] as [number, number, number, number]);
  for (let f = 0; f < mesh.faceCount; f++) {
    const t = mesh.triangles[f]!;
    const e: [Vec3, Vec3, Vec3] = [sub(P[t[2]]!, P[t[1]]!), sub(P[t[0]]!, P[t[2]]!), sub(P[t[1]]!, P[t[0]]!)];
    const tang = normalize(e[0]);
    const bin = normalize(cross(cross(e[0], e[1]), tang));

    // each vertex's diagonal curvature tensor, projected into this face frame
    const fcurv: [number, number, number][] = [];
    for (let j = 0; j < 3; j++) {
      const vj = t[j]!;
      fcurv.push(projCurv(pdir1[vj]!, pdir2[vj]!, curv1[vj]!, 0, curv2[vj]!, tang, bin));
    }

    let w00 = 0;
    let w01 = 0;
    let w11 = 0;
    let w12 = 0;
    let w22 = 0;
    let w23 = 0;
    let w33 = 0;
    let m0 = 0;
    let m1 = 0;
    let m2 = 0;
    let m3 = 0;
    for (let j = 0; j < 3; j++) {
      const fa = fcurv[(j + 2) % 3]!;
      const fb = fcurv[(j + 1) % 3]!;
      const df: [number, number, number] = [fa[0] - fb[0], fa[1] - fb[1], fa[2] - fb[2]];
      const u = dot(e[j]!, tang);
      const vv = dot(e[j]!, bin);
      const u2 = u * u;
      const v2 = vv * vv;
      const uv = u * vv;
      w00 += u2;
      w01 += uv;
      w11 += 2 * u2 + v2;
      w12 += 2 * uv;
      w22 += u2 + 2 * v2;
      w23 += uv;
      w33 += v2;
      m0 += u * df[0];
      m1 += vv * df[0] + 2 * u * df[1];
      m2 += 2 * vv * df[1] + u * df[2];
      m3 += vv * df[2];
    }
    // 4×4 normal system for the derivative-of-curvature coefficients, full symmetric
    const w = Float64Array.of(w00, w01, 0, 0, w01, w11, w12, 0, 0, w12, w22, w23, 0, 0, w23, w33);
    const diag = ldltdc(w, 4);
    if (!diag) continue;
    const ds = ldltsl(w, diag, Float64Array.of(m0, m1, m2, m3), 4);
    const d: [number, number, number, number] = [ds[0]!, ds[1]!, ds[2]!, ds[3]!];

    for (let j = 0; j < 3; j++) {
      const vj = t[j]!;
      const pd = projDcurv(tang, bin, d, pdir1[vj]!, pdir2[vj]!);
      const wt = corner[f]![j]! / point[vj]!;
      const acc = dcurv[vj]!;
      acc[0] += wt * pd[0];
      acc[1] += wt * pd[1];
      acc[2] += wt * pd[2];
      acc[3] += wt * pd[3];
    }
  }

  return {
    perVertex,
    dcurv,
    pointAreas: point,
    mean: (v) => 0.5 * (perVertex[v]!.k1 + perVertex[v]!.k2),
    gaussian: (v) => perVertex[v]!.k1 * perVertex[v]!.k2,
  };
}
