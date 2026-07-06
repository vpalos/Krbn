// A few indexed triangle meshes for tests and demos. All are oriented CCW when
// seen from outside, so face normals point outward.

import type { Vec3 } from "../math/types.js";
import type { MeshInput, Tri } from "./halfedge.js";
import { add, cross, dot, length, normalize, scale, sub } from "../math/vec3.js";

/** Translate every vertex of a mesh by `off` (for composing scenes). */
export function translate(mi: MeshInput, off: Vec3): MeshInput {
  return { positions: mi.positions.map((p) => [p[0] + off[0], p[1] + off[1], p[2] + off[2]] as Vec3), triangles: mi.triangles };
}

/** Rotate every vertex of a mesh about `axis` (unit) by `angle` (for composing). */
export function rotate(mi: MeshInput, axis: Vec3, angle: number): MeshInput {
  const u = normalize(axis);
  return { positions: mi.positions.map((p) => rotateAxis(p, u, angle)), triangles: mi.triangles };
}

/** Rodrigues rotation of `v` about unit `axis` by `angle`. */
function rotateAxis(v: Vec3, axis: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const cr = cross(axis, v);
  const d = dot(axis, v) * (1 - c);
  return [v[0] * c + cr[0] * s + axis[0] * d, v[1] * c + cr[1] * s + axis[1] * d, v[2] * c + cr[2] * s + axis[2] * d];
}

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

/** Closed torus (axis +z), major radius `R`, tube radius `r`. `nu` toroidal /
 *  `nv` poloidal segments. Oriented outward (normal points away from the tube). */
export function torusMesh(R = 1.3, r = 0.5, nu = 48, nv = 24): MeshInput {
  const positions: Vec3[] = [];
  for (let i = 0; i < nu; i++) {
    const u = (2 * Math.PI * i) / nu;
    const cu = Math.cos(u);
    const su = Math.sin(u);
    for (let j = 0; j < nv; j++) {
      const v = (2 * Math.PI * j) / nv;
      const rr = R + r * Math.cos(v);
      positions.push([rr * cu, rr * su, r * Math.sin(v)]);
    }
  }
  const idx = (i: number, j: number) => (((i % nu) + nu) % nu) * nv + (((j % nv) + nv) % nv);
  const triangles: Tri[] = [];
  for (let i = 0; i < nu; i++) {
    for (let j = 0; j < nv; j++) {
      triangles.push([idx(i, j), idx(i + 1, j), idx(i + 1, j + 1)]);
      triangles.push([idx(i, j), idx(i + 1, j + 1), idx(i, j + 1)]);
    }
  }
  // outward reference: from the nearest tube-centre (R·radial) to the centroid
  const outward = (c: Vec3): Vec3 => sub(c, scale(normalize([c[0], c[1], 0]), R));
  return { positions, triangles: orient(positions, triangles, outward) };
}

/** A "rubber-sheet" gravity well: a square grid sheet dipped downward by a smooth
 *  funnel z(r) = −depth / (1 + (r/a)²) — the spacetime-curvature picture. Open
 *  surface (has a boundary); curvature is concentrated in the dip. */
