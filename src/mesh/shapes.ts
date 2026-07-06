// A few indexed triangle meshes for tests and demos. All are oriented CCW when
// seen from outside, so face normals point outward.

import type { Vec3 } from "../math/types.js";
import type { MeshInput, Tri } from "./halfedge.js";
import { cross, dot, sub } from "../math/vec3.js";

/** Flip any face whose normal disagrees with `outward(centroid)` so a star-shaped
 *  mesh ends up consistently oriented outward. */
function orient(positions: readonly Vec3[], triangles: Tri[], outward: (c: Vec3) => Vec3): Tri[] {
  return triangles.map((t) => {
    const a = positions[t[0]]!;
    const b = positions[t[1]]!;
    const c = positions[t[2]]!;
    const n = cross(sub(b, a), sub(c, a));
    const centroid: Vec3 = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
    return dot(n, outward(centroid)) < 0 ? ([t[0], t[2], t[1]] as Tri) : t;
  });
}

/** Regular tetrahedron inscribed in the cube (centre at origin). 4 faces, 6 edges. */
export function tetrahedron(): MeshInput {
  const positions: Vec3[] = [
    [1, 1, 1],
    [1, -1, -1],
    [-1, 1, -1],
    [-1, -1, 1],
  ];
  const triangles: Tri[] = [
    [0, 1, 2],
    [0, 2, 3],
    [0, 3, 1],
    [1, 3, 2],
  ];
  return { positions, triangles };
}

/** Axis-aligned cube [-1,1]³ as 12 triangles with shared corners. */
export function cube(): MeshInput {
  const positions: Vec3[] = [
    [-1, -1, -1], // 0
    [1, -1, -1], //  1
    [1, 1, -1], //   2
    [-1, 1, -1], //  3
    [-1, -1, 1], //  4
    [1, -1, 1], //   5
    [1, 1, 1], //    6
    [-1, 1, 1], //   7
  ];
  const triangles: Tri[] = [
    [0, 3, 2], [0, 2, 1], // -z
    [4, 5, 6], [4, 6, 7], // +z
    [0, 1, 5], [0, 5, 4], // -y
    [3, 7, 6], [3, 6, 2], // +y
    [0, 4, 7], [0, 7, 3], // -x
    [1, 2, 6], [1, 6, 5], // +x
  ];
  return { positions, triangles };
}

/** A flat n×n grid of quads on the z=0 plane, side length `size` centred at
 *  origin — an open surface (has a boundary), for boundary/normal tests. */
export function grid(n = 2, size = 2): MeshInput {
  const positions: Vec3[] = [];
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      positions.push([(i / n - 0.5) * size, (j / n - 0.5) * size, 0]);
    }
  }
  const idx = (i: number, j: number) => j * (n + 1) + i;
  const triangles: Tri[] = [];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      triangles.push([idx(i, j), idx(i + 1, j), idx(i + 1, j + 1)]);
      triangles.push([idx(i, j), idx(i + 1, j + 1), idx(i, j + 1)]);
    }
  }
  return { positions, triangles };
}

/** Closed UV sphere of radius `R` (poles are single vertices). Star-shaped from
 *  the origin, so faces are oriented outward. */
export function uvSphere(R = 1, nu = 24, nv = 16): MeshInput {
  const positions: Vec3[] = [[0, 0, -R]]; // south pole = index 0
  for (let i = 1; i < nv; i++) {
    const theta = (Math.PI * i) / nv; // 0 → PI (south → north)
    const z = -R * Math.cos(theta);
    const r = R * Math.sin(theta);
    for (let j = 0; j < nu; j++) {
      const phi = (2 * Math.PI * j) / nu;
      positions.push([r * Math.cos(phi), r * Math.sin(phi), z]);
    }
  }
  const north = positions.length;
  positions.push([0, 0, R]);
  const ring = (i: number, j: number) => 1 + (i - 1) * nu + (((j % nu) + nu) % nu);

  const triangles: Tri[] = [];
  for (let j = 0; j < nu; j++) triangles.push([0, ring(1, j), ring(1, j + 1)]); // south cap
  for (let i = 1; i < nv - 1; i++) {
    for (let j = 0; j < nu; j++) {
      triangles.push([ring(i, j), ring(i + 1, j), ring(i + 1, j + 1)]);
      triangles.push([ring(i, j), ring(i + 1, j + 1), ring(i, j + 1)]);
    }
  }
  for (let j = 0; j < nu; j++) triangles.push([north, ring(nv - 1, j + 1), ring(nv - 1, j)]); // north cap
  return { positions, triangles: orient(positions, triangles, (c) => c) };
}

/** Open circular tube (lateral surface only) of radius `R`, height `H`, axis +z,
 *  centred at the origin. Has top/bottom boundary loops. */
export function tube(R = 1, H = 2, n = 24, rings = 8): MeshInput {
  const positions: Vec3[] = [];
  for (let i = 0; i <= rings; i++) {
    const z = -H / 2 + (H * i) / rings;
    for (let j = 0; j < n; j++) {
      const phi = (2 * Math.PI * j) / n;
      positions.push([R * Math.cos(phi), R * Math.sin(phi), z]);
    }
  }
  const idx = (i: number, j: number) => i * n + (((j % n) + n) % n);
  const triangles: Tri[] = [];
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < n; j++) {
      triangles.push([idx(i, j), idx(i + 1, j), idx(i + 1, j + 1)]);
      triangles.push([idx(i, j), idx(i + 1, j + 1), idx(i, j + 1)]);
    }
  }
  return { positions, triangles: orient(positions, triangles, (c) => [c[0], c[1], 0]) };
}
