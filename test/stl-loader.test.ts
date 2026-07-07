import { describe, expect, test } from "bun:test";
import type { Vec3 } from "../src/math/types.js";
import { parseSTL } from "../src/mesh/loaders.js";
import { HalfEdgeMesh, type MeshInput } from "../src/mesh/halfedge.js";
import { cube } from "../src/mesh/shapes.js";
import { cross, dot, length, sub } from "../src/math/vec3.js";

// --- fixtures -------------------------------------------------------------

/** Encode facets as a binary STL. `header` fills the 80-byte preamble — used to
 *  prove detection does NOT key on the header text (the "solid …" trap). */
function encodeBinary(facets: { normal: Vec3; tri: [Vec3, Vec3, Vec3] }[], header = "krbn test"): ArrayBuffer {
  const buf = new ArrayBuffer(84 + 50 * facets.length);
  const dv = new DataView(buf);
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < Math.min(80, header.length); i++) bytes[i] = header.charCodeAt(i);
  dv.setUint32(80, facets.length, true);
  let o = 84;
  const wv = (v: Vec3) => {
    dv.setFloat32(o, v[0], true);
    dv.setFloat32(o + 4, v[1], true);
    dv.setFloat32(o + 8, v[2], true);
    o += 12;
  };
  for (const f of facets) {
    wv(f.normal);
    wv(f.tri[0]);
    wv(f.tri[1]);
    wv(f.tri[2]);
    dv.setUint16(o, 0, true);
    o += 2;
  }
  return buf;
}

const asciiFacet = (n: Vec3, a: Vec3, b: Vec3, c: Vec3): string =>
  `  facet normal ${n[0]} ${n[1]} ${n[2]}\n    outer loop\n      vertex ${a[0]} ${a[1]} ${a[2]}\n      vertex ${b[0]} ${b[1]} ${b[2]}\n      vertex ${c[0]} ${c[1]} ${c[2]}\n    endloop\n  endfacet`;
const asciiSTL = (facets: string[]): string => `solid test\n${facets.join("\n")}\nendsolid test\n`;

/** geometric (CCW) normal of a triangle */
const geoNormal = (a: Vec3, b: Vec3, c: Vec3): Vec3 => cross(sub(b, a), sub(c, a));

// --- tests ----------------------------------------------------------------

describe("parseSTL — binary", () => {
  test("round-trips a single facet's vertices", () => {
    const a: Vec3 = [0, 0, 0];
    const b: Vec3 = [1, 0, 0];
    const c: Vec3 = [0, 1, 0];
    const mi = parseSTL(encodeBinary([{ normal: geoNormal(a, b, c), tri: [a, b, c] }]));
    expect(mi.positions).toEqual([a, b, c]);
    expect(mi.triangles).toEqual([[0, 1, 2]]);
  });

  test("detection keys on the size formula, not the header — a 'solid …' header stays binary", () => {
    // The classic trap: binary exporters write "solid …" into the 80-byte header.
    const a: Vec3 = [0, 0, 0];
    const b: Vec3 = [2, 0, 0];
    const c: Vec3 = [0, 2, 0];
    const mi = parseSTL(encodeBinary([{ normal: geoNormal(a, b, c), tri: [a, b, c] }], "solid TRAP created by some exporter"));
    expect(mi.triangles.length).toBe(1); // parsed as binary, not mis-read as ASCII
    expect(mi.positions).toEqual([a, b, c]);
  });

  test("empty (zero-facet) binary → empty MeshInput", () => {
    const mi = parseSTL(encodeBinary([]));
    expect(mi.positions).toEqual([]);
    expect(mi.triangles).toEqual([]);
  });

  test("accepts a Uint8Array as well as an ArrayBuffer", () => {
    const a: Vec3 = [0, 0, 0];
    const b: Vec3 = [1, 0, 0];
    const c: Vec3 = [0, 1, 0];
    const buf = encodeBinary([{ normal: geoNormal(a, b, c), tri: [a, b, c] }]);
    expect(parseSTL(new Uint8Array(buf)).triangles.length).toBe(1);
  });
});

