import { describe, expect, test } from "bun:test";
import type { Vec2, Vec3 } from "../src/math/types.js";
import { HalfEdgeMesh, type MeshInput, type Tri } from "../src/mesh/halfedge.js";
import { bumpyBlob, cube, extrude, grid, knotTube, tetrahedron, torusMesh, uvSphere } from "../src/mesh/shapes.js";
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

  test("a triangle that collapses under the weld is dropped, not crashed", () => {
    // A good triangle plus a sliver whose two far corners sit within `eps` of each
    // other: welding merges them, collapsing the sliver to a line. It must be
    // dropped (a degenerate face has no apex — leaving it in crashes the tags).
    const positions: Vec3[] = [
      [0, 0, 0], [1, 0, 0], [0, 1, 0], // good triangle
      [2, 0, 0], [2.0001, 0, 0], [3, 1, 0], // sliver: verts 3,4 coincide under eps
    ];
    const triangles: Tri[] = [
      [0, 1, 2],
      [3, 4, 5],
    ];
    const welded = HalfEdgeMesh.build({ positions, triangles }, { weldEps: 1e-2 });
    expect(welded.faceCount).toBe(1); // the collapsed sliver is gone
    for (let f = 0; f < welded.faceCount; f++) expect(welded.faceAreas[f]!).toBeGreaterThan(0);
  });

  test("organic generators are clean closed manifolds (blob ≅ sphere, knot ≅ torus)", () => {
    const blob = HalfEdgeMesh.build(bumpyBlob(1, 0.2, 4, 5, 24, 16));
    expect(blob.isClosed).toBe(true);
    expect(blob.nonManifoldEdgeCount).toBe(0);
    expect(blob.eulerCharacteristic()).toBe(2); // sphere topology

    const knot = HalfEdgeMesh.build(knotTube(0.3, 90, 10, 0.5));
    expect(knot.isClosed).toBe(true);
    expect(knot.nonManifoldEdgeCount).toBe(0);
    expect(knot.eulerCharacteristic()).toBe(0); // a tube around a closed curve ⇒ torus topology
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

// A many-sided extruded prism: flat top/bottom lids (each a fan) + a smooth,
// finely-facetted wall. At 30° default the rim edges are 90° creases but the wall
// facets (360/nSides ≈ 15°) are not — the archetypal "extruded hard solid".
function prism(nSides: number, r: number, h: number): MeshInput {
  const ring = (z: number): Vec3[] => Array.from({ length: nSides }, (_, i) => {
    const a = (2 * Math.PI * i) / nSides;
    return [r * Math.cos(a), r * Math.sin(a), z] as Vec3;
  });
  const positions: Vec3[] = [...ring(0), ...ring(h)]; // 0..n-1 bottom, n..2n-1 top
  const cB = positions.length; positions.push([0, 0, 0]);
  const cT = positions.length; positions.push([0, 0, h]);
  const triangles: Tri[] = [];
  for (let i = 0; i < nSides; i++) {
    const j = (i + 1) % nSides;
    triangles.push([i, j, nSides + j]); // walls (outward)
    triangles.push([i, nSides + j, nSides + i]);
    triangles.push([cT, nSides + i, nSides + j]); // +z lid fan
    triangles.push([cB, j, i]); // -z lid fan
  }
  return { positions, triangles };
}

describe("HalfEdgeMesh — crease-aware corner normals", () => {
  const n = 24;
  const m = HalfEdgeMesh.build(prism(n, 1, 1)); // default 30° crease
  const topLid = (f: number): boolean => m.triangles[f]!.every((v) => m.positions[v]![2]! > 1 - 1e-9);

  test("a flat lid's corners all read exactly +z (no averaged dome)", () => {
    let lidCorners = 0;
    for (let f = 0; f < m.faceCount; f++) {
      if (!topLid(f)) continue;
      for (let k = 0; k < 3; k++) {
        const cn = m.cornerNormals[3 * f + k]!;
        expect(cn[2]).toBeCloseTo(1, 9);
        lidCorners++;
      }
    }
    expect(lidCorners).toBe(3 * n); // every top-lid corner checked
  });

  test("the shared vertexNormal at a rim vertex is tilted — which is exactly why corner normals are needed", () => {
    // rim (top-ring) vertices are indices n..2n-1; their averaged normal blends the
    // +z lid with the horizontal walls, so it is NOT +z (this is the dome artifact).
    const vn = m.vertexNormals[n]!;
    expect(vn[2]).toBeLessThan(0.95);
    expect(vn[2]).toBeGreaterThan(0); // still upward-ish
  });

  test("at the same rim vertex, the wall-side corner is horizontal and radial", () => {
    let checked = 0;
    for (let f = 0; f < m.faceCount; f++) {
      if (topLid(f)) continue;
      const t = m.triangles[f]!;
      for (let k = 0; k < 3; k++) {
        if (t[k] !== n) continue; // the rim vertex we inspected above
        const cn = m.cornerNormals[3 * f + k]!;
        expect(Math.abs(cn[2])).toBeLessThan(0.2); // wall normal is ~horizontal
        const p = m.positions[n]!;
        const radial = Math.hypot(p[0], p[1]);
        expect((cn[0] * p[0] + cn[1] * p[1]) / radial).toBeGreaterThan(0.9); // points outward
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  test("no creases ⇒ corner normals collapse back to vertexNormals (smooth meshes unchanged)", () => {
    const smooth = HalfEdgeMesh.build(prism(n, 1, 1), { creaseAngle: Math.PI }); // nothing is a crease
    expect(smooth.creases().length).toBe(0);
    for (let f = 0; f < smooth.faceCount; f++) {
      const t = smooth.triangles[f]!;
      for (let k = 0; k < 3; k++) {
        const cn = smooth.cornerNormals[3 * f + k]!;
        const vn = smooth.vertexNormals[t[k]!]!;
        expect(dot(cn, vn)).toBeCloseTo(1, 9); // identical direction
      }
    }
  });
});

describe("HalfEdgeMesh — flat-facet fraction", () => {
  test("a capped prism has a large planar group; organic meshes have none", () => {
    // prism lids are big flat groups; a sphere/torus is curved everywhere
    expect(HalfEdgeMesh.build(prism(24, 1, 1)).flatFacetFraction).toBeGreaterThan(0.15);
    expect(HalfEdgeMesh.build(uvSphere(1, 40, 28)).flatFacetFraction).toBeLessThan(1e-6);
    expect(HalfEdgeMesh.build(torusMesh(1.2, 0.45, 48, 24)).flatFacetFraction).toBeLessThan(1e-6);
  });

  test("an extruded rounded profile is flat-faceted (its lids), a cube's faces too", () => {
    const rr: Vec2[] = [];
    for (const [cx, cy, a0] of [[0.8, -0.4, -Math.PI / 2], [0.8, 0.4, 0], [-0.8, 0.4, Math.PI / 2], [-0.8, -0.4, Math.PI]] as const)
      for (let k = 0; k <= 6; k++) { const a = a0 + (Math.PI / 2) * (k / 6); rr.push([cx + 0.5 * Math.cos(a), cy + 0.5 * Math.sin(a)]); }
    expect(HalfEdgeMesh.build(extrude(rr, 0.6)).flatFacetFraction).toBeGreaterThan(0.15);
    expect(HalfEdgeMesh.build(cube()).flatFacetFraction).toBeGreaterThan(0.1);
  });
});

describe("shapes — extrude", () => {
  test("extruded square is a closed manifold box (χ = 2, 12 triangles)", () => {
    const square: Vec2[] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    const m = HalfEdgeMesh.build(extrude(square, 2));
    expect(m.isClosed).toBe(true);
    expect(m.nonManifoldEdgeCount).toBe(0);
    expect(m.faceCount).toBe(12); // 2 caps × 2 tris + 4 walls × 2 tris
    expect(m.eulerCharacteristic()).toBe(2);
  });

  test("a non-convex L-profile still triangulates to a clean closed solid with flat lids", () => {
    const L: Vec2[] = [[0, 0], [2, 0], [2, 1], [1, 1], [1, 2], [0, 2]];
    const m = HalfEdgeMesh.build(extrude(L, 1));
    expect(m.isClosed).toBe(true);
    expect(m.nonManifoldEdgeCount).toBe(0);
    expect(m.eulerCharacteristic()).toBe(2);
    for (let f = 0; f < m.faceCount; f++) expect(m.faceAreas[f]!).toBeGreaterThan(0); // no degenerate ears
    for (let f = 0; f < m.faceCount; f++) {
      if (!m.triangles[f]!.every((v) => m.positions[v]![2]! > 1 - 1e-9)) continue; // top lid only
      for (let k = 0; k < 3; k++) expect(m.cornerNormals[3 * f + k]![2]).toBeCloseTo(1, 9);
    }
  });

  test("winding-agnostic: a CW profile is re-oriented outward (positive enclosed volume)", () => {
    const cw: Vec2[] = [[-1, -1], [-1, 1], [1, 1], [1, -1]]; // clockwise on purpose
    const m = HalfEdgeMesh.build(extrude(cw, 2));
    let vol = 0; // divergence theorem: ⅓·Σ (centroid · n)·area = volume, > 0 iff normals point outward
    for (let f = 0; f < m.faceCount; f++) {
      const c = m.faceCentroid(f);
      const nrm = m.faceNormals[f]!;
      vol += (c[0] * nrm[0] + c[1] * nrm[1] + c[2] * nrm[2]) * m.faceAreas[f]!;
    }
    expect(vol / 3).toBeGreaterThan(0);
  });
});
