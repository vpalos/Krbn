import { describe, expect, test } from "bun:test";
import type { Camera } from "../src/math/types.js";
import { HalfEdgeMesh } from "../src/mesh/halfedge.js";
import { computeCurvature } from "../src/mesh/curvature.js";
import { suggestiveContours } from "../src/mesh/suggestive.js";
import { torusMesh, uvSphere } from "../src/mesh/shapes.js";
import { dot, normalize, sub } from "../src/math/vec3.js";

const cam: Camera = {
  eye: [4, 3, 3],
  target: [0, 0, 0],
  up: [0, 0, 1],
  projection: "perspective",
  scale: Math.PI / 4,
  viewport: { width: 500, height: 400 },
};

describe("suggestive contours", () => {
  test("a convex sphere has none (radial curvature never vanishes)", () => {
    const m = HalfEdgeMesh.build(uvSphere(2, 40, 28));
    const curv = computeCurvature(m);
    expect(suggestiveContours(m, cam, curv)).toHaveLength(0);
  });

  test("a torus (saddle region) has suggestive contours, all on the front-facing side", () => {
    const m = HalfEdgeMesh.build(torusMesh(1.4, 0.55, 60, 30));
    const curv = computeCurvature(m);
    const loops = suggestiveContours(m, cam, curv);
    expect(loops.length).toBeGreaterThan(0);
    const total = loops.reduce((s, l) => s + l.length, 0);
    expect(total).toBeGreaterThan(20);

    // every contour point must be on the front-facing surface (n·v > 0 roughly);
    // check via the nearest vertex normal
    for (const loop of loops) {
      for (const p of loop) {
        const view = normalize(sub(cam.eye, p));
        // nearest mesh vertex
        let best = 0;
        let bd = Infinity;
        for (let v = 0; v < m.vertexCount; v++) {
          const d = (m.positions[v]![0] - p[0]) ** 2 + (m.positions[v]![1] - p[1]) ** 2 + (m.positions[v]![2] - p[2]) ** 2;
          if (d < bd) {
            bd = d;
            best = v;
          }
        }
        expect(dot(view, m.vertexNormals[best]!)).toBeGreaterThan(-0.15); // front-facing (small slack at the contour edge)
      }
    }
  });

  test("a higher threshold yields no more contours than a lower one, and is deterministic", () => {
    const m = HalfEdgeMesh.build(torusMesh(1.4, 0.55, 60, 30));
    const curv = computeCurvature(m);
    const low = suggestiveContours(m, cam, curv, { threshold: 0 });
    const high = suggestiveContours(m, cam, curv, { threshold: 5 });
    const npts = (ls: readonly (readonly unknown[])[]) => ls.reduce((s, l) => s + l.length, 0);
    expect(npts(high)).toBeLessThanOrEqual(npts(low));
    expect(JSON.stringify(suggestiveContours(m, cam, curv))).toBe(JSON.stringify(low));
  });
});
