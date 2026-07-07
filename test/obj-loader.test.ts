import { describe, expect, test } from "bun:test";
import type { Vec3 } from "../src/math/types.js";
import { parseOBJ } from "../src/mesh/loaders.js";
import { HalfEdgeMesh } from "../src/mesh/halfedge.js";
import { cube } from "../src/mesh/shapes.js";
import { dot } from "../src/math/vec3.js";

describe("parseOBJ — geometry subset", () => {
  test("reads v and f, 1-based indices", () => {
    const obj = "v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n";
    const mi = parseOBJ(obj);
    expect(mi.positions).toEqual([[0, 0, 0], [1, 0, 0], [0, 1, 0]]);
    expect(mi.triangles).toEqual([[0, 1, 2]]);
  });

  test("all face-vertex forms (v, v/vt, v/vt/vn, v//vn) resolve to the vertex index", () => {
    const verts = "v 0 0 0\nv 1 0 0\nv 0 1 0\n";
    for (const f of ["f 1 2 3", "f 1/1 2/2 3/3", "f 1/1/1 2/2/2 3/3/3", "f 1//1 2//2 3//3"]) {
      const mi = parseOBJ(verts + f + "\n");
      expect(mi.triangles).toEqual([[0, 1, 2]]);
    }
  });

  test("quads and n-gons are fan-triangulated", () => {
    const quad = "v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nf 1 2 3 4\n";
    expect(parseOBJ(quad).triangles).toEqual([[0, 1, 2], [0, 2, 3]]);
    const penta = "v 0 0 0\nv 1 0 0\nv 2 1 0\nv 1 2 0\nv 0 1 0\nf 1 2 3 4 5\n";
    expect(parseOBJ(penta).triangles).toEqual([[0, 1, 2], [0, 2, 3], [0, 3, 4]]);
  });

  test("negative indices count back from the vertices seen so far", () => {
    const obj = "v 0 0 0\nv 1 0 0\nv 0 1 0\nf -3 -2 -1\n";
    expect(parseOBJ(obj).triangles).toEqual([[0, 1, 2]]);
  });

  test("skips vt / vn / g / s / usemtl / mtllib / comments without choking", () => {
    const obj = [
      "# a comment",
      "mtllib hand.mtl",
      "o object",
      "g group",
      "v 0 0 0", "v 1 0 0", "v 0 1 0",
      "vt 0.1 0.2", "vn 0 0 1",
      "usemtl skin", "s 1",
      "f 1/1/1 2/2/2 3/3/3",
    ].join("\n");
    const mi = parseOBJ(obj);
    expect(mi.positions.length).toBe(3);
    expect(mi.triangles).toEqual([[0, 1, 2]]);
  });

  test("drops degenerate (repeated-index and zero-area) faces", () => {
    const obj = "v 0 0 0\nv 1 0 0\nv 0 1 0\nv 2 0 0\nf 1 2 3\nf 1 2 2\nf 1 2 4\n";
    // good, repeated-vertex, and collinear (0,0,0)-(1,0,0)-(2,0,0)
    expect(parseOBJ(obj).triangles).toEqual([[0, 1, 2]]);
  });

  test("empty / geometry-free input → empty MeshInput", () => {
    expect(parseOBJ("# nothing here\no empty\n")).toEqual({ positions: [], triangles: [] });
  });

  test("accepts bytes as well as a string", () => {
    const obj = "v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n";
    expect(parseOBJ(new TextEncoder().encode(obj)).triangles).toEqual([[0, 1, 2]]);
  });
});

describe("parseOBJ — topology round-trip", () => {
  test("an indexed cube needs no welding: parse → closed χ=2, winding preserved", () => {
    const c = cube();
    const obj =
      c.positions.map((p) => `v ${p[0]} ${p[1]} ${p[2]}`).join("\n") +
      "\n" +
      c.triangles.map((t) => `f ${t[0] + 1} ${t[1] + 1} ${t[2] + 1}`).join("\n") +
      "\n";
    const mi = parseOBJ(obj);
    expect(mi.positions.length).toBe(8); // shared vertex table — no soup, no weld
    // built with NO weldEps: OBJ already carries the shared topology
    const he = HalfEdgeMesh.build(mi);
    expect(he.vertexCount).toBe(8);
    expect(he.faceCount).toBe(12);
    expect(he.isClosed).toBe(true);
    expect(he.eulerCharacteristic()).toBe(2);
    for (let f = 0; f < he.faceCount; f++) {
      const c2: Vec3 = he.faceCentroid(f);
      expect(dot(he.faceNormals[f]!, c2)).toBeGreaterThan(0); // outward (winding trusted)
    }
  });
});
