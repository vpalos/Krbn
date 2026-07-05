import { describe, expect, test } from "bun:test";
import type { Camera } from "../src/math/types.js";
import type { Curve2D } from "../src/curve/types.js";
import { screenExtent, cutoffFor, quantizeTone, applyAbstraction } from "../src/pipeline/abstract.js";
import { circle } from "../src/curve/conic.js";
import { Scene } from "../src/scene/scene.js";
import { sphere } from "../src/primitives/quadric.js";

describe("screenExtent", () => {
  test("line: chord length", () => {
    expect(screenExtent({ kind: "line", a: [0, 0], b: [30, 40] })).toBeCloseTo(50);
  });
  test("polyline: bbox diagonal", () => {
    expect(screenExtent({ kind: "polyline", pts: [[0, 0], [3, 0], [3, 4]] })).toBeCloseTo(5);
  });
  test("conic: bounding-box diagonal of a circle (2r·√2)", () => {
    const c: Curve2D = { kind: "conic", params: circle(100, 100, 25) };
    expect(screenExtent(c)).toBeCloseTo(50 * Math.SQRT2, 0);
  });
});

describe("cutoffFor (importance modulation)", () => {
  test("high importance lowers the cutoff toward 0", () => {
    expect(cutoffFor(1, 20)).toBeCloseTo(0);
    expect(cutoffFor(0, 20)).toBeCloseTo(20);
    expect(cutoffFor(0.5, 20)).toBeCloseTo(10);
  });
});

describe("quantizeTone", () => {
  test("snaps to k discrete levels", () => {
    expect(quantizeTone(0.62, 4)).toBeCloseTo(0.5); // nearest of {0,.25,.5,.75,1}
    expect(quantizeTone(0.9, 4)).toBeCloseTo(1);
    expect(quantizeTone(0.1, 4)).toBeCloseTo(0);
  });
  test("levels 0 is a no-op", () => {
    expect(quantizeTone(0.37, 0)).toBe(0.37);
  });
});

describe("applyAbstraction", () => {
  const mk = (owner: string, screen: Curve2D) => ({
    feature: { type: "silhouette" as const, owner, curve: { kind: "line" as const, a: [0, 0, 0] as const, b: [1, 0, 0] as const }, attrs: {} },
    screen,
    intervals: [{ t0: 0, t1: 1, visible: true }],
  });

  test("drops sub-threshold features, keeps large ones", () => {
    const strokes = [
      mk("big", { kind: "line", a: [0, 0], b: [100, 0] }),
      mk("small", { kind: "line", a: [0, 0], b: [5, 0] }),
    ];
    const kept = applyAbstraction(strokes, { minFeaturePx: 20 });
    expect(kept.map((s) => s.feature.owner)).toEqual(["big"]);
  });

  test("importance rescues a small feature", () => {
    const strokes = [mk("hero", { kind: "line", a: [0, 0], b: [5, 0] })];
    const dropped = applyAbstraction(strokes, { minFeaturePx: 20, importanceOf: () => 0 });
    const kept = applyAbstraction(strokes, { minFeaturePx: 20, importanceOf: () => 1 });
    expect(dropped).toHaveLength(0);
    expect(kept).toHaveLength(1);
  });

  test("minFeaturePx 0 disables thresholding", () => {
    const strokes = [mk("tiny", { kind: "line", a: [0, 0], b: [1, 0] })];
    expect(applyAbstraction(strokes, { minFeaturePx: 0 })).toHaveLength(1);
  });
});

describe("Scene abstraction integration", () => {
  const cam: Camera = {
    eye: [0, 0, 10],
    target: [0, 0, 0],
    up: [0, 1, 0],
    projection: "orthographic",
    scale: 0.01,
    viewport: { width: 400, height: 400 },
  };

  test("a tiny far context sphere is dropped; a subject is kept", () => {
    const scene = new Scene({ abstraction: { minFeaturePx: 40 } });
    // tiny sphere: radius 0.1 → 20px silhouette, below the 40px cutoff at importance 0
    scene.add(sphere([3, 0, 0], 0.1)).setImportance(0, { role: "context" });
    const before = scene.render(cam).strokes.length;
    // same sphere but high importance → cutoff drops to ~0, kept
    const scene2 = new Scene({ abstraction: { minFeaturePx: 40 } });
    scene2.add(sphere([3, 0, 0], 0.1)).setImportance(1, { role: "subject" });
    const after = scene2.render(cam).strokes.length;
    expect(before).toBe(0);
    expect(after).toBe(1);
  });
});
