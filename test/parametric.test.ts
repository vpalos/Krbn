import { describe, expect, test } from "bun:test";
import type { Camera, Vec2, Vec3 } from "../src/math/types.js";
import { adaptiveSample, deCasteljau, DEFAULT_SAMPLE } from "../src/curve/sample.js";
import { BezierCurve, ParametricCurve, helix, functionPlot } from "../src/primitives/parametric.js";

const ortho: Camera = {
  eye: [0, 0, 10],
  target: [0, 0, 0],
  up: [0, 1, 0],
  projection: "orthographic",
  scale: 0.01,
  viewport: { width: 400, height: 400 },
};
// simple ortho-ish projection (x,y) → pixels for sampler tests
const project = (p: Vec3): Vec2 => [p[0] * 100 + 200, -p[1] * 100 + 200];

describe("adaptive sampler", () => {
  test("a straight line needs only its endpoints", () => {
    const f = (t: number): Vec3 => [t, 2 * t, 0];
    const r = adaptiveSample(f, 0, 1, project, DEFAULT_SAMPLE);
    expect(r.points).toHaveLength(2);
    expect(r.ts).toEqual([0, 1]);
  });

  test("a curved arc subdivides, and every sample lies on the curve", () => {
    const f = (t: number): Vec3 => [Math.cos(t), Math.sin(t), 0]; // unit circle arc
    const r = adaptiveSample(f, 0, Math.PI, project, DEFAULT_SAMPLE);
    expect(r.points.length).toBeGreaterThan(5);
    for (const p of r.points) expect(Math.hypot(p[0], p[1])).toBeCloseTo(1);
    // parameters strictly increasing
    for (let i = 1; i < r.ts.length; i++) expect(r.ts[i]! > r.ts[i - 1]!).toBe(true);
  });

  test("tighter tolerance yields more samples", () => {
    const f = (t: number): Vec3 => [Math.cos(t), Math.sin(t), 0];
    const coarse = adaptiveSample(f, 0, Math.PI, project, { tolerancePx: 2, maxDepth: 20 });
    const fine = adaptiveSample(f, 0, Math.PI, project, { tolerancePx: 0.05, maxDepth: 20 });
    expect(fine.points.length).toBeGreaterThan(coarse.points.length);
  });
});

describe("de Casteljau", () => {
  test("endpoints and midpoint of a quadratic Bézier", () => {
    const ctrl: Vec3[] = [
      [0, 0, 0],
      [1, 2, 0],
      [2, 0, 0],
    ];
    expect(deCasteljau(ctrl, 0)).toEqual([0, 0, 0]);
    expect(deCasteljau(ctrl, 1)).toEqual([2, 0, 0]);
    // B(0.5) = 0.25 P0 + 0.5 P1 + 0.25 P2 = (1, 1, 0)
    const mid = deCasteljau(ctrl, 0.5);
    expect(mid[0]).toBeCloseTo(1);
    expect(mid[1]).toBeCloseTo(1);
  });
});

describe("BezierCurve primitive", () => {
  test("carries control points exactly (analytic bezier feature)", () => {
    const b = new BezierCurve([
      [0, 0, 0],
      [1, 1, 0],
      [2, 0, 0],
    ]);
    const f = b.extractFeatures(ortho)[0]!;
    expect(f.type).toBe("boundary");
    expect(f.curve.kind).toBe("bezier");
    if (f.curve.kind === "bezier") expect(f.curve.pts).toHaveLength(3);
    expect(b.raycast({ origin: [0, 0, 10], dir: [0, 0, -1] })).toHaveLength(0);
  });
});

describe("helix", () => {
  test("samples lie on the cylinder and rise linearly", () => {
    const h = helix([0, 0, 0], 2, 1, 2); // radius 2, pitch 1, 2 turns
    const f = h.extractFeatures(ortho)[0]!;
    expect(f.curve.kind).toBe("polyline");
    if (f.curve.kind === "polyline") {
      for (const p of f.curve.pts) expect(Math.hypot(p[0], p[1])).toBeCloseTo(2);
      const zs = f.curve.pts.map((p) => p[2]!);
      expect(zs[0]!).toBeCloseTo(0);
      expect(zs[zs.length - 1]!).toBeCloseTo(2); // 2 turns × pitch 1
    }
  });
});

describe("functionPlot", () => {
  test("parabola bounds and endpoints", () => {
    const p = functionPlot((x) => x * x, -2, 2);
    const b = p.bounds();
    expect(b.min[1]).toBeCloseTo(0); // min of x² on [-2,2]
    expect(b.max[1]).toBeCloseTo(4); // max of x²
    expect(b.min[0]).toBeCloseTo(-2);
    expect(b.max[0]).toBeCloseTo(2);
  });
});
