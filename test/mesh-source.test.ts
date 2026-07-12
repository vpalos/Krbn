import { describe, expect, test } from "bun:test";
import type { Camera, Vec3 } from "../src/math/types.js";
import type { MeshInput, Tri } from "../src/mesh/halfedge.js";
import { Mesh } from "../src/mesh/mesh-source.js";
import { cube, tube, uvSphere } from "../src/mesh/shapes.js";
import { Point } from "../src/primitives/point.js";
import { classifyFeature, sceneScale } from "../src/pipeline/visibility.js";
import { Scene } from "../src/scene/scene.js";
import { torusMesh } from "../src/mesh/shapes.js";
import { dot } from "../src/math/vec3.js";

describe("Mesh — raycast", () => {
  const m = new Mesh(uvSphere(2, 32, 24));

  test("an off-axis ray hits the sphere twice; entry is front-facing with an outward normal", () => {
    const hits = m.raycast({ origin: [0.5, 0, 10], dir: [0, 0, -1] });
    expect(hits.length).toBeGreaterThanOrEqual(2);
    const first = hits[0]!;
    expect(Math.hypot(first.point[0], first.point[1], first.point[2])).toBeCloseTo(2, 1); // on the sphere
    expect(first.point[2]).toBeGreaterThan(0); // near cap
    expect(first.frontFacing).toBe(true);
    expect(dot(first.normal, first.point)).toBeGreaterThan(0); // outward
    expect(hits[hits.length - 1]!.frontFacing).toBe(false); // exit
  });

  test("a ray missing the sphere returns nothing", () => {
    expect(m.raycast({ origin: [5, 5, 10], dir: [0, 0, -1] })).toHaveLength(0);
  });

  test("the flat lid of an extruded solid shades flat (crease-aware normals, no dome)", () => {
    // 24-sided prism: flat top lid + smooth wall, rim is a 90° crease. A ray dropped
    // onto the lid near its rim must report a +z normal, not a rim-averaged tilt —
    // otherwise the lid hatches like a sliced dome (the reported artifact).
    const n = 24, r = 1, h = 1;
    const ring = (z: number): Vec3[] => Array.from({ length: n }, (_, i) => {
      const a = (2 * Math.PI * i) / n;
      return [r * Math.cos(a), r * Math.sin(a), z] as Vec3;
    });
    const positions: Vec3[] = [...ring(0), ...ring(h)];
    const cB = positions.length; positions.push([0, 0, 0]);
    const cT = positions.length; positions.push([0, 0, h]);
    const triangles: Tri[] = [];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      triangles.push([i, j, n + j]);
      triangles.push([i, n + j, n + i]);
      triangles.push([cT, n + i, n + j]);
      triangles.push([cB, j, i]);
    }
    const prism: MeshInput = { positions, triangles };
    const tile = new Mesh(prism);
    const hit = tile.raycast({ origin: [0.85, 0, 5], dir: [0, 0, -1] })[0]!; // near the rim
    expect(hit.frontFacing).toBe(true);
    expect(hit.point[2]).toBeCloseTo(h, 6); // landed on the lid
    expect(hit.normal[2]).toBeCloseTo(1, 6); // flat, not domed
  });
});

describe("Mesh — features", () => {
  const front: Camera = {
    eye: [0, 0, 10],
    target: [0, 0, 0],
    up: [0, 1, 0],
    projection: "orthographic",
    scale: 0.02,
    viewport: { width: 400, height: 400 },
  };

  test("a smooth sphere yields a silhouette feature (no creases/boundaries)", () => {
    const feats = new Mesh(uvSphere(2, 32, 24)).extractFeatures(front);
    expect(feats.some((f) => f.type === "silhouette")).toBe(true);
    expect(feats.some((f) => f.type === "crease")).toBe(false);
    expect(feats.some((f) => f.type === "boundary")).toBe(false);
  });

  test("an open tube yields silhouettes and boundary loops", () => {
    // view from the side (perpendicular to the axis) so the tube has a real
    // silhouette — viewed down the axis the whole lateral surface grazes (g≡0)
    const side: Camera = { ...front, eye: [10, 0, 1], up: [0, 0, 1] };
    const feats = new Mesh(tube(1.5, 3, 32, 8)).extractFeatures(side);
    expect(feats.some((f) => f.type === "silhouette")).toBe(true);
    expect(feats.filter((f) => f.type === "boundary").length).toBeGreaterThanOrEqual(2); // top + bottom rims
  });

  test("a cube's sharp edges come through as crease features", () => {
    const feats = new Mesh(cube()).extractFeatures(front);
    expect(feats.some((f) => f.type === "crease")).toBe(true);
  });

  test("a faceted cube's hidden-line matches raycast ground truth (crisp boundary, not smeared)", () => {
    // A chunky faceted mesh must NOT use the smooth-mesh self-tolerance (~0.75×edge
    // ≈ most of a face), which used to smear the visible/hidden boundary and flip
    // whole edges. With flat facets the raycast is exact, so every crease edge's
    // classification must track true occlusion at every point along it.
    const cam: Camera = {
      eye: [3.8, 3.0, 2.5],
      target: [0, 0, 0],
      up: [0, 0, 1],
      projection: "perspective",
      scale: Math.PI / 5.0,
      viewport: { width: 430, height: 380 },
    };
    const m = new Mesh(cube());
    const scale = sceneScale([m]);
    // ground truth: a point is hidden iff the eye→point ray hits the cube nearer
    const hidden = (p: readonly [number, number, number]): boolean => {
      const d = [p[0] - cam.eye[0], p[1] - cam.eye[1], p[2] - cam.eye[2]] as const;
      const L = Math.hypot(d[0], d[1], d[2]);
      const dir: [number, number, number] = [d[0] / L, d[1] / L, d[2] / L];
      for (const h of m.raycast({ origin: cam.eye, dir })) if (h.t > 1e-4 && h.t < L - 2e-2) return true;
      return false;
    };
    const creases = m.extractFeatures(cam).filter((f) => f.type === "crease");
    expect(creases.length).toBe(12);
    let mismatches = 0;
    for (const f of creases) {
      if (f.curve.kind !== "polyline") continue;
      const a = f.curve.pts[0]!;
      const b = f.curve.pts[f.curve.pts.length - 1]!;
      const n = f.curve.pts.length - 1;
      const stroke = classifyFeature(f, cam, [m], scale, m);
      const stateAt = (t: number): boolean => {
        for (const iv of stroke.intervals) if (t >= iv.t0 - 1e-9 && t <= iv.t1 + 1e-9) return iv.visible;
        return true;
      };
      for (let k = 1; k < 8; k++) {
        const s = k / 8;
        const p: [number, number, number] = [a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s, a[2] + (b[2] - a[2]) * s];
        const classifiedVisible = stateAt(s * n);
        if (classifiedVisible === hidden(p)) mismatches++; // visible where truly hidden or vice-versa
      }
    }
    expect(mismatches).toBe(0);
  });
});

