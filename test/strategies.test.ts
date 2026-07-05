import { describe, expect, test } from "bun:test";
import type { Camera, Vec2 } from "../src/math/types.js";
import type { HatchRegion } from "../src/pipeline/types.js";
import { Scene } from "../src/scene/scene.js";
import { sphere } from "../src/primitives/quadric.js";
import { createWobble, defaultWobble, type WobbleStrategy } from "../src/pipeline/wobble.js";
import { defaultHatch, generateHatch, type HatchStrategy, type Segment } from "../src/pipeline/hatch.js";

const front: Camera = {
  eye: [0, 0, 10],
  target: [0, 0, 0],
  up: [0, 1, 0],
  projection: "orthographic",
  scale: 0.01,
  viewport: { width: 400, height: 400 },
};

describe("WobbleStrategy is pluggable", () => {
  test("Scene uses a custom wobble strategy", () => {
    let calls = 0;
    const marker: WobbleStrategy = {
      apply({ path }) {
        calls++;
        return path.map((p) => [p[0], p[1]]); // identity, but observable
      },
    };
    const scene = new Scene({ wobble: marker });
    scene.add(sphere([0, 0, 0], 1)).style({ wobble: 0.8 });
    scene.render(front);
    expect(calls).toBeGreaterThan(0);
  });

  test("createWobble params scale the amplitude", () => {
    const straight: Vec2[] = Array.from({ length: 21 }, (_, i) => [i * 4, 0] as Vec2);
    const pts3 = straight.map((_, i) => [i * 4, 0, 0] as [number, number, number]);
    const input = { path: straight, points3: pts3, seed: 42, amount: 1 };
    const small = createWobble({ amplitudePx: 1, stepPx: 4 }).apply(input);
    const big = createWobble({ amplitudePx: 8, stepPx: 4 }).apply(input);
    const maxDev = (p: Vec2[]) => Math.max(...p.map((q) => Math.abs(q[1])));
    expect(maxDev(big)).toBeGreaterThan(maxDev(small) * 3);
  });

  test("defaultWobble matches createWobble() defaults", () => {
    const straight: Vec2[] = Array.from({ length: 21 }, (_, i) => [i * 4, 0] as Vec2);
    const pts3 = straight.map((_, i) => [i * 4, 0, 0] as [number, number, number]);
    const input = { path: straight, points3: pts3, seed: 7, amount: 0.7 };
    expect(defaultWobble.apply(input)).toEqual(createWobble().apply(input));
  });
});

describe("HatchStrategy is pluggable", () => {
  test("Scene uses a custom hatch strategy", () => {
    // near the disk centre (200,200) → back-projects onto the visible front
    // hemisphere, so it survives visibility clipping
    const fixed: Segment = [
      [190, 200],
      [210, 200],
    ];
    let calls = 0;
    const marker: HatchStrategy = {
      generate() {
        calls++;
        return [fixed];
      },
    };
    const scene = new Scene({ hatch: marker });
    scene.add(sphere([0, 0, 0], 1)).style({ hatch: { mode: "single", angle: 0 } });
    const res = scene.render(front);
    expect(calls).toBeGreaterThan(0);
    // our fixed segment (both endpoints on the visible front hemisphere) survives clipping
    const thin = res.renderStrokes.filter((s) => s.style.weight < 1);
    expect(thin.length).toBeGreaterThan(0);
  });

  test("defaultHatch delegates to generateHatch", () => {
    const region: HatchRegion = {
      owner: "d",
      outline: { kind: "polyline", pts: [[0, 0], [100, 0], [100, 100], [0, 100], [0, 0]] },
      mode: "single",
      angle: 0,
      tone: 0.5,
    };
    expect(defaultHatch.generate(region, { spacingPx: 10 })).toEqual(generateHatch(region, { spacingPx: 10 }));
  });
});