describe("parseSTL — ASCII", () => {
  test("round-trips a single facet (scientific notation included)", () => {
    const a: Vec3 = [0, 0, 0];
    const b: Vec3 = [1, 0, 0];
    const c: Vec3 = [0, 1, 0];
    const text = asciiSTL([`  facet normal 0.0e+00 0.0e+00 1.0e+00\n    outer loop\n      vertex 0 0 0\n      vertex 1 0 0\n      vertex 0 1 0\n    endloop\n  endfacet`]);
    const mi = parseSTL(text);
    expect(mi.positions).toEqual([a, b, c]);
    expect(mi.triangles).toEqual([[0, 1, 2]]);
  });

  test("parses a two-facet solid", () => {
    const t1 = asciiFacet([0, 0, 1], [0, 0, 0], [1, 0, 0], [0, 1, 0]);
    const t2 = asciiFacet([0, 0, 1], [1, 0, 0], [1, 1, 0], [0, 1, 0]);
    const mi = parseSTL(asciiSTL([t1, t2]));
    expect(mi.triangles.length).toBe(2);
    expect(mi.positions.length).toBe(6);
  });

  test("empty / whitespace ASCII → empty MeshInput", () => {
    expect(parseSTL("solid empty\nendsolid empty\n")).toEqual({ positions: [], triangles: [] });
  });
});

describe("parseSTL — robustness", () => {
  test("drops degenerate (zero-area) facets", () => {
    const good = asciiFacet([0, 0, 1], [0, 0, 0], [1, 0, 0], [0, 1, 0]);
    const degenerate = asciiFacet([0, 0, 1], [0, 0, 0], [1, 0, 0], [1, 0, 0]); // two coincident verts
    const collinear = asciiFacet([0, 0, 1], [0, 0, 0], [1, 0, 0], [2, 0, 0]); // collinear → zero area
    const mi = parseSTL(asciiSTL([good, degenerate, collinear]));
    expect(mi.triangles.length).toBe(1); // only the good facet survives
  });

  test("flips a triangle whose winding disagrees with its stored normal", () => {
    // Vertices wound CW (geometric normal points −z) but the facet declares +z.
    const a: Vec3 = [0, 0, 0];
    const b: Vec3 = [0, 1, 0];
    const c: Vec3 = [1, 0, 0];
    expect(geoNormal(a, b, c)[2]).toBeLessThan(0); // as-authored winding faces −z
    const mi = parseSTL(asciiSTL([asciiFacet([0, 0, 1], a, b, c)]));
    const [i, j, k] = mi.triangles[0]!;
    const repaired = geoNormal(mi.positions[i]!, mi.positions[j]!, mi.positions[k]!);
    expect(repaired[2]).toBeGreaterThan(0); // repaired to agree with the stored +z normal
  });

  test("keeps winding when no facet normal is stored (0,0,0)", () => {
    const a: Vec3 = [0, 0, 0];
    const b: Vec3 = [1, 0, 0];
    const c: Vec3 = [0, 1, 0];
    const mi = parseSTL(asciiSTL([asciiFacet([0, 0, 0], a, b, c)]));
    expect(mi.triangles).toEqual([[0, 1, 2]]); // untouched — no normal to disagree with
  });
});

describe("parseSTL — topology round-trip", () => {
  // Encode a real closed mesh, scrambling half the windings but keeping each
  // facet's true outward normal; parsing must repair winding AND welding must
  // reconstruct the shared corners → a watertight, outward-oriented cube.
  function cubeAsFacets(mi: MeshInput, scramble: boolean): { normal: Vec3; tri: [Vec3, Vec3, Vec3] }[] {
    return mi.triangles.map((t, f) => {
      const a = mi.positions[t[0]]!;
      const b = mi.positions[t[1]]!;
      const c = mi.positions[t[2]]!;
      const outward = geoNormal(a, b, c); // cube() is already CCW-outward
      // reverse the winding of every other facet; the stored normal stays correct
      return scramble && f % 2 === 0 ? { normal: outward, tri: [a, c, b] as [Vec3, Vec3, Vec3] } : { normal: outward, tri: [a, b, c] as [Vec3, Vec3, Vec3] };
    });
  }

  test("cube → binary STL → parse → weld reconstructs a closed χ=2 mesh, winding repaired", () => {
    const mi = parseSTL(encodeBinary(cubeAsFacets(cube(), /* scramble */ true)));
    expect(mi.positions.length).toBe(36); // unwelded soup: 12 triangles × 3
    const he = HalfEdgeMesh.build(mi, { weldEps: 1e-3 });
    expect(he.vertexCount).toBe(8);
    expect(he.faceCount).toBe(12);
    expect(he.isClosed).toBe(true);
    expect(he.eulerCharacteristic()).toBe(2);
    // every face normal points outward from the centre (winding was repaired)
    for (let f = 0; f < he.faceCount; f++) {
      const n = he.faceNormals[f]!;
      const c = he.faceCentroid(f);
      expect(dot(n, c)).toBeGreaterThan(0);
      expect(length(n)).toBeGreaterThan(0.9); // non-degenerate
    }
  });
});
