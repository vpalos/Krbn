import { describe, expect, test } from "bun:test";
import type { Camera, Vec2 } from "../src/math/types.js";
import { applyWobble, arclengthOf, hashSeed } from "../src/pipeline/wobble.js";
import { BASE_STYLE, ROLE_STYLE, resolveStyle, toRenderStyles, emitStyledStroke } from "../src/pipeline/style.js";
import { sphere } from "../src/primitives/quadric.js";
import { Line } from "../src/primitives/line.js";
import { classifyFeature } from "../src/pipeline/visibility.js";

const front: Camera = {
  eye: [0, 0, 10],
  target: [0, 0, 0],
  up: [0, 1, 0],
  projection: "orthographic",
  scale: 0.01,
  viewport: { width: 400, height: 400 },
};

describe("wobble", () => {
  const straight: Vec2[] = Array.from({ length: 11 }, (_, i) => [i * 10, 0] as Vec2);
  const arc = straight.map((_, i) => i); // arclength 0..10

  test("is deterministic for a given seed", () => {
    const seed = hashSeed("sphere-0:silhouette");
    const a = applyWobble(straight, arc, seed, 0.6);
    const b = applyWobble(straight, arc, seed, 0.6);
    expect(a).toEqual(b);
  });

  test("differs with stroke identity", () => {
    const a = applyWobble(straight, arc, hashSeed("a:silhouette"), 0.6);
    const b = applyWobble(straight, arc, hashSeed("b:silhouette"), 0.6);
    // at least one interior vertex should differ
    expect(a.some((p, i) => Math.abs(p[1] - b[i]![1]) > 1e-6)).toBe(true);
  });

  test("amount 0 leaves the path unchanged", () => {
    const a = applyWobble(straight, arc, 123, 0);
    expect(a).toEqual(straight.map((p) => [p[0], p[1]]));
  });

  test("offsets are lateral (perpendicular to a horizontal line ⇒ only y moves)", () => {
    const seed = hashSeed("x");
    const w = applyWobble(straight, arc, seed, 1);
    for (let i = 0; i < straight.length; i++) expect(w[i]![0]).toBeCloseTo(straight[i]![0], 6);
  });

  test("bounded by the amplitude", () => {
    const w = applyWobble(straight, arc, 7, 1);
    for (const p of w) expect(Math.abs(p[1])).toBeLessThan(3); // AMPLITUDE_PX = 2.6
  });

  test("arclengthOf accumulates world distance", () => {
    expect(arclengthOf([[0, 0, 0], [3, 4, 0], [3, 4, 12]])).toEqual([0, 5, 17]);
  });
});

describe("style resolution", () => {
  test("layers merge over the base, later wins", () => {
    const s = resolveStyle(ROLE_STYLE.context, { weight: 3 }, { wobble: 0.5 });
    expect(s.weight).toBe(3); // element override beats role
    expect(s.wobble).toBe(0.5);
    expect(s.ghostOpacity).toBe(ROLE_STYLE.context.ghostOpacity!); // from role
    expect(s.color).toBe(BASE_STYLE.color); // from base
  });

  test("toRenderStyles: visible solid, hidden ghosted", () => {
    const { visible, hidden } = toRenderStyles(resolveStyle({ weight: 2 }));
    expect(visible.opacity).toBe(1);
    expect(visible.dash).toBeUndefined();
    expect(hidden!.opacity).toBeLessThan(1);
    expect(hidden!.dash).toBeDefined();
  });

  test("hidden: 'drop' yields no hidden render style", () => {
    expect(toRenderStyles(resolveStyle({ hidden: "drop" })).hidden).toBeNull();
  });
});

describe("emitStyledStroke", () => {
  test("applies wobble (weight from spec) and keeps interval structure", () => {
    const s = sphere([0, 0, 0], 1);
    const line = new Line([-3, 0, -2], [3, 0, -2]);
    const stroke = classifyFeature(line.extractFeatures(front)[0]!, front, [s, line]);
    const rs = emitStyledStroke(stroke, front, resolveStyle({ wobble: 0.8, weight: 2 }));
    const thin = emitStyledStroke(stroke, front, resolveStyle({ wobble: 0.8, weight: 1 }));
    expect(rs).toHaveLength(3);
    // weight tracks the spec; depth emphasis scales both equally, so it cancels
    expect(rs[0]!.style.weight / thin[0]!.style.weight).toBeCloseTo(2, 5);
    // wobble subdivides + perturbs: the straight run is no longer exactly 2 points
    expect(rs[0]!.path.length).toBeGreaterThan(2);
    // hidden middle run is ghosted
    expect(rs[1]!.style.opacity).toBeLessThan(1);
  });

  test("wobble 0 leaves straight segments straight (2 points)", () => {
    const s = sphere([0, 0, 0], 1);
    const line = new Line([-3, 0, -2], [3, 0, -2]);
    const stroke = classifyFeature(line.extractFeatures(front)[0]!, front, [s, line]);
    const rs = emitStyledStroke(stroke, front, resolveStyle({ wobble: 0 }));
    expect(rs[0]!.path.length).toBe(2);
  });
});
