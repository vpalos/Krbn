import { describe, expect, test } from "bun:test";
import type { Camera } from "../src/math/types.js";
import { Line } from "../src/primitives/line.js";
import { Polygon } from "../src/primitives/polygon.js";

const ortho: Camera = {
  eye: [0, 0, 10],
  target: [0, 0, 0],
  up: [0, 1, 0],
  projection: "orthographic",
  scale: 0.01,
  viewport: { width: 400, height: 400 },
};

describe("Line", () => {
  const l = new Line([0, 0, 0], [1, 2, 3]);

  test("emits one boundary line feature", () => {
    const feats = l.extractFeatures(ortho);
    expect(feats).toHaveLength(1);
    expect(feats[0]!.type).toBe("boundary");
    expect(feats[0]!.curve.kind).toBe("line");
  });

  test("does not occlude and has no silhouette", () => {
    expect(l.raycast({ origin: [0, 0, 10], dir: [0, 0, -1] })).toHaveLength(0);
    expect(l.projectedSilhouettes(ortho)).toHaveLength(0);
  });

  test("bounds span the endpoints", () => {
    expect(l.bounds().min).toEqual([0, 0, 0]);
    expect(l.bounds().max).toEqual([1, 2, 3]);
  });
});

describe("Polygon", () => {
  // Unit square in the z = 0 plane, CCW seen from +z.
  const square = new Polygon([
    [-1, -1, 0],
    [1, -1, 0],
    [1, 1, 0],
    [-1, 1, 0],
  ]);

  test("normal is the plane normal (±z)", () => {
    expect(Math.abs(square.normal[2])).toBeCloseTo(1);
    expect(square.normal[0]).toBeCloseTo(0);
    expect(square.normal[1]).toBeCloseTo(0);
  });

  test("boundary feature is a closed polyline", () => {
    const f = square.extractFeatures(ortho)[0]!;
    expect(f.type).toBe("boundary");
    expect(f.curve.kind).toBe("polyline");
    if (f.curve.kind === "polyline") {
      // 4 corners + repeated first = closed
      expect(f.curve.pts).toHaveLength(5);
      expect(f.curve.pts[0]).toEqual(f.curve.pts[4]!);
    }
  });

  test("occludes: a ray through the interior hits the face", () => {
    const hits = square.raycast({ origin: [0.2, -0.3, 5], dir: [0, 0, -1] });
    expect(hits).toHaveLength(1);
    expect(hits[0]!.point[2]).toBeCloseTo(0);
    expect(hits[0]!.t).toBeCloseTo(5);
    expect(hits[0]!.frontFacing).toBe(true);
  });

  test("a ray outside the outline misses", () => {
    expect(square.raycast({ origin: [5, 5, 5], dir: [0, 0, -1] })).toHaveLength(0);
  });

  test("a ray parallel to the plane misses cleanly", () => {
    expect(square.raycast({ origin: [0, 0, 5], dir: [1, 0, 0] })).toHaveLength(0);
  });

  test("produces one hatch region with a projected outline", () => {
    const regions = square.hatchRegions(ortho, { direction: [0, 0, -1] });
    expect(regions).toHaveLength(1);
    expect(regions[0]!.outline.kind).toBe("polyline");
    expect(regions[0]!.tone).toBeGreaterThanOrEqual(0);
    expect(regions[0]!.tone).toBeLessThanOrEqual(1);
  });

  test("projected silhouette is the 4 boundary edges", () => {
    expect(square.projectedSilhouettes(ortho)).toHaveLength(4);
  });
});
