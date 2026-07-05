// Camera model + projection. Builds a 3×4 projection matrix P mapping a
// homogeneous world point (x, y, z, 1) to a homogeneous screen point (u, v, w),
// with pixel coordinates (u/w, v/w). Orthographic and perspective are handled by
// swapping the intrinsic block only (ai/DESIGN.md §5: support both, default ortho).

import type { Camera, Ray, Vec2, Vec3 } from "./types.js";
import { cross, dot, normalize, sub } from "./vec3.js";

export interface CameraFrame {
  right: Vec3;
  up: Vec3;
  /** forward = from eye toward target (the view direction) */
  forward: Vec3;
}

export function cameraFrame(cam: Camera): CameraFrame {
  const forward = normalize(sub(cam.target, cam.eye));
  const right = normalize(cross(forward, cam.up));
  const up = cross(right, forward);
  return { right, up, forward };
}

/** 3×4 projection matrix (row-major, 12 entries). */
export type Proj = readonly number[];

/** Build the world→screen 3×4 projection matrix for the camera. */
export function projectionMatrix(cam: Camera): Proj {
  const { right, up, forward } = cameraFrame(cam);
  const e = cam.eye;
  // View matrix rows (world → camera coords: xc right, yc up, zc forward).
  const V: number[] = [
    right[0], right[1], right[2], -dot(right, e),
    up[0], up[1], up[2], -dot(up, e),
    forward[0], forward[1], forward[2], -dot(forward, e),
    0, 0, 0, 1,
  ];

  const W = cam.viewport.width;
  const H = cam.viewport.height;

  // Intrinsic 3×4 K in camera coords. Screen y points down, so yc is negated.
  let K: number[];
  if (cam.projection === "orthographic") {
    const inv = 1 / cam.scale; // pixels per world unit
    K = [
      inv, 0, 0, W / 2,
      0, -inv, 0, H / 2,
      0, 0, 0, 1,
    ];
  } else {
    const fpx = H / 2 / Math.tan(cam.scale / 2); // focal length in pixels
    K = [
      fpx, 0, W / 2, 0,
      0, -fpx, H / 2, 0,
      0, 0, 1, 0,
    ];
  }

  // P = K (3×4) · V (4×4) → 3×4.
  const P = new Array<number>(12).fill(0);
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 4; c++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += (K[r * 4 + k] as number) * (V[k * 4 + c] as number);
      P[r * 4 + c] = s;
    }
  return P;
}

/** Project a world point to pixel coordinates. `w` is the homogeneous depth
 *  (>0 in front of the camera for perspective; constant 1 for ortho). */
export function projectPoint(P: Proj, p: Vec3): { point: Vec2; w: number } {
  const u = (P[0] as number) * p[0] + (P[1] as number) * p[1] + (P[2] as number) * p[2] + (P[3] as number);
  const v = (P[4] as number) * p[0] + (P[5] as number) * p[1] + (P[6] as number) * p[2] + (P[7] as number);
  const w = (P[8] as number) * p[0] + (P[9] as number) * p[1] + (P[10] as number) * p[2] + (P[11] as number);
  return { point: [u / w, v / w], w };
}

/**
 * Inverse of {@link projectPoint}: the world-space viewing ray through a pixel.
 * Perspective rays fan out from the eye; orthographic rays are parallel along the
 * view axis, offset across the image plane. Used by the visibility stage to map a
 * screen crossing back onto a feature's supporting geometry (ai/DESIGN.md §2.4).
 */
export function unproject(cam: Camera, pixel: Vec2): Ray {
  const { right, up, forward } = cameraFrame(cam);
  const W = cam.viewport.width;
  const H = cam.viewport.height;
  if (cam.projection === "perspective") {
    const fpx = H / 2 / Math.tan(cam.scale / 2);
    const a = (pixel[0] - W / 2) / fpx;
    const b = -(pixel[1] - H / 2) / fpx;
    const dir = normalize([
      a * right[0] + b * up[0] + forward[0],
      a * right[1] + b * up[1] + forward[1],
      a * right[2] + b * up[2] + forward[2],
    ]);
    return { origin: cam.eye, dir };
  }
  // Orthographic: parallel rays, origin slid across the image plane through the eye.
  const xo = (pixel[0] - W / 2) * cam.scale;
  const yo = -(pixel[1] - H / 2) * cam.scale;
  const origin: Vec3 = [
    cam.eye[0] + xo * right[0] + yo * up[0],
    cam.eye[1] + xo * right[1] + yo * up[1],
    cam.eye[2] + xo * right[2] + yo * up[2],
  ];
  return { origin, dir: forward };
}
