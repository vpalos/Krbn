// Temporal coherence, step 1: the identity spine (docs/DESIGN.md §3.3.7, §4).
//
// Chains must be canonically oriented from topology (not face-iteration order
// relative to the current view) and carry identity anchors that survive small
// camera motion — the property every later coherence mechanism (dash phase,
// correspondence, hysteresis) keys on.

import { describe, expect, test } from "bun:test";
import type { Camera, Vec3 } from "../src/math/types.js";
import type { Feature } from "../src/pipeline/types.js";
import { HalfEdgeMesh } from "../src/mesh/halfedge.js";
import { chainVertexEdges, silhouetteChains } from "../src/mesh/silhouette.js";
import { Mesh } from "../src/mesh/mesh-source.js";
import { cube, torusMesh, tube, uvSphere } from "../src/mesh/shapes.js";
import { assignDefaultFeatureIds } from "../src/pipeline/identity.js";
import { classifyScene } from "../src/pipeline/visibility.js";
import { sphere } from "../src/primitives/quadric.js";

const ortho = (eye: Vec3, up: Vec3): Camera => ({
  eye,
  target: [0, 0, 0],
  up,
  projection: "orthographic",
  scale: 0.02,
  viewport: { width: 400, height: 400 },
});

/** rotate a point around +z by `a` radians — a small camera jitter */
const rotZ = (p: Vec3, a: number): Vec3 => [
  p[0] * Math.cos(a) - p[1] * Math.sin(a),
  p[0] * Math.sin(a) + p[1] * Math.cos(a),
  p[2],
];

const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

