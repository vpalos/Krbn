import { describe, expect, test } from "bun:test";
import type { Hit, Ray, Vec3 } from "../src/math/types.js";
import type { MeshInput } from "../src/mesh/halfedge.js";
import { HalfEdgeMesh } from "../src/mesh/halfedge.js";
import { buildTriangleBVH } from "../src/mesh/bvh.js";
import { Mesh } from "../src/mesh/mesh-source.js";
import { cube, gravitySheet, torusMesh, tube, uvSphere } from "../src/mesh/shapes.js";

/** Deterministic xorshift — never Math.random: determinism is a project value and a
 *  flaky parity failure would be unreproducible. */
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

function boundsOf(mi: MeshInput): { center: Vec3; radius: number } {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const p of mi.positions)
    for (let i = 0; i < 3; i++) {
      if (p[i]! < min[i]!) min[i] = p[i]!;
      if (p[i]! > max[i]!) max[i] = p[i]!;
    }
  const center: Vec3 = [(min[0]! + max[0]!) / 2, (min[1]! + max[1]!) / 2, (min[2]! + max[2]!) / 2];
  const radius = Math.hypot(max[0]! - min[0]!, max[1]! - min[1]!, max[2]! - min[2]!) / 2 || 1;
  return { center, radius };
}

const build = (mi: MeshInput) => {
  const he = HalfEdgeMesh.build(mi, {});
  const { center, radius } = boundsOf(mi);
  return buildTriangleBVH(he, {
    min: [center[0] - radius, center[1] - radius, center[2] - radius],
    max: [center[0] + radius, center[1] + radius, center[2] + radius],
  });
};

/** Ground truth for Claim A: every face whose *padded* box the infinite line meets.
 *  Computed by brute force, independent of the tree. */
function bruteCandidates(mi: MeshInput, ray: Ray): number[] {
  const he = HalfEdgeMesh.build(mi, {});
  const out: number[] = [];
  for (let f = 0; f < he.faceCount; f++) {
    const t = he.triangles[f]!;
    const a = he.positions[t[0]]!;
    const b = he.positions[t[1]]!;
    const c = he.positions[t[2]]!;
    let tmin = -Infinity;
    let tmax = Infinity;
    let miss = false;
    for (let k = 0; k < 3 && !miss; k++) {
      const lo = Math.min(a[k]!, b[k]!, c[k]!);
      const hi = Math.max(a[k]!, b[k]!, c[k]!);
      if (ray.dir[k] === 0) {
        if (ray.origin[k]! < lo || ray.origin[k]! > hi) miss = true;
      } else {
        const inv = 1 / ray.dir[k]!;
        const t0 = (lo - ray.origin[k]!) * inv;
        const t1 = (hi - ray.origin[k]!) * inv;
        const near = Math.min(t0, t1);
        const far = Math.max(t0, t1);
        if (near > tmin) tmin = near;
        if (far < tmax) tmax = far;
      }
    }
    if (!miss && tmin <= tmax) out.push(f);
  }
  return out;
}

const SHAPES: Array<[string, MeshInput]> = [
  ["cube", cube()],
  ["uvSphere", uvSphere(2, 32, 24)],
  ["torusMesh", torusMesh(1.3, 0.5, 44, 22)],
  ["tube", tube(1.5, 3, 32, 8)],
  ["gravitySheet", gravitySheet(3, 24, 1.7, 0.75)],
];

