import { describe, expect, test } from "bun:test";
import type { Camera } from "../src/math/types.js";
import { sphere } from "../src/primitives/quadric.js";
import { Cylinder } from "../src/primitives/cylinder.js";
import { Polygon } from "../src/primitives/polygon.js";
import { Line } from "../src/primitives/line.js";
import { classifyFeature, classifyScene } from "../src/pipeline/visibility.js";
import { buildFeatureModel } from "../src/pipeline/feature-curve.js";
import { projectionMatrix, projectPoint } from "../src/math/camera.js";

const front: Camera = {
  eye: [0, 0, 10],
  target: [0, 0, 0],
  up: [0, 1, 0],
  projection: "orthographic",
  scale: 0.01,
  viewport: { width: 400, height: 400 },
};

const hasVisible = (ivs: { visible: boolean }[]) => ivs.some((i) => i.visible);
const hasHidden = (ivs: { visible: boolean }[]) => ivs.some((i) => !i.visible);

describe("line behind a sphere → visible / hidden / visible", () => {
  test("exact crossings at the silhouette, middle hidden", () => {
    const s = sphere([0, 0, 0], 1);
    const line = new Line([-3, 0, -2], [3, 0, -2]); // behind the sphere
    const feature = line.extractFeatures(front)[0]!;
    const stroke = classifyFeature(feature, front, [s, line]);

    expect(stroke.intervals).toHaveLength(3);
    expect(stroke.intervals.map((i) => i.visible)).toEqual([true, false, true]);
    // hidden span is exactly where the line crosses the projected unit circle: x = ±1 → u = 1/3, 2/3
    expect(stroke.intervals[0]!.t1).toBeCloseTo(1 / 3, 3);
    expect(stroke.intervals[1]!.t1).toBeCloseTo(2 / 3, 3);
  });
});

describe("unoccluded silhouette is fully visible", () => {
  test("a lone sphere's silhouette has one visible interval", () => {
    const s = sphere([0, 0, 0], 1);
    const feature = s.extractFeatures(front)[0]!;
    const stroke = classifyFeature(feature, front, [s]);
    expect(stroke.intervals).toHaveLength(1);
    expect(stroke.intervals[0]!.visible).toBe(true);
  });
});

describe("sphere occluding another sphere", () => {
  test("the far sphere's silhouette is partly hidden", () => {
    const near = sphere([0, 0, 0], 1);
    const far = sphere([0.5, 0, -3], 1); // overlaps in image, sits behind
    const feature = far.extractFeatures(front)[0]!;
    const stroke = classifyFeature(feature, front, [near, far]);
    expect(hasVisible(stroke.intervals)).toBe(true);
    expect(hasHidden(stroke.intervals)).toBe(true);
  });
});

describe("polygon occluding a line", () => {
  test("the line is hidden where it passes behind the square", () => {
    const square = new Polygon([
      [-1, -1, 0],
      [1, -1, 0],
      [1, 1, 0],
      [-1, 1, 0],
    ]);
    const line = new Line([-3, 0, -2], [3, 0, -2]);
    const feature = line.extractFeatures(front)[0]!;
    const stroke = classifyFeature(feature, front, [square, line]);
    expect(stroke.intervals.map((i) => i.visible)).toEqual([true, false, true]);
    expect(stroke.intervals[0]!.t1).toBeCloseTo(1 / 3, 3);
    expect(stroke.intervals[1]!.t1).toBeCloseTo(2 / 3, 3);
  });
});

describe("cylinder rim self-occlusion", () => {
  test("the far half of a rim is hidden by the cylinder body", () => {
    const cyl = new Cylinder([0, 0, -1], [0, 0, 2], 1);
    const tilted: Camera = {
      eye: [6, 0, 3],
      target: [0, 0, 0],
      up: [0, 0, 1],
      projection: "orthographic",
      scale: 0.02,
      viewport: { width: 400, height: 400 },
    };
    const feats = cyl.extractFeatures(tilted);
    const rim = feats.find((f) => f.type === "boundary")!; // base rim (z = -1)
    const stroke = classifyFeature(rim, tilted, [cyl]);
    expect(hasVisible(stroke.intervals)).toBe(true);
    expect(hasHidden(stroke.intervals)).toBe(true);
  });
});

describe("back-projection parameter recovery (exact inverse)", () => {
  const persp: Camera = {
    eye: [2, 1, 6],
    target: [0, 0, 0],
    up: [0, 1, 0],
    projection: "perspective",
    scale: Math.PI / 3,
    viewport: { width: 400, height: 400 },
  };

  test("line parameter recovers under ortho and perspective", () => {
    const line = new Line([-2, -1, 0.5], [3, 2, -1]);
    for (const cam of [front, persp]) {
      const model = buildFeatureModel(line.extractFeatures(cam)[0]!.curve, cam);
      const P = projectionMatrix(cam);
      for (const t of [0.1, 0.37, 0.62, 0.9]) {
        const pt = projectPoint(P, model.point3(t)).point;
        expect(model.paramOf(pt)!).toBeCloseTo(t, 6);
      }
    }
  });

  test("arc angle recovers under perspective", () => {
    const cyl = new Cylinder([0, 0, -1], [0, 0, 2], 1);
    const rim = cyl.extractFeatures(persp).find((f) => f.type === "boundary")!;
    const model = buildFeatureModel(rim.curve, persp);
    const P = projectionMatrix(persp);
    for (const t of [0.3, 1.2, 2.5, 4.0]) {
      const pt = projectPoint(P, model.point3(t)).point;
      expect(model.paramOf(pt)!).toBeCloseTo(t, 5);
    }
  });
});

describe("classifyScene", () => {
  test("produces one stroke per feature with intervals", () => {
    const s = sphere([0, 0, 0], 1);
    const strokes = classifyScene([s], front);
    expect(strokes.length).toBeGreaterThanOrEqual(1);
    for (const st of strokes) expect(st.intervals.length).toBeGreaterThanOrEqual(1);
  });
});
