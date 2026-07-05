import { describe, expect, test } from "bun:test";
import type { Camera } from "../src/math/types.js";
import { Torus } from "../src/primitives/torus.js";
import { Point } from "../src/primitives/point.js";
import { classifyFeature } from "../src/pipeline/visibility.js";
import { Scene } from "../src/scene/scene.js";

// torus centred at origin, axis +z, major R = 2, minor r = 0.5
const torus = new Torus([0, 0, 0], [0, 0, 1], 2, 0.5);

const onTorus = (p: readonly [number, number, number], R = 2, r = 0.5) =>
  Math.abs((Math.hypot(p[0], p[1]) - R) ** 2 + p[2] ** 2 - r * r);

describe("Torus — raycast (quartic)", () => {
  test("a ray through the tube gives four ordered hits", () => {
    const hits = torus.raycast({ origin: [10, 0, 0], dir: [-1, 0, 0] });
    // ascending t ⇒ descending x: enters +2.5, exits +1.5, enters −1.5, exits −2.5
    expect(hits.map((h) => Math.round(h.point[0] * 1e4) / 1e4)).toEqual([2.5, 1.5, -1.5, -2.5]);
    // enter/exit/enter/exit facing (ascending t is +2.5, +1.5, -1.5, -2.5)
    const byT = hits; // already ascending t
    expect(byT[0]!.frontFacing).toBe(true); // enters outer tube at x=+2.5
    expect(byT[1]!.frontFacing).toBe(false);
    for (const h of hits) expect(Math.hypot(...h.normal)).toBeCloseTo(1);
  });

  test("a ray straight through the hole misses", () => {
    // hole radius is R − r = 1.5; a ray down the axis passes clean through
    expect(torus.raycast({ origin: [0, 0, 10], dir: [0, 0, -1] })).toHaveLength(0);
  });

  test("normals point outward from the tube centre", () => {
    const hit = torus.raycast({ origin: [10, 0, 0], dir: [-1, 0, 0] }).find((h) => h.point[0] > 2)!;
    // at (2.5,0,0) the outward normal is +x
    expect(hit.normal[0]).toBeCloseTo(1);
  });
});

describe("Torus — bounds", () => {
  test("tight AABB (R+r in-plane, r along axis)", () => {
    expect(torus.bounds().min).toEqual([-2.5, -2.5, -0.5]);
    expect(torus.bounds().max).toEqual([2.5, 2.5, 0.5]);
  });
});

describe("Torus — silhouette", () => {
  const tilted: Camera = {
    eye: [5, 4, 3],
    target: [0, 0, 0],
    up: [0, 0, 1],
    projection: "perspective",
    scale: Math.PI / 4,
    viewport: { width: 600, height: 480 },
  };

  test("the contour generator is two loops lying exactly on the torus", () => {
    const feats = torus.extractFeatures(tilted);
    expect(feats).toHaveLength(2);
    for (const f of feats) {
      expect(f.type).toBe("silhouette");
      expect(f.curve.kind).toBe("polyline");
      if (f.curve.kind === "polyline") {
        expect(f.curve.pts.length).toBeGreaterThan(50);
        for (const p of f.curve.pts) expect(onTorus(p)).toBeLessThan(1e-6);
      }
    }
  });

  test("projected silhouettes are polylines", () => {
    const sils = torus.projectedSilhouettes(tilted);
    expect(sils).toHaveLength(2);
    expect(sils.every((s) => s.kind === "polyline")).toBe(true);
  });

  test("hatchRegions is an annulus (outer outline + hole) that renders", () => {
    const regions = torus.hatchRegions(tilted, { direction: [-0.5, -0.5, -0.7] });
    expect(regions).toHaveLength(1);
    expect(regions[0]!.outline.kind).toBe("polyline");
    expect(regions[0]!.holes?.length).toBe(1);

    const scene = new Scene({ light: { direction: [-0.5, 0.5, -0.5] } });
    scene.add(torus).style({ hatch: { mode: "single", angle: 0, spacingPx: 12 } });
    const hatch = scene.render(tilted).renderStrokes.filter((s) => s.style.weight < 1);
    expect(hatch.length).toBeGreaterThan(0);
  });

  test("outer loop is larger than the inner (hole) loop", () => {
    const feats = torus.extractFeatures(tilted);
    const meanRadius = (f: (typeof feats)[number]) => {
      if (f.curve.kind !== "polyline") return 0;
      return f.curve.pts.reduce((s, p) => s + Math.hypot(p[0], p[1]), 0) / f.curve.pts.length;
    };
    const radii = feats.map(meanRadius).sort((a, b) => a - b);
    expect(radii[1]!).toBeGreaterThan(radii[0]!);
  });
});

describe("Torus — visibility in a scene", () => {
  const front: Camera = {
    eye: [0, 0, 10],
    target: [0, 0, 0],
    up: [0, 1, 0],
    projection: "orthographic",
    scale: 0.02,
    viewport: { width: 400, height: 400 },
  };

  test("a point behind the tube is hidden; a point behind the hole is visible", () => {
    const behindTube = new Point([2, 0, -5]); // directly behind the x=2 tube
    const throughHole = new Point([0, 0, -5]); // behind the open hole
    const hidden = classifyFeature(behindTube.extractFeatures(front)[0]!, front, [torus, behindTube]);
    const visible = classifyFeature(throughHole.extractFeatures(front)[0]!, front, [torus, throughHole]);
    expect(hidden.intervals.every((iv) => !iv.visible)).toBe(true);
    expect(visible.intervals.some((iv) => iv.visible)).toBe(true);
  });

  test("renders through a Scene", () => {
    const scene = new Scene();
    scene.add(torus);
    const res = scene.render(front);
    expect(res.strokes.filter((s) => s.feature.type === "silhouette").length).toBeGreaterThanOrEqual(2);
  });
});