describe("silhouette chains — canonical orientation + identity under camera jitter", () => {
  const m = HalfEdgeMesh.build(torusMesh());
  const eyeA: Vec3 = [0, -10, 3];
  const camA = ortho(eyeA, [0, 0, 1]);
  const camB = ortho(rotZ(eyeA, 0.002), [0, 0, 1]); // ≈0.1° pan

  test("extraction is deterministic (same camera ⇒ identical chains)", () => {
    expect(JSON.stringify(silhouetteChains(m, camA))).toBe(JSON.stringify(silhouetteChains(m, camA)));
  });

  test("keys are unique within a frame", () => {
    const keys = silhouetteChains(m, camA).map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  test("a small pan cannot flip a loop's traversal direction (intrinsic orientation)", () => {
    const A = silhouetteChains(m, camA);
    const B = silhouetteChains(m, camB);
    expect(A.length).toBeGreaterThan(0);
    expect(B.length).toBe(A.length);

    const centroid = (pts: Vec3[]): Vec3 => {
      const c: Vec3 = [0, 0, 0];
      for (const p of pts) {
        c[0] += p[0] / pts.length;
        c[1] += p[1] / pts.length;
        c[2] += p[2] / pts.length;
      }
      return c;
    };
    for (const a of A) {
      // match geometrically (the anchor edge may churn; direction must not)
      const b = B.reduce((best, c) => (dist(centroid(c.pts), centroid(a.pts)) < dist(centroid(best.pts), centroid(a.pts)) ? c : best));
      expect(b.closed).toBe(a.closed);
      expect(dist(centroid(a.pts), centroid(b.pts))).toBeLessThan(0.1);
      // at a shared location, both frames walk the same way
      const i = Math.floor(a.pts.length / 2);
      let j = 0;
      for (let k = 0; k < b.pts.length; k++) if (dist(b.pts[k]!, a.pts[i]!) < dist(b.pts[j]!, a.pts[i]!)) j = k;
      expect(dist(a.pts[i]!, b.pts[j]!)).toBeLessThan(0.2);
      const ta = [a.pts[i + 1]![0] - a.pts[i - 1]![0], a.pts[i + 1]![1] - a.pts[i - 1]![1], a.pts[i + 1]![2] - a.pts[i - 1]![2]];
      const jn = Math.min(j + 1, b.pts.length - 1);
      const jp = Math.max(j - 1, 0);
      const tb = [b.pts[jn]![0] - b.pts[jp]![0], b.pts[jn]![1] - b.pts[jp]![1], b.pts[jn]![2] - b.pts[jp]![2]];
      expect(ta[0]! * tb[0]! + ta[1]! * tb[1]! + ta[2]! * tb[2]!).toBeGreaterThan(0);
    }
  });

  test("a closed loop starts at its anchor edge's crossing", () => {
    for (const c of silhouetteChains(m, camA)) {
      if (!c.closed) continue;
      expect(dist(c.pts[0]!, c.pts[c.pts.length - 1]!)).toBeLessThan(1e-12);
    }
  });
});

describe("vertex chains — canonical form is independent of edge input order", () => {
  const m = HalfEdgeMesh.build(cube());
  const edges = m.creases().map((e) => [e.v0, e.v1] as const);

  test("shuffled + endpoint-swapped input yields byte-identical chains", () => {
    const shuffled = edges
      .slice()
      .reverse()
      .map((e) => [e[1], e[0]] as const);
    expect(JSON.stringify(chainVertexEdges(shuffled))).toBe(JSON.stringify(chainVertexEdges(edges)));
  });

  test("keys are unique (a shared corner does not collide arc identities)", () => {
    const keys = chainVertexEdges(edges).map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("mesh feature ids — stable across frames", () => {
  test("crease/boundary ids are identical from any camera (view-independent)", () => {
    const src = new Mesh(tube());
    const ids = (cam: Camera) =>
      src
        .extractFeatures(cam)
        .filter((f) => f.type !== "silhouette")
        .map((f) => f.id)
        .sort();
    const a = ids(ortho([10, 0, 0], [0, 0, 1]));
    const b = ids(ortho([0, 10, 4], [0, 0, 1]));
    expect(a.length).toBeGreaterThan(0);
    expect(a.every((id) => id !== undefined)).toBe(true);
    expect(b).toEqual(a);
  });

  test("silhouette ids exist, are unique, and are anchored (not extraction-ordered)", () => {
    const src = new Mesh(uvSphere(2, 48, 32));
    const ids = src
      .extractFeatures(ortho([0, -10, 0], [0, 0, 1]))
      .filter((f) => f.type === "silhouette")
      .map((f) => f.id);
    expect(ids.length).toBe(1);
    // anchor-keyed ("owner/silhouette:lo_hi"), so correspondence can match on it
    expect(ids.every((id) => id !== undefined && /\/silhouette:\d+_\d+$/.test(id))).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("default feature ids — deterministic per (owner, type) fallback", () => {
  const feat = (type: Feature["type"], owner: string, id?: string): Feature => ({
    type,
    owner,
    ...(id !== undefined ? { id } : {}),
    curve: { kind: "polyline", pts: [[0, 0, 0], [1, 0, 0]] },
    attrs: {},
  });

  test("counts per (owner, type) and leaves supplied ids alone", () => {
    const feats = [feat("silhouette", "a"), feat("silhouette", "a"), feat("crease", "a"), feat("silhouette", "b"), feat("silhouette", "a", "custom")];
    assignDefaultFeatureIds(feats);
    expect(feats.map((f) => f.id)).toEqual(["a/silhouette:0", "a/silhouette:1", "a/crease:0", "b/silhouette:0", "custom"]);
  });

  test("classifyScene hands every analytic stroke an id, stable across cameras", () => {
    const s = sphere([0, 0, 0], 1, "ball");
    const ids = (cam: Camera) => classifyScene([s], cam).map((st) => st.feature.id).sort();
    const a = ids(ortho([0, 0, 10], [0, 1, 0]));
    expect(a.length).toBeGreaterThan(0);
    expect(a.every((id) => id !== undefined && id.startsWith("ball/"))).toBe(true);
    expect(ids(ortho([0.05, 0.02, 10], [0, 1, 0]))).toEqual(a);
  });
});
