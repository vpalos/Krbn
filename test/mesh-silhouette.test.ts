import { describe, expect, test } from "bun:test";
import type { Camera, Vec3 } from "../src/math/types.js";
import { HalfEdgeMesh } from "../src/mesh/halfedge.js";
import { facetedSilhouetteLoops, silhouetteLoops } from "../src/mesh/silhouette.js";
import { Mesh } from "../src/mesh/mesh-source.js";
import { cube, tube, uvSphere } from "../src/mesh/shapes.js";

const ortho = (eye: Vec3, up: Vec3): Camera => ({
  eye,
  target: [0, 0, 0],
  up,
  projection: "orthographic",
  scale: 0.02,
  viewport: { width: 400, height: 400 },
});

describe("mesh silhouette — sphere (one equatorial loop)", () => {
  const R = 2;
  const m = HalfEdgeMesh.build(uvSphere(R, 48, 32));
  const loops = silhouetteLoops(m, ortho([0, 0, 10], [0, 1, 0])); // view down -z

  test("exactly one closed contour on the equator, radius R, z ≈ 0", () => {
    expect(loops.length).toBe(1);
    const loop = loops[0]!;
    expect(loop.length).toBeGreaterThan(10);
    // closed: first point repeated at the end
    const a = loop[0]!;
    const b = loop[loop.length - 1]!;
    expect(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])).toBeLessThan(1e-9);
    for (const p of loop) {
      expect(Math.hypot(p[0], p[1])).toBeCloseTo(R, 6); // on the silhouette circle
      expect(Math.abs(p[2])).toBeLessThan(1e-6); // in the z = 0 plane
    }
  });

  test("is deterministic", () => {
    const again = silhouetteLoops(m, ortho([0, 0, 10], [0, 1, 0]));
    expect(JSON.stringify(again)).toBe(JSON.stringify(loops));
  });

  test("the contour follows the view: an oblique view gives one loop on the sphere, in the plane ⟂ view", () => {
    const eye: Vec3 = [6, 2, 7];
    const len = Math.hypot(eye[0], eye[1], eye[2]);
    const vd: Vec3 = [-eye[0] / len, -eye[1] / len, -eye[2] / len]; // view direction, eye→origin
    const loops = silhouetteLoops(m, ortho(eye, [0, 0, 1]));
    expect(loops.length).toBe(1);
    for (const p of loops[0]!) {
      // crossing points lie on mesh chords, so allow a small (mesh-resolution) slack
      expect(Math.abs(Math.hypot(p[0], p[1], p[2]) - R)).toBeLessThan(0.02 * R); // on the sphere
      expect(Math.abs(p[0] * vd[0] + p[1] * vd[1] + p[2] * vd[2])).toBeLessThan(0.02 * R); // in the silhouette plane
    }
  });
});

describe("faceted silhouette — cube (exact edge-based contour)", () => {
  // axis-aligned cube [-1,1]³ viewed down a body diagonal shows three faces; its
  // apparent contour is a single hexagonal loop of six real cube edges.
  const m = HalfEdgeMesh.build(cube());
  const cam = ortho([6, 5, 4], [0, 0, 1]);

  test("one closed loop whose vertices are all cube corners (on the edges, not wandering)", () => {
    const loops = facetedSilhouetteLoops(m, cam);
    expect(loops.length).toBe(1);
    const loop = loops[0]!;
    // six silhouette edges ⇒ seven vertices (loop closes on the first)
    expect(loop.length).toBe(7);
    for (const p of loop) {
      // every point is an actual cube corner (±1,±1,±1) — no across-face wandering
      for (const c of p) expect(Math.abs(Math.abs(c) - 1)).toBeLessThan(1e-9);
    }
  });

  test("the Mesh emits no separate silhouette feature (creases already cover every edge)", () => {
    const feats = new Mesh(cube()).extractFeatures(cam);
    expect(feats.some((f) => f.type === "silhouette")).toBe(false);
    expect(feats.filter((f) => f.type === "crease").length).toBeGreaterThan(0);
    // and the apparent contour is available for occlusion/hatch
    expect(new Mesh(cube()).projectedSilhouettes(cam).length).toBe(1);
  });
});

describe("mesh silhouette — open tube (two profile paths)", () => {
  const R = 1.5;
  const H = 4;
  const m = HalfEdgeMesh.build(tube(R, H, 48, 10));
  const loops = silhouetteLoops(m, ortho([10, 0, 0], [0, 0, 1])); // view down -x

  test("two open profile lines at x ≈ 0, |y| ≈ R, spanning the height", () => {
    expect(loops.length).toBe(2);
    for (const path of loops) {
      // open path: endpoints differ
      const a = path[0]!;
      const b = path[path.length - 1]!;
      expect(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])).toBeGreaterThan(H / 2);
      for (const p of path) {
        expect(Math.abs(p[0])).toBeLessThan(1e-6); // profile is in the x = 0 plane
        expect(Math.abs(p[1])).toBeCloseTo(R, 6); //  at y = ±R
      }
    }
    // the two paths are on opposite sides
    const ys = loops.map((p) => Math.sign(p[0]![1]));
    expect(ys[0]! * ys[1]!).toBe(-1);
  });
});
