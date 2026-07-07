// Exact projection of an analytic in-plane conic to a screen conic.
//
// A circle/ellipse living in a world plane is a conic. Under the 3×4 projection
// P it maps to another conic in screen space — no sampling. The plane→screen map
// is the 3×3 homography H = P · [ x̂ | ŷ | origin ] (columns homogeneous), and a
// point conic transforms as  C_screen = H⁻ᵀ · C_plane · H⁻¹. This keeps rim
// ellipses (cylinder/cone caps) analytic for the QI stage (docs/DESIGN.md §2.4).

import type { Curve2D } from "../curve/types.js";
import type { Vec3 } from "./types.js";
import type { Mat3 } from "./mat3.js";
import { adjugate, det, mulM, scaleM, transpose } from "./mat3.js";
import { matrixToConic } from "../curve/conic.js";
import type { Proj } from "./camera.js";
import { EPS_ABS } from "../curve/epsilon.js";

/** Plane→screen homography H = P · Mp, Mp = [ (x̂,0) | (ŷ,0) | (origin,1) ]. */
export function planeToScreenHomography(P: Proj, xhat: Vec3, yhat: Vec3, origin: Vec3): Mat3 {
  const cols: Array<[number, number, number, number]> = [
    [xhat[0], xhat[1], xhat[2], 0],
    [yhat[0], yhat[1], yhat[2], 0],
    [origin[0], origin[1], origin[2], 1],
  ];
  const H = new Array<number>(9);
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) {
      const c = cols[j]!;
      H[i * 3 + j] =
        (P[i * 4 + 0] as number) * c[0] +
        (P[i * 4 + 1] as number) * c[1] +
        (P[i * 4 + 2] as number) * c[2] +
        (P[i * 4 + 3] as number) * c[3];
    }
  return H as unknown as Mat3;
}

/** Push a plane-space point conic through a homography into screen space. */
export function screenConicFromPlaneConic(H: Mat3, planeConic: Mat3): Curve2D | null {
  const d = det(H);
  if (Math.abs(d) <= EPS_ABS) return null; // plane projects to a line (edge-on)
  const Hinv = scaleM(adjugate(H), 1 / d);
  const C = mulM(transpose(Hinv), mulM(planeConic, Hinv));
  return { kind: "conic", params: matrixToConic(C) };
}

/** Screen conic of a world circle (center, radius) with the given in-plane axes. */
export function projectCircle(P: Proj, center: Vec3, radius: number, xhat: Vec3, yhat: Vec3): Curve2D | null {
  const H = planeToScreenHomography(P, xhat, yhat, center);
  // u² + v² − r² = 0
  const circle: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, -radius * radius];
  return screenConicFromPlaneConic(H, circle);
}
