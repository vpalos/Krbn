import { describe, expect, test } from "bun:test";
import type { Vec2 } from "../src/math/types.js";
import type { HatchRegion } from "../src/pipeline/types.js";
import { circle } from "../src/curve/conic.js";
import { generateHatch } from "../src/pipeline/hatch.js";

const dist = (p: Vec2, c: Vec2) => Math.hypot(p[0] - c[0], p[1] - c[1]);

describe("hatch — conic (circular) region", () => {
  const region: HatchRegion = {
    owner: "disk",
    outline: { kind: "conic", params: circle(200, 200, 100) },
    mode: "single",
    angle: 0,
    tone: 0.5,
  };

  test("fills the disk with chords whose ends lie on the circle", () => {
    const segs = generateHatch(region, { spacingPx: 10 });
    expect(segs.length).toBeGreaterThan(10);
    for (const [a, b] of segs) {
      expect(dist(a, [200, 200])).toBeCloseTo(100, 3);
      expect(dist(b, [200, 200])).toBeCloseTo(100, 3);
    }
  });

  test("denser spacing → more lines", () => {
    const coarse = generateHatch(region, { spacingPx: 20 });
    const fine = generateHatch(region, { spacingPx: 6 });
    expect(fine.length).toBeGreaterThan(coarse.length);
  });

  test("cross mode roughly doubles the line count of single", () => {
    const single = generateHatch({ ...region, mode: "single" }, { spacingPx: 10 });
    const cross = generateHatch({ ...region, mode: "cross" }, { spacingPx: 10 });
    expect(cross.length).toBeGreaterThan(single.length * 1.6);
  });

  test("higher tone (no override) hatches denser", () => {
    const light = generateHatch({ ...region, tone: 0.1 });
    const dark = generateHatch({ ...region, tone: 0.9 });
    expect(dark.length).toBeGreaterThan(light.length);
  });
});

describe("hatch — polygon region", () => {
  const square: HatchRegion = {
    owner: "face",
    outline: {
      kind: "polyline",
      pts: [
        [100, 100],
        [300, 100],
        [300, 300],
        [100, 300],
        [100, 100],
      ],
    },
    mode: "single",
    angle: 90, // vertical lines
    tone: 0.5,
  };

  test("vertical lines span the square top to bottom, inside x-range", () => {
    const segs = generateHatch(square, { spacingPx: 20 });
    expect(segs.length).toBeGreaterThan(5);
    for (const [a, b] of segs) {
      // vertical: same x, endpoints at y = 100 and 300
      expect(a[0]).toBeCloseTo(b[0], 6);
      expect(a[0]).toBeGreaterThanOrEqual(100 - 1e-6);
      expect(a[0]).toBeLessThanOrEqual(300 + 1e-6);
      const ys = [a[1], b[1]].sort((p, q) => p - q);
      expect(ys[0]!).toBeCloseTo(100, 3);
      expect(ys[1]!).toBeCloseTo(300, 3);
    }
  });

  test("triple mode emits three angle sets", () => {
    const single = generateHatch(square, { spacingPx: 15 });
    const triple = generateHatch({ ...square, mode: "triple" }, { spacingPx: 15 });
    expect(triple.length).toBeGreaterThan(single.length * 2.2);
  });
});

describe("hatch — holes (annulus, even–odd)", () => {
  const annulus: HatchRegion = {
    owner: "ring",
    outline: {
      kind: "polyline",
      pts: [[-100, -100], [100, -100], [100, 100], [-100, 100], [-100, -100]],
    },
    holes: [
      {
        kind: "polyline",
        pts: [[-30, -30], [30, -30], [30, 30], [-30, 30], [-30, -30]],
      },
    ],
    mode: "single",
    angle: 90, // vertical lines
    tone: 0.5,
  };

  test("a hatch line through the hole is split into two segments", () => {
    const segs = generateHatch(annulus, { spacingPx: 20 });
    // vertical line near x = 0 passes through the hole → two spans: [-100,-30] and [30,100]
    const through = segs.filter(([a]) => Math.abs(a[0]) < 5);
    expect(through.length).toBe(2);
    // none of them cross the hole interior (|y| < 30)
    for (const [a, b] of segs) {
      const ys = [a[1], b[1]].sort((p, q) => p - q);
      // no segment spans across the hole band on the centre column
      if (Math.abs(a[0]) < 5) expect(ys[0]! >= 30 - 1e-6 || ys[1]! <= -30 + 1e-6).toBe(true);
    }
  });
});
