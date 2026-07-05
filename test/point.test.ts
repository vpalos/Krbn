import { describe, expect, test } from "bun:test";
import type { Camera } from "../src/math/types.js";
import { Point } from "../src/primitives/point.js";
import { sphere } from "../src/primitives/quadric.js";
import { classifyFeature } from "../src/pipeline/visibility.js";
import { Scene } from "../src/scene/scene.js";

const front: Camera = {
  eye: [0, 0, 10],
  target: [0, 0, 0],
  up: [0, 1, 0],
  projection: "orthographic",
  scale: 0.01,
  viewport: { width: 400, height: 400 },
};

describe("Point primitive", () => {
  test("cross mark = two short line segments, no occlusion", () => {
    const pt = new Point([1, 0, 3]);
    const feats = pt.extractFeatures(front);
    expect(feats).toHaveLength(2);
    expect(feats.every((f) => f.curve.kind === "line")).toBe(true);
    expect(pt.raycast({ origin: [0, 0, 10], dir: [0, 0, -1] })).toHaveLength(0);
    expect(pt.projectedSilhouettes(front)).toHaveLength(0);
  });

  test("mark size ≈ requested pixels", () => {
    const pt = new Point([0, 0, 0], { mark: "plus", sizePx: 10 });
    const seg = pt.extractFeatures(front).find((f) => f.curve.kind === "line")!;
    if (seg.curve.kind === "line") {
      // segment length in world = sizePx * worldPerPx; at scale 0.01 → 10 * 0.01 = 0.1
      const L = Math.hypot(seg.curve.b[0] - seg.curve.a[0], seg.curve.b[1] - seg.curve.a[1], seg.curve.b[2] - seg.curve.a[2]);
      expect(L).toBeCloseTo(0.1, 4);
    }
  });

  test("dot mark = a tiny ring (arc)", () => {
    const feats = new Point([0, 0, 0], { mark: "dot" }).extractFeatures(front);
    expect(feats).toHaveLength(1);
    expect(feats[0]!.curve.kind).toBe("arc");
  });

  test("a point behind a sphere is classified hidden", () => {
    const s = sphere([0, 0, 0], 1);
    const behind = new Point([0, 0, -2]); // directly behind the sphere from the camera
    const stroke = classifyFeature(behind.extractFeatures(front)[0]!, front, [s, behind]);
    expect(stroke.intervals.every((iv) => !iv.visible)).toBe(true);
  });

  test("a point in the open is visible", () => {
    const s = sphere([0, 0, 0], 1);
    const open = new Point([3, 0, 0]); // well clear of the sphere
    const stroke = classifyFeature(open.extractFeatures(front)[0]!, front, [s, open]);
    expect(stroke.intervals.some((iv) => iv.visible)).toBe(true);
  });

  test("renders through a Scene", () => {
    const scene = new Scene();
    scene.add(new Point([0, 0, 0]));
    expect(scene.render(front).renderStrokes.length).toBeGreaterThanOrEqual(2);
  });
});
