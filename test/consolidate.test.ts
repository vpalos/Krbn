import { describe, expect, test } from "bun:test";
import type { Camera } from "../src/math/types.js";
import { consolidateLines } from "../src/pipeline/consolidate.js";
import { Scene } from "../src/scene/scene.js";
import { Line } from "../src/primitives/line.js";
import { sphere } from "../src/primitives/quadric.js";
import { classifyScene } from "../src/pipeline/visibility.js";

const ortho: Camera = {
  eye: [0, 0, 10],
  target: [0, 0, 0],
  up: [0, 1, 0],
  projection: "orthographic",
  scale: 0.01,
  viewport: { width: 400, height: 400 },
};

describe("consolidateLines", () => {
  test("two collinear overlapping lines merge into one 3-D segment", () => {
    const a = new Line([-2, 0, 0], [1, 0, 0]);
    const b = new Line([0, 0, 0], [3, 0, 0]); // overlaps [0,1], collinear
    const strokes = classifyScene([a, b], ortho);
    const { singles, merged } = consolidateLines(strokes, ortho);
    expect(singles).toHaveLength(0);
    expect(merged).toHaveLength(1);
    // merged spans the union [-2, 3] along x
    const xs = [merged[0]!.a[0], merged[0]!.b[0]].sort((p, q) => p - q);
    expect(xs[0]!).toBeCloseTo(-2, 4);
    expect(xs[1]!).toBeCloseTo(3, 4);
  });

  test("parallel but separated lines are NOT merged", () => {
    const a = new Line([-2, 0.5, 0], [2, 0.5, 0]);
    const b = new Line([-2, -0.5, 0], [2, -0.5, 0]); // parallel, 1 unit apart (100px)
    const { singles, merged } = consolidateLines(classifyScene([a, b], ortho), ortho);
    expect(singles).toHaveLength(2);
    expect(merged).toHaveLength(0);
  });

  test("collinear but non-overlapping (large gap) lines are NOT merged", () => {
    const a = new Line([-3, 0, 0], [-1, 0, 0]);
    const b = new Line([1, 0, 0], [3, 0, 0]); // same line, but a 2-unit (200px) gap
    const { singles, merged } = consolidateLines(classifyScene([a, b], ortho), ortho);
    expect(singles).toHaveLength(2);
    expect(merged).toHaveLength(0);
  });

  test("non-line strokes pass through untouched", () => {
    const strokes = classifyScene([sphere([0, 0, 0], 1)], ortho); // silhouette conic
    const { singles, merged } = consolidateLines(strokes, ortho);
    expect(singles).toHaveLength(strokes.length);
    expect(merged).toHaveLength(0);
  });
});

describe("Scene consolidation option", () => {
  test("off by default; on merges coincident lines", () => {
    const mk = () => {
      const s = new Scene();
      s.add(new Line([-2, 0, 0], [1, 0, 0]));
      s.add(new Line([0, 0, 0], [3, 0, 0]));
      return s;
    };
    const off = mk().render(ortho).strokes.length;
    const onScene = new Scene({ abstraction: { consolidate: true } });
    onScene.add(new Line([-2, 0, 0], [1, 0, 0]));
    onScene.add(new Line([0, 0, 0], [3, 0, 0]));
    const on = onScene.render(ortho).strokes.length;
    expect(off).toBe(2);
    expect(on).toBe(1);
  });
});