describe("BVH — structure", () => {
  for (const [name, mi] of SHAPES) {
    test(`${name}: every face appears exactly once across leaves`, () => {
      const bvh = build(mi);
      const he = HalfEdgeMesh.build(mi, {});
      const seen = new Int32Array(he.faceCount);
      let leaves = 0;
      for (let n = 0; n < bvh.nodeCount; n++) {
        const c = bvh.nodeCounts[n]!;
        if (c === 0) continue;
        leaves++;
        for (let i = bvh.nodeStart[n]!; i < bvh.nodeStart[n]! + c; i++) seen[bvh.primIndex[i]!]!++;
      }
      expect(leaves).toBeGreaterThan(0);
      for (let f = 0; f < he.faceCount; f++) expect(seen[f]).toBe(1);
    });

    test(`${name}: every interior node's box contains both children's boxes`, () => {
      const bvh = build(mi);
      const B = bvh.nodeBounds;
      const contains = (p: number, c: number): boolean =>
        B[6 * p]! <= B[6 * c]! + 1e-12 &&
        B[6 * p + 1]! <= B[6 * c + 1]! + 1e-12 &&
        B[6 * p + 2]! <= B[6 * c + 2]! + 1e-12 &&
        B[6 * p + 3]! >= B[6 * c + 3]! - 1e-12 &&
        B[6 * p + 4]! >= B[6 * c + 4]! - 1e-12 &&
        B[6 * p + 5]! >= B[6 * c + 5]! - 1e-12;
      for (let n = 0; n < bvh.nodeCount; n++) {
        if (bvh.nodeCounts[n] !== 0) continue;
        expect(contains(n, n + 1)).toBe(true);
        expect(contains(n, bvh.nodeStart[n]!)).toBe(true);
      }
    });

    test(`${name}: leaf boxes contain their triangles' vertices, and depth is sane`, () => {
      const bvh = build(mi);
      const he = HalfEdgeMesh.build(mi, {});
      const B = bvh.nodeBounds;
      for (let n = 0; n < bvh.nodeCount; n++) {
        const c = bvh.nodeCounts[n]!;
        if (c === 0) continue;
        for (let i = bvh.nodeStart[n]!; i < bvh.nodeStart[n]! + c; i++) {
          const t = he.triangles[bvh.primIndex[i]!]!;
          for (const vi of t) {
            const p = he.positions[vi]!;
            for (let k = 0; k < 3; k++) {
              expect(p[k]!).toBeGreaterThanOrEqual(B[6 * n + k]!);
              expect(p[k]!).toBeLessThanOrEqual(B[6 * n + 3 + k]!);
            }
          }
        }
      }
      // O(log F) on real meshes; the bound is loose on purpose — this catches a
      // degenerate near-linear tree, not a constant-factor regression.
      expect(bvh.maxDepth).toBeLessThan(4 * Math.ceil(Math.log2(he.faceCount + 2)) + 8);
    });
  }

  test("build is deterministic: two builds produce identical typed arrays", () => {
    for (const [, mi] of SHAPES) {
      const a = build(mi);
      const b = build(mi);
      expect(a.nodeCount).toBe(b.nodeCount);
      expect(a.maxDepth).toBe(b.maxDepth);
      expect(Array.from(a.primIndex)).toEqual(Array.from(b.primIndex));
      expect(Array.from(a.nodeStart)).toEqual(Array.from(b.nodeStart));
      expect(Array.from(a.nodeCounts)).toEqual(Array.from(b.nodeCounts));
      expect(Array.from(a.nodeBounds)).toEqual(Array.from(b.nodeBounds));
    }
  });
});

describe("BVH — degenerate inputs", () => {
  test("a mesh with no faces yields an empty candidate set, not a crash", () => {
    const bvh = build({ positions: [], triangles: [] });
    expect(bvh.candidates({ origin: [0, 0, 5], dir: [0, 0, -1] })).toHaveLength(0);
  });

  test("a single triangle is found by a ray through it and missed by one beside it", () => {
    const mi: MeshInput = { positions: [[0, 0, 0], [1, 0, 0], [0, 1, 0]], triangles: [[0, 1, 2]] };
    const bvh = build(mi);
    expect(Array.from(bvh.candidates({ origin: [0.25, 0.25, 5], dir: [0, 0, -1] }))).toEqual([0]);
    expect(bvh.candidates({ origin: [9, 9, 5], dir: [0, 0, -1] })).toHaveLength(0);
  });

  test("coincident-centroid soup terminates and keeps leaves bounded", () => {
    // 64 identical triangles: every centroid coincides, so no SAH split exists on
    // any axis. Without the forced median-by-index fallback this either recurses
    // forever or collapses into one giant leaf (i.e. back to the linear scan).
    const positions: Vec3[] = [[0, 0, 0], [1, 0, 0], [0, 1, 0]];
    const triangles = Array.from({ length: 64 }, () => [0, 1, 2] as const);
    const bvh = build({ positions, triangles });
    const cands = bvh.candidates({ origin: [0.25, 0.25, 5], dir: [0, 0, -1] });
    expect(cands).toHaveLength(64);
    // all 64 must still be offered, in ascending order
    expect(Array.from(cands)).toEqual(Array.from({ length: 64 }, (_, i) => i));
  });
});

