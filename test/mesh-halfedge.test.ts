import { describe, expect, test } from "bun:test";
import type { Vec3 } from "../src/math/types.js";
import { HalfEdgeMesh, type MeshInput, type Tri } from "../src/mesh/halfedge.js";
import { cube, grid, tetrahedron } from "../src/mesh/shapes.js";
import { dot, sub } from "../src/math/vec3.js";

const DEG = 180 / Math.PI;

describe("HalfEdgeMesh — topology", () => {
  test("tetrahedron: 4 verts, 4 faces, 6 edges, closed, χ = 2", () => {
    const m = HalfEdgeMesh.build(tetrahedron());
    expect(m.vertexCount).toBe(4);
    expect(m.faceCount).toBe(4);
    expect(m.edgeCount).toBe(6);
    expect(m.isClosed).toBe(true);
    expect(m.boundaryEdgeCount).toBe(0);
    expect(m.eulerCharacteristic()).toBe(2);
  });

  test("cube: 8 verts, 12 faces, 18 edges, closed, χ = 2", () => {
    const m = HalfEdgeMesh.build(cube());
    expect(m.vertexCount).toBe(8);
    expect(m.faceCount).toBe(12);
    expect(m.edgeCount).toBe(18);
    expect(m.eulerCharacteristic()).toBe(2);
    expect(m.isClosed).toBe(true);
  });

  test("every interior half-edge has a mutual twin; boundary half-edges have none", () => {
    const m = HalfEdgeMesh.build(cube());
    for (let h = 0; h < m.heTwin.length; h++) {
      const t = m.heTwin[h]!;
      if (t >= 0) {
        expect(m.heTwin[t]).toBe(h); // mutual
        // a twin runs the opposite direction over the same edge
        expect(m.heFrom[t]).toBe(m.heTo[h]!);
        expect(m.heTo[t]).toBe(m.heFrom[h]!);
      }
    }
    expect(m.isClosed).toBe(true); // cube has no boundary halfedges
  });
});

describe("HalfEdgeMesh — normals", () => {
  test("cube face normals point outward (away from the centre)", () => {
    const m = HalfEdgeMesh.build(cube());
    for (let f = 0; f < m.faceCount; f++) {
      // centre is the origin, so the centroid direction is the outward direction
      expect(dot(m.faceNormals[f]!, m.faceCentroid(f))).toBeGreaterThan(0);
    }
  });

  test("cube vertex normals are unit and point outward (≈ corner diagonal)", () => {
    const m = HalfEdgeMesh.build(cube());
    for (let v = 0; v < m.vertexCount; v++) {
      const n = m.vertexNormals[v]!;
      expect(Math.hypot(n[0], n[1], n[2])).toBeCloseTo(1, 9);
      expect(dot(n, m.positions[v]!)).toBeGreaterThan(0); // outward
    }
  });

  test("flat grid: all normals are +z, area sums to the square", () => {
    const m = HalfEdgeMesh.build(grid(3, 2));
    for (const n of m.faceNormals) expect(n[2]).toBeCloseTo(1, 9);
    const area = m.faceAreas.reduce((s, a) => s + a, 0);
    expect(area).toBeCloseTo(4, 9); // 2×2
  });
});

describe("HalfEdgeMesh — dihedral, creases, boundaries", () => {
  test("cube: real edges are 90° convex creases; face diagonals are coplanar (0°)", () => {
    const m = HalfEdgeMesh.build(cube());
    const interior = m.edges.filter((e) => !e.boundary);
    const right = interior.filter((e) => Math.abs(e.dihedral * DEG - 90) < 1e-6);
    const flat = interior.filter((e) => e.dihedral < 1e-6);
    expect(right.length).toBe(12); // the twelve cube edges
    expect(flat.length).toBe(6); //   one diagonal per face
    for (const e of right) {
      expect(e.crease).toBe(true);
      expect(e.convex).toBe(true); // a cube is convex
    }
    for (const e of flat) expect(e.crease).toBe(false);
    expect(m.creases().length).toBe(12);
  });

  test("tetrahedron: all six edges are convex creases at ≈109.47°", () => {
    const m = HalfEdgeMesh.build(tetrahedron());
    expect(m.creases().length).toBe(6);
    for (const e of m.edges) {
      expect(e.dihedral * DEG).toBeCloseTo(109.4712, 3);
      expect(e.convex).toBe(true);
    }
  });

  test("a concave valley is detected as non-convex", () => {
    // two triangles folded into a downward 'V' (a valley when seen from +z)
    const positions: Vec3[] = [
      [-1, 0, 1],
      [0, 0, 0], // shared low ridge
      [0, 1, 0],
      [1, 0, 1],
    ];
    const triangles: Tri[] = [
      [0, 1, 2],
      [1, 3, 2],
    ];
    const m = HalfEdgeMesh.build({ positions, triangles });
    const shared = m.edges.find((e) => !e.boundary)!;
    expect(shared.dihedral).toBeGreaterThan(0);
    expect(shared.convex).toBe(false); // valley, not ridge
  });

  test("open grid has a boundary loop; interior diagonals are not boundaries", () => {
    const m = HalfEdgeMesh.build(grid(2, 2));
    expect(m.isClosed).toBe(false);
    expect(m.boundaryEdgeCount).toBe(8); // 2×2 grid perimeter = 8 unit edges
    // Euler for a disk: V − E + F = 1
    expect(m.eulerCharacteristic()).toBe(1);
    for (const e of m.boundaries()) expect(e.boundary).toBe(true);
  });
});

describe("HalfEdgeMesh — cleanup", () => {
  test("weld merges coincident duplicated vertices so adjacency closes up", () => {
    // a square split into two triangles but with the diagonal vertices duplicated
    const positions: Vec3[] = [
      [0, 0, 0], [1, 0, 0], [1, 1, 0], // tri A
      [0, 0, 0], [1, 1, 0], [0, 1, 0], // tri B (0 and 2 duplicate A's)
    ];
    const triangles: Tri[] = [
      [0, 1, 2],
      [3, 4, 5],
    ];
    const raw = HalfEdgeMesh.build({ positions, triangles });
    expect(raw.vertexCount).toBe(6); // unwelded: the shared diagonal is split → all boundary
    expect(raw.boundaryEdgeCount).toBe(6);

    const welded = HalfEdgeMesh.build({ positions, triangles }, { weldEps: 1e-6 });
    expect(welded.vertexCount).toBe(4); // 0≡3, 2≡4 merged
    expect(welded.boundaryEdgeCount).toBe(4); // the diagonal is now a shared interior edge
    expect(welded.edges.find((e) => !e.boundary)).toBeDefined();
  });

  test("non-manifold edge (shared by three faces) is flagged, not crashed", () => {
    const positions: Vec3[] = [
      [0, 0, 0], [1, 0, 0], // shared edge 0–1
      [0, 1, 0],
      [0, 0, 1],
      [0, -1, 0],
    ];
    const triangles: Tri[] = [
      [0, 1, 2],
      [0, 1, 3],
      [0, 1, 4],
    ];
    const m = HalfEdgeMesh.build({ positions, triangles });
    expect(m.nonManifoldEdgeCount).toBe(1);
  });
});
