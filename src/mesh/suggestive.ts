// Phase-2 step 5: suggestive contours (ai/DESIGN.md §3.3.5).
//
// DeCarlo, Finkelstein, Rusinkiewicz & Santella (SIGGRAPH 2003): the lines an
// artist draws where the surface *would* turn away under a slightly different
// view — the loci where the **radial curvature** κ_r (the normal curvature in the
// direction w, the view vector projected onto the tangent plane) is zero, on the
// front-facing surface, and *increasing* in the w direction (D_w κ_r > 0). They
// extend the true silhouette into concave regions and read as form lines.
//
// Same zero-set-through-faces + chaining machinery as the silhouette, applied to
// κ_r instead of n·v, with a per-crossing acceptance filter for the front-facing
// and derivative-threshold conditions. Needs the curvature precompute (§3.3.2) —
// principal curvatures for κ_r and the `dcurv` tensor for D_w κ_r.

import type { Camera, Vec3 } from "../math/types.js";
import { dot, normalize, sub } from "../math/vec3.js";
import { cameraFrame } from "../math/camera.js";
import type { HalfEdgeMesh } from "./halfedge.js";
import type { CurvatureField } from "./curvature.js";
import { zeroSetChains, type ZeroSetChain } from "./silhouette.js";

export interface SuggestiveOptions {
  /** D_w κ_r must exceed this to draw (filters weak/noisy contours). Default 0. */
  threshold?: number;
  /** width of the D_w κ_r band above `threshold` over which a contour fades in
   *  (its mean margin maps to a 0..1 `strength`, styling multiplies opacity) —
   *  so contours hovering at the threshold dissolve instead of popping under
   *  camera motion (temporal coherence). 0/absent = hard threshold. */
  fade?: number;
}

/** Per-vertex radial curvature and the auxiliary fields for the DeCarlo test. */
function radialFields(mesh: HalfEdgeMesh, cam: Camera, curv: CurvatureField): {
  kr: Float64Array;
  ndotv: Float64Array;
  dwkr: Float64Array;
} {
  const nv = mesh.vertexCount;
  const kr = new Float64Array(nv);
  const ndotv = new Float64Array(nv);
  const dwkr = new Float64Array(nv);
  const persp = cam.projection === "perspective";
  const fwd = cameraFrame(cam).forward;
  const toEyeOrtho: Vec3 = [-fwd[0], -fwd[1], -fwd[2]];

  for (let v = 0; v < nv; v++) {
    const p = mesh.positions[v]!;
    const view = persp ? normalize(sub(cam.eye, p)) : toEyeOrtho;
    const c = curv.perVertex[v]!;
    const nd = dot(view, mesh.vertexNormals[v]!);
    ndotv[v] = nd;
    const u = dot(view, c.dir1);
    const w = dot(view, c.dir2);
    const u2 = u * u;
    const w2 = w * w;
    // κ_r · |w|² (Euler's formula); the sign/zero is what the zero-set needs
    kr[v] = c.k1 * u2 + c.k2 * w2;

    const denom = u2 + w2;
    if (denom < 1e-12) {
      dwkr[v] = -Infinity; // view ∥ normal: w vanishes, derivative undefined — reject
      continue;
    }
    const csc2 = 1 / denom;
    const d = curv.dcurv[v]!;
    let s = (u2 * (u * d[0] + 3 * w * d[1]) + w2 * (3 * u * d[2] + w * d[3])) * csc2;
    const tr = (c.k2 - c.k1) * u * w * csc2;
    s -= 2 * nd * tr * tr; // correction: w rotates as you move along it
    dwkr[v] = s;
  }
  return { kr, ndotv, dwkr };
}

/**
 * Extract suggestive contours for `cam` as ordered world-space polylines: the
 * zero-set of radial curvature, kept only where the surface is front-facing
 * (n·v > 0) and D_w κ_r exceeds `threshold`.
 */
export function suggestiveContours(mesh: HalfEdgeMesh, cam: Camera, curv: CurvatureField, opts: SuggestiveOptions = {}): Vec3[][] {
  return suggestiveContourChains(mesh, cam, curv, opts).map((c) => c.pts);
}

/** A suggestive-contour chain plus its 0..1 `strength` — how far its mean
 *  D_w κ_r clears the threshold relative to the fade band (1 when no band). */
export type SuggestiveChain = ZeroSetChain & { strength: number };

/** `suggestiveContours` with canonical orientation + identity keys (see
 *  `ZeroSetChain`) — what the mesh source uses to give each contour a stable
 *  `FeatureId` across frames — and a per-chain fade `strength`. */
export function suggestiveContourChains(mesh: HalfEdgeMesh, cam: Camera, curv: CurvatureField, opts: SuggestiveOptions = {}): SuggestiveChain[] {
  const { kr, ndotv, dwkr } = radialFields(mesh, cam, curv);
  const threshold = opts.threshold ?? 0;
  const fade = opts.fade ?? 0;
  // margin of each accepted crossing above the threshold, keyed by crossed edge
  const margin = new Map<string, number>();
  const accept = (lo: number, hi: number, s: number): boolean => {
    const nd = ndotv[lo]! * (1 - s) + ndotv[hi]! * s; // front-facing side only
    const dw = dwkr[lo]! * (1 - s) + dwkr[hi]! * s; //   radial curvature increasing
    if (!(nd > 0 && dw > threshold)) return false;
    if (fade > 0) margin.set(`${lo}_${hi}`, dw - threshold);
    return true;
  };
  return zeroSetChains(mesh, kr, accept).map((c) => {
    if (fade <= 0) return { ...c, strength: 1 };
    let sum = 0;
    for (const n of c.nodes) sum += margin.get(n) ?? 0;
    return { ...c, strength: Math.min(1, sum / c.nodes.length / fade) };
  });
}
