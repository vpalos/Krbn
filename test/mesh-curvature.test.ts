import { describe, expect, test } from "bun:test";
import { HalfEdgeMesh } from "../src/mesh/halfedge.js";
import { computeCurvature } from "../src/mesh/curvature.js";
import { grid, tube, uvSphere } from "../src/mesh/shapes.js";
import { dot } from "../src/math/vec3.js";

/** Indices of vertices strictly inside the tube (not on the top/bottom boundary
 *  rings), where the Rusinkiewicz fit has full one-ring support. */
function interiorTubeVerts(n: number, rings: number): number[] {
  const out: number[] = [];
  for (let i = 1; i < rings; i++) for (let j = 0; j < n; j++) out.push(i * n + j);
  return out;
}

describe("curvature — plane", () => {
  test("a flat grid has ~zero principal curvatures", () => {
    const m = HalfEdgeMesh.build(grid(6, 4));
    const cur = computeCurvature(m);
    // interior vertices (index the middle row/col) should be flat
    for (let v = 0; v < m.vertexCount; v++) {
      expect(Math.abs(cur.perVertex[v]!.k1)).toBeLessThan(1e-6);
      expect(Math.abs(cur.perVertex[v]!.k2)).toBeLessThan(1e-6);
    }
  });
});

describe("curvature — sphere (radius R ⇒ |κ| = 1/R)", () => {
  const R = 2.5;
  const m = HalfEdgeMesh.build(uvSphere(R, 48, 32));
  const cur = computeCurvature(m);

  test("both principal curvatures ≈ 1/R away from the poles", () => {
    // sample equatorial-ish vertices (avoid the two pole vertices)
    let checked = 0;
    for (let v = 1; v < m.vertexCount - 1; v++) {
      const z = m.positions[v]![2];
      if (Math.abs(z) > 0.6 * R) continue; // skip near-pole rings
      expect(Math.abs(cur.perVertex[v]!.k1)).toBeCloseTo(1 / R, 1);
      expect(Math.abs(cur.perVertex[v]!.k2)).toBeCloseTo(1 / R, 1);
      checked++;
    }
    expect(checked).toBeGreaterThan(50);
  });

  test("Gaussian curvature is positive (both curvatures share a sign)", () => {
    for (let v = 1; v < m.vertexCount - 1; v++) {
      if (Math.abs(m.positions[v]![2]) > 0.6 * R) continue;
      expect(cur.gaussian(v)).toBeGreaterThan(0);
    }
  });

  test("curvature is (nearly) constant, so its derivative ≈ 0", () => {
    for (let v = 1; v < m.vertexCount - 1; v++) {
      if (Math.abs(m.positions[v]![2]) > 0.4 * R) continue;
      const d = cur.dcurv[v]!;
      const mag = Math.hypot(d[0], d[1], d[2], d[3]);
      expect(mag).toBeLessThan(0.15); // small relative to 1/R = 0.4
    }
  });
});

describe("curvature — cylinder (one curvature 1/R, one 0)", () => {
  const R = 1.5;
  const n = 48;
  const rings = 12;
  const m = HalfEdgeMesh.build(tube(R, 4, n, rings));
  const cur = computeCurvature(m);
  const interior = interiorTubeVerts(n, rings);

  test("|κ_max| ≈ 1/R and |κ_min| ≈ 0 on the lateral surface", () => {
    for (const v of interior) {
      expect(Math.abs(cur.perVertex[v]!.k1)).toBeCloseTo(1 / R, 1);
      expect(Math.abs(cur.perVertex[v]!.k2)).toBeLessThan(0.1);
    }
  });

  test("the flat (κ≈0) principal direction runs along the axis (±z)", () => {
    for (const v of interior) {
      const axial = cur.perVertex[v]!.dir2; // dir2 ↔ k2 ≈ 0
      expect(Math.abs(dot(axial, [0, 0, 1]))).toBeCloseTo(1, 1);
    }
  });

  test("developable surface ⇒ Gaussian curvature ≈ 0", () => {
    for (const v of interior) expect(Math.abs(cur.gaussian(v))).toBeLessThan(0.1);
  });
});