describe("Mesh — renders through the pipeline with visibility", () => {
  const front: Camera = {
    eye: [0, 0, 10],
    target: [0, 0, 0],
    up: [0, 1, 0],
    projection: "orthographic",
    scale: 0.02,
    viewport: { width: 400, height: 400 },
  };

  test("a sphere mesh emits silhouette strokes through a Scene", () => {
    const scene = new Scene();
    scene.add(new Mesh(uvSphere(2, 24, 16)));
    const res = scene.render(front);
    expect(res.strokes.some((s) => s.feature.type === "silhouette")).toBe(true);
    expect(res.renderStrokes.length).toBeGreaterThan(0);
    expect(res.svg).toContain("<svg");
  });

  test("mesh-visibility robustness: the exposed outer silhouette of a torus is essentially all-visible", () => {
    const cam: Camera = {
      eye: [3.4, 2.6, 2.3],
      target: [0, 0, 0],
      up: [0, 0, 1],
      projection: "perspective",
      scale: Math.PI / 4.4,
      viewport: { width: 400, height: 360 },
    };
    const m = new Mesh(torusMesh(1.3, 0.5, 44, 22));
    const scale = sceneScale([m]);
    const sils = m.extractFeatures(cam).filter((f) => f.type === "silhouette");
    expect(sils.length).toBeGreaterThanOrEqual(2); // outer + inner (hole) loops

    const bboxDiag = (pts: readonly (readonly [number, number])[]): number => {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const [x, y] of pts) {
        minX = Math.min(minX, x); minY = Math.min(minY, y);
        maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
      }
      return Math.hypot(maxX - minX, maxY - minY);
    };
    const visFrac = (s: ReturnType<typeof classifyFeature>): number => {
      let vis = 0;
      let tot = 0;
      for (const iv of s.intervals) {
        const d = iv.t1 - iv.t0;
        tot += d;
        if (iv.visible) vis += d;
      }
      return tot > 0 ? vis / tot : 1;
    };

    const strokes = sils.map((f) => classifyFeature(f, cam, [m], scale, m));
    // the outer loop = the one with the largest projected bounding box
    let outer = strokes[0]!;
    for (const s of strokes) {
      if (s.screen.kind === "polyline" && outer.screen.kind === "polyline" && bboxDiag(s.screen.pts) > bboxDiag(outer.screen.pts)) outer = s;
    }
    // the exposed outer contour must be (essentially) fully visible — the old,
    // un-nudged QI stippled it into visible/hidden fragments (visFrac ≪ 1)
    expect(visFrac(outer)).toBeGreaterThan(0.95);
    // and at least one loop (the far side of the hole rim) is partly hidden
    expect(strokes.some((s) => visFrac(s) < 0.9)).toBe(true);
  });

  test("the mesh occludes: a point behind it is hidden, a point beside it is visible", () => {
    const m = new Mesh(uvSphere(2, 24, 16));
    const behind = new Point([0, 0, -5]);
    const beside = new Point([4, 0, -5]);
    const hidden = classifyFeature(behind.extractFeatures(front)[0]!, front, [m, behind]);
    const visible = classifyFeature(beside.extractFeatures(front)[0]!, front, [m, beside]);
    expect(hidden.intervals.every((iv) => !iv.visible)).toBe(true);
    expect(visible.intervals.some((iv) => iv.visible)).toBe(true);
  });
});
