import { describe, expect, test } from "bun:test";
import type { Camera, Vec2 } from "../src/math/types.js";
import { defaultWidth, depthEmphasis } from "../src/pipeline/width.js";
import { Scene } from "../src/scene/scene.js";
import { sphere } from "../src/primitives/quadric.js";

describe("depthEmphasis", () => {
  test("nearer than the focus is bolder, at the focus is neutral, farther is thinner", () => {
    expect(depthEmphasis(10, 10)).toBeCloseTo(1, 9);
    expect(depthEmphasis(5, 10)).toBeGreaterThan(1);
    expect(depthEmphasis(20, 10)).toBeLessThan(1);
  });

  test("clamped to a legible band", () => {
    expect(depthEmphasis(1e-4, 10)).toBeLessThanOrEqual(1.6 + 1e-9);
    expect(depthEmphasis(1e6, 10)).toBeGreaterThanOrEqual(0.55 - 1e-9);
  });
});

describe("createWidth — taper + pressure", () => {
  const straight: Vec2[] = Array.from({ length: 40 }, (_, i) => [i * 4, 0]);

  test("amount 0 is a uniform base width", () => {
    for (const x of defaultWidth.widths({ path: straight, seed: 1, baseWidth: 2, amount: 0 })) {
      expect(x).toBeCloseTo(2, 9);
    }
  });

  test("amount > 0 tapers both ends below the middle, stays positive, and is deterministic", () => {
    const w = defaultWidth.widths({ path: straight, seed: 7, baseWidth: 2, amount: 1 });
    const mid = w[Math.floor(w.length / 2)]!;
    expect(w[0]!).toBeLessThan(mid);
    expect(w[w.length - 1]!).toBeLessThan(mid);
    for (const x of w) expect(x).toBeGreaterThan(0);
    expect(w).toEqual(defaultWidth.widths({ path: straight, seed: 7, baseWidth: 2, amount: 1 }));
  });
});

describe("ribbon rendering + depth in a scene", () => {
  const cam: Camera = {
    eye: [0, 0, 10],
    target: [0, 0, 0],
    up: [0, 1, 0],
    projection: "perspective",
    scale: Math.PI / 5,
    viewport: { width: 400, height: 400 },
  };

  test("a wobbled solid stroke renders as a filled ribbon <path>; wobble 0 stays a <polyline>", () => {
    const wobbled = new Scene();
    wobbled.add(sphere([0, 0, 0], 1)).style({ wobble: 0.8 });
    expect(wobbled.toSVG(cam)).toContain("<path");

    const ruler = new Scene();
    ruler.add(sphere([0, 0, 0], 1)).style({ wobble: 0 });
    expect(ruler.toSVG(cam)).not.toContain("<path");
  });

  test("a nearer object gets a bolder outline than a farther one (depth emphasis)", () => {
    const maxWeight = (z: number): number => {
      const s = new Scene();
      s.add(sphere([0, 0, z], 0.8, "s")).style({ wobble: 0 });
      return Math.max(...s.render(cam).renderStrokes.map((r) => r.style.weight));
    };
    expect(maxWeight(3)).toBeGreaterThan(maxWeight(-6)); // z=3 is nearer the eye (z=10)
  });
});