describe("BVH — candidate set (Claims A and B)", () => {
  for (const [name, mi] of SHAPES) {
    test(`${name}: candidates are a superset of brute force, ascending, over random rays`, () => {
      const bvh = build(mi);
      const { center, radius } = boundsOf(mi);
      const r = rng(0x5eed + name.length);
      for (let i = 0; i < 400; i++) {
        const dir = normalizeV([r() * 2 - 1, r() * 2 - 1, r() * 2 - 1]);
        const origin: Vec3 = [
          center[0] + (r() * 2 - 1) * radius * 2 - dir[0] * radius * 3,
          center[1] + (r() * 2 - 1) * radius * 2 - dir[1] * radius * 3,
          center[2] + (r() * 2 - 1) * radius * 2 - dir[2] * radius * 3,
        ];
        const cands = Array.from(bvh.candidates({ origin, dir }));
        // Claim B: ascending
        for (let k = 1; k < cands.length; k++) expect(cands[k]!).toBeGreaterThan(cands[k - 1]!);
        // Claim A: superset of every face whose exact box the line meets
        const brute = bruteCandidates(mi, { origin, dir });
        const set = new Set(cands);
        for (const f of brute) expect(set.has(f)).toBe(true);
      }
    });
  }

  test("axis-parallel and -0 directions are handled (the NaN slab case)", () => {
    // 0 * ±Infinity is the only NaN source in a slab test, and it needs d[k]===0
    // AND the numerator exactly 0 — i.e. a ray grazing a box face. cube() is
    // axis-aligned on exact ±1/0 coordinates, so these rays hit it head-on.
    const mi = cube();
    const bvh = build(mi);
    const dirs: Vec3[] = [
      [0, 0, -1], [0, 0, 1], [0, 1, 0], [0, -1, 0], [-1, 0, 0], [1, 0, 0],
      [-0, -0, -1], [0, -0, 1],
    ];
    const he = HalfEdgeMesh.build(mi, {});
    // origins that graze exactly along box faces / edges / corners
    const coords = [-1, -0.5, 0, 0.5, 1];
    for (const dir of dirs) {
      for (const a of coords)
        for (const b of coords) {
          const origin: Vec3 = dir[2] !== 0 ? [a, b, 5] : dir[1] !== 0 ? [a, 5, b] : [5, a, b];
          const ray = { origin, dir };
          const cands = new Set(bvh.candidates(ray));
          for (const f of bruteCandidates(mi, ray)) expect(cands.has(f)).toBe(true);
        }
    }
    expect(he.faceCount).toBeGreaterThan(0);
  });

  test("a zero direction degenerates to a point query without NaN or crash", () => {
    // All three axes take the parallel branch, so the 'line' is just the origin
    // point. Möller–Trumbore rejects every face here anyway (cross([0,0,0], e2) is
    // zero ⇒ a === 0 ⇒ |a| < EPS_ABS), so Claim A holds whatever we return — the
    // property under test is that the slab test stays finite and well-behaved
    // rather than producing NaN and silently swallowing nodes.
    const bvh = build(cube());
    const inside = bvh.candidates({ origin: [0, 0, 0], dir: [0, 0, 0] });
    expect(inside).toHaveLength(0); // interior point touches no face's box
    // A point sitting on a face does land in that face's box.
    const onFace = bvh.candidates({ origin: [0, 0, 1], dir: [0, 0, 0] });
    expect(onFace.length).toBeGreaterThan(0);
    for (let k = 1; k < onFace.length; k++) expect(onFace[k]!).toBeGreaterThan(onFace[k - 1]!);
  });
});