export function gravitySheet(R = 3, n = 64, depth = 1.7, a = 0.75): MeshInput {
  const well = (r: number) => -depth / (1 + (r / a) ** 2);
  const positions: Vec3[] = [];
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      const x = (i / n - 0.5) * 2 * R;
      const y = (j / n - 0.5) * 2 * R;
      positions.push([x, y, well(Math.hypot(x, y))]);
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

/** An organic "blob": a sphere whose radius is modulated by a smooth sinusoidal
 *  field, giving convex bumps and concave dimples (curvature hatch + suggestive
 *  contours have something to work with). Star-shaped ⇒ oriented outward. */
export function bumpyBlob(R = 1.1, amp = 0.22, fu = 4, fv = 5, nu = 48, nv = 32): MeshInput {
  const disp = (theta: number, phi: number) => 1 + amp * Math.sin(fv * theta) * Math.sin(fu * phi);
  const at = (theta: number, phi: number): Vec3 => {
    const rr = R * disp(theta, phi);
    return [rr * Math.sin(theta) * Math.cos(phi), rr * Math.sin(theta) * Math.sin(phi), -rr * Math.cos(theta)];
  };
  const positions: Vec3[] = [[0, 0, -R]]; // south pole (disp = 1 there)
  for (let i = 1; i < nv; i++) {
    const theta = (Math.PI * i) / nv;
    for (let j = 0; j < nu; j++) positions.push(at(theta, (2 * Math.PI * j) / nu));
  }
  const north = positions.length;
  positions.push([0, 0, R]);
  const ring = (i: number, j: number) => 1 + (i - 1) * nu + (((j % nu) + nu) % nu);
  const triangles: Tri[] = [];
  for (let j = 0; j < nu; j++) triangles.push([0, ring(1, j), ring(1, j + 1)]);
  for (let i = 1; i < nv - 1; i++) {
    for (let j = 0; j < nu; j++) {
      triangles.push([ring(i, j), ring(i + 1, j), ring(i + 1, j + 1)]);
      triangles.push([ring(i, j), ring(i + 1, j + 1), ring(i, j + 1)]);
    }
  }
  for (let j = 0; j < nu; j++) triangles.push([north, ring(nv - 1, j + 1), ring(nv - 1, j)]);
  return { positions, triangles: orient(positions, triangles, (c) => c) };
}

/** A closed tube swept along a trefoil knot, with a parallel-transport frame whose
 *  residual twist (holonomy) is distributed so the tube closes seamlessly. */
export function knotTube(tubeR = 0.28, nSeg = 160, nTube = 16, s = 0.55): MeshInput {
  const curve = (t: number): Vec3 => [s * (Math.sin(t) + 2 * Math.sin(2 * t)), s * (Math.cos(t) - 2 * Math.cos(2 * t)), s * -Math.sin(3 * t)];
  const pts: Vec3[] = [];
  for (let i = 0; i < nSeg; i++) pts.push(curve((2 * Math.PI * i) / nSeg));
  const tan: Vec3[] = [];
  for (let i = 0; i < nSeg; i++) tan.push(normalize(sub(pts[(i + 1) % nSeg]!, pts[(i - 1 + nSeg) % nSeg]!)));

  // parallel-transport the normal along the curve
  const nrm: Vec3[] = new Array(nSeg);
  const seed = Math.abs(tan[0]![0]) < 0.9 ? ([1, 0, 0] as Vec3) : ([0, 1, 0] as Vec3);
  nrm[0] = normalize(sub(seed, scale(tan[0]!, dot(seed, tan[0]!))));
  for (let i = 1; i < nSeg; i++) {
    const ax = cross(tan[i - 1]!, tan[i]!);
    const sinA = length(ax);
    let n = nrm[i - 1]!;
    if (sinA > 1e-9) n = rotateAxis(n, scale(ax, 1 / sinA), Math.atan2(sinA, dot(tan[i - 1]!, tan[i]!)));
    nrm[i] = normalize(sub(n, scale(tan[i]!, dot(n, tan[i]!))));
  }
  // holonomy: transport the last normal back onto tan[0] and measure the gap
  const axC = cross(tan[nSeg - 1]!, tan[0]!);
  const sinC = length(axC);
  let nClose = nrm[nSeg - 1]!;
  if (sinC > 1e-9) nClose = rotateAxis(nClose, scale(axC, 1 / sinC), Math.atan2(sinC, dot(tan[nSeg - 1]!, tan[0]!)));
  nClose = normalize(sub(nClose, scale(tan[0]!, dot(nClose, tan[0]!))));
  const twist = Math.atan2(dot(cross(nClose, nrm[0]!), tan[0]!), dot(nClose, nrm[0]!));

  const positions: Vec3[] = [];
  for (let i = 0; i < nSeg; i++) {
    const n = rotateAxis(nrm[i]!, tan[i]!, (twist * i) / nSeg); // distribute the twist
    const b = cross(tan[i]!, n);
    for (let k = 0; k < nTube; k++) {
      const a = (2 * Math.PI * k) / nTube;
      positions.push(add(pts[i]!, add(scale(n, tubeR * Math.cos(a)), scale(b, tubeR * Math.sin(a)))));
    }
  }
  const idx = (i: number, k: number) => (((i % nSeg) + nSeg) % nSeg) * nTube + (((k % nTube) + nTube) % nTube);
  const triangles: Tri[] = [];
  for (let i = 0; i < nSeg; i++) {
    for (let k = 0; k < nTube; k++) {
      triangles.push([idx(i, k), idx(i + 1, k), idx(i + 1, k + 1)]);
      triangles.push([idx(i, k), idx(i + 1, k + 1), idx(i, k + 1)]);
    }
  }
  // outward = away from the nearest centre-line point
  const nearest = (c: Vec3): Vec3 => {
    let best = pts[0]!;
    let bd = Infinity;
    for (const p of pts) {
      const d = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2;
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return best;
  };
  return { positions, triangles: orient(positions, triangles, (c) => sub(c, nearest(c))) };
}