function normalizeV(v: readonly number[]): Vec3 {
  const l = Math.hypot(v[0]!, v[1]!, v[2]!) || 1;
  return [v[0]! / l, v[1]! / l, v[2]! / l];
}

// ---------------------------------------------------------------------------
// End-to-end parity: Mesh.raycast accelerated vs brute force.
//
// This is the claim that actually matters — the candidate-set tests above prove
// the filter is sound, these prove the *output* is identical. Per-field `toBe`
// (Object.is), never toEqual: toEqual treats +0 and -0 as equal and would mask a
// genuine divergence in a normal or a t value.
// ---------------------------------------------------------------------------
function expectSameHits(got: Hit[], want: Hit[], msg: string): void {
  expect(`${msg}: ${got.length} hits`).toBe(`${msg}: ${want.length} hits`);
  for (let i = 0; i < want.length; i++) {
    const a = got[i]!;
    const b = want[i]!;
    expect(a.t).toBe(b.t);
    expect(a.frontFacing).toBe(b.frontFacing);
    for (let k = 0; k < 3; k++) {
      expect(a.point[k]!).toBe(b.point[k]!);
      expect(a.normal[k]!).toBe(b.normal[k]!);
    }
  }
}

describe("Mesh.raycast — BVH parity with the linear scan", () => {
  // Coincident-geometry stress case. Every triangle has a reversed twin at the
  // same position, which (a) forces the SAH's no-valid-split path a lot, and (b)
  // is the most likely source of an exact `t` tie between two *distinct* faces.
  //
  // On a tie the stable final sort keeps insertion order, so the returned normal
  // depends on which face was visited first — and surfaceHit() returns the first
  // hit past the depth floor, so a permuted tie would change a tone and the SVG.
  // Claim B is what rules that out, and it is asserted directly by the
  // candidates-are-ascending test above; this case just exercises the geometry
  // end-to-end. (A tie between faces with *identical* vertex order is
  // unobservable — bit-identical arithmetic gives bit-identical Hits — so no test
  // can distinguish their order, and none needs to.)
  const soup = (): MeshInput => {
    const base = torusMesh(1.2, 0.45, 16, 10);
    return {
      positions: base.positions,
      triangles: [...base.triangles, ...base.triangles.map((t) => [t[0], t[2], t[1]] as const)],
    };
  };

  const CASES: Array<[string, MeshInput]> = [...SHAPES, ["duplicate-face soup", soup()]];

  for (const [name, mi] of CASES) {
    const fast = new Mesh(mi);
    const slow = new Mesh(mi, { bvh: false });
    const { center, radius } = boundsOf(mi);

    test(`${name}: identical hits over seeded random rays`, () => {
      const r = rng(0xbeef + name.length);
      for (let i = 0; i < 300; i++) {
        const dir = normalizeV([r() * 2 - 1, r() * 2 - 1, r() * 2 - 1]);
        const origin: Vec3 = [
          center[0] - dir[0] * radius * 3 + (r() * 2 - 1) * radius,
          center[1] - dir[1] * radius * 3 + (r() * 2 - 1) * radius,
          center[2] - dir[2] * radius * 3 + (r() * 2 - 1) * radius,
        ];
        expectSameHits(fast.raycast({ origin, dir }), slow.raycast({ origin, dir }), `${name} ray ${i}`);
      }
    });

    test(`${name}: identical hits from an origin inside the mesh`, () => {
      const r = rng(0x1234);
      for (let i = 0; i < 60; i++) {
        const dir = normalizeV([r() * 2 - 1, r() * 2 - 1, r() * 2 - 1]);
        expectSameHits(
          fast.raycast({ origin: center, dir }),
          slow.raycast({ origin: center, dir }),
          `${name} inside ${i}`,
        );
      }
    });

    test(`${name}: identical hits for axis-parallel rays (incl. -0 directions)`, () => {
      const dirs: Vec3[] = [
        [0, 0, -1], [0, 0, 1], [0, 1, 0], [0, -1, 0], [-1, 0, 0], [1, 0, 0],
        [-0, -0, -1], [0, -0, 1], [-0, 1, -0],
      ];
      const r = rng(0xabcd);
      for (const dir of dirs) {
        for (let i = 0; i < 24; i++) {
          const origin: Vec3 = [
            center[0] + (r() * 2 - 1) * radius,
            center[1] + (r() * 2 - 1) * radius,
            center[2] + (r() * 2 - 1) * radius,
          ];
          expectSameHits(
            fast.raycast({ origin, dir }),
            slow.raycast({ origin, dir }),
            `${name} axis ${dir.join(",")} ${i}`,
          );
        }
      }
    });

    test(`${name}: identical hits aimed exactly at vertices and edge midpoints`, () => {
      const he = HalfEdgeMesh.build(mi, {});
      const targets: Vec3[] = [];
      const step = Math.max(1, Math.floor(he.vertexCount / 40));
      for (let v = 0; v < he.vertexCount; v += step) targets.push(he.positions[v]!);
      for (let e = 0; e < Math.min(he.edgeCount, 40); e++) {
        const info = he.edges[e]!;
        const a = he.positions[info.v0]!;
        const b = he.positions[info.v1]!;
        targets.push([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]);
      }
      for (const target of targets) {
        // cast from outside the bounding sphere, straight at the exact feature
        const dir = normalizeV([target[0] - center[0], target[1] - center[1], target[2] - center[2] - radius * 4]);
        const origin: Vec3 = [center[0], center[1], center[2] + radius * 4];
        expectSameHits(
          fast.raycast({ origin, dir }),
          slow.raycast({ origin, dir }),
          `${name} vertex/edge ${target.join(",")}`,
        );
      }
    });

    test(`${name}: identical hits for coplanar rays along face edges`, () => {
      const he = HalfEdgeMesh.build(mi, {});
      const step = Math.max(1, Math.floor(he.faceCount / 30));
      for (let f = 0; f < he.faceCount; f += step) {
        const t = he.triangles[f]!;
        const a = he.positions[t[0]]!;
        const b = he.positions[t[1]]!;
        const dir = normalizeV([b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
        expectSameHits(fast.raycast({ origin: a, dir }), slow.raycast({ origin: a, dir }), `${name} coplanar f${f}`);
      }
    });

    test(`${name}: negative-t hits agree and are actually produced`, () => {
      // raycast has no t>=0 filter: hits behind the origin are part of its
      // contract. Cast from past the mesh pointing away — every hit is negative-t.
      // Guards against a future tMin=0 slab clip silently dropping them.
      const r = rng(0x9999);
      let sawNegative = 0;
      for (let i = 0; i < 80; i++) {
        const dir = normalizeV([r() * 2 - 1, r() * 2 - 1, r() * 2 - 1]);
        const origin: Vec3 = [
          center[0] + dir[0] * radius * 3,
          center[1] + dir[1] * radius * 3,
          center[2] + dir[2] * radius * 3,
        ];
        const a = fast.raycast({ origin, dir });
        expectSameHits(a, slow.raycast({ origin, dir }), `${name} neg-t ${i}`);
        if (a.some((h) => h.t < 0)) sawNegative++;
      }
      expect(sawNegative).toBeGreaterThan(0);
    });
  }

  test("grazing rays tangent to the silhouette agree", () => {
    // The pad exists for exactly these: a line that misses a triangle's exact box
    // by an ulp, where MT's rounded u/v may still accept.
    const mi = uvSphere(2, 32, 24);
    const fast = new Mesh(mi);
    const slow = new Mesh(mi, { bvh: false });
    const r = rng(0x7777);
    for (let i = 0; i < 500; i++) {
      // aim at the sphere's limb: offset ~exactly the radius from the axis
      const ang = r() * Math.PI * 2;
      const off = 2 + (r() * 2 - 1) * 1e-9; // straddle the tangent to within an ulp band
      const origin: Vec3 = [Math.cos(ang) * off, Math.sin(ang) * off, 10];
      const dir: Vec3 = [0, 0, -1];
      expectSameHits(fast.raycast({ origin, dir }), slow.raycast({ origin, dir }), `grazing ${i}`);
    }
  });
});
