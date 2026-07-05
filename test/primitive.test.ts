import { describe, expect, test } from "bun:test";
import type { Camera } from "../src/math/types.js";
import type { ConicParams } from "../src/curve/types.js";
import { sphere, ellipsoid } from "../src/primitives/quadric.js";

// Extract center + axes of an axis-aligned (B≈0) conic, assuming an ellipse.
// Scale-invariant, so it works on the arbitrarily-scaled projective conic.
function ellipseAxes(k: ConicParams): { cx: number; cy: number; rx: number; ry: number } {
  const { A, B, C, D, E, F } = k;
  expect(Math.abs(B) / (Math.abs(A) + Math.abs(C))).toBeLessThan(1e-6); // axis-aligned
  const cx = -D / (2 * A);
  const cy = -E / (2 * C);
  const K = (D * D) / (4 * A) + (E * E) / (4 * C) - F;
  return { cx, cy, rx: Math.sqrt(K / A), ry: Math.sqrt(K / C) };
}

const orthoCam: Camera = {
  eye: [0, 0, 10],
  target: [0, 0, 0],
  up: [0, 1, 0],
  projection: "orthographic",
  scale: 0.01, // world units per pixel → 100 px per unit
  viewport: { width: 400, height: 400 },
};

describe("sphere — object-space silhouette (ortho)", () => {
  test("is a circle of the sphere's radius in the plane through its center", () => {
    const s = sphere([0, 0, 0], 2);
    const feats = s.extractFeatures(orthoCam);
    expect(feats).toHaveLength(1);
    const f = feats[0]!;
    expect(f.type).toBe("silhouette");
    expect(f.curve.kind).toBe("conic");
    if (f.curve.kind === "conic") {
      const { rx, ry } = ellipseAxes(f.curve.params);
      expect(rx).toBeCloseTo(2);
      expect(ry).toBeCloseTo(2);
      // contour plane passes through the sphere centre, normal along view axis
      expect(f.curve.plane.origin[2]).toBeCloseTo(0);
      expect(Math.abs(f.curve.plane.z[2])).toBeCloseTo(1);
    }
  });

  test("no silhouette is produced when the eye is at the centre", () => {
    const s = sphere([0, 0, 0], 2);
    const degenerate: Camera = { ...orthoCam, projection: "perspective", eye: [0, 0, 0] };
    expect(s.extractFeatures(degenerate)).toHaveLength(0);
  });
});

describe("sphere — screen-space apparent outline", () => {
  test("ortho: a circle centred on the viewport, radius = r / scale", () => {
    const s = sphere([0, 0, 0], 2);
    const curves = s.projectedSilhouettes(orthoCam);
    expect(curves).toHaveLength(1);
    const c = curves[0]!;
    expect(c.kind).toBe("conic");
    if (c.kind === "conic") {
      const { cx, cy, rx, ry } = ellipseAxes(c.params);
      expect(cx).toBeCloseTo(200);
      expect(cy).toBeCloseTo(200);
      expect(rx).toBeCloseTo(200); // 2 / 0.01
      expect(ry).toBeCloseTo(200);
    }
  });

  test("perspective on-axis: still a circle centred on the viewport", () => {
    const s = sphere([0, 0, 0], 1);
    const persp: Camera = {
      eye: [0, 0, 5],
      target: [0, 0, 0],
      up: [0, 1, 0],
      projection: "perspective",
      scale: Math.PI / 3, // 60° vertical fov
      viewport: { width: 400, height: 400 },
    };
    const c = s.projectedSilhouettes(persp)[0]!;
    if (c.kind === "conic") {
      const { cx, cy, rx, ry } = ellipseAxes(c.params);
      expect(cx).toBeCloseTo(200);
      expect(cy).toBeCloseTo(200);
      expect(rx / ry).toBeCloseTo(1); // on-axis sphere → circle, not ellipse
      expect(rx).toBeGreaterThan(0);
    }
  });
});

describe("ellipsoid — screen outline aspect ratio (ortho)", () => {
  test("semi-axis ratio is preserved in the projected outline", () => {
    const e = ellipsoid([0, 0, 0], [3, 1, 2]); // viewed along z → 3:1 outline
    const c = e.projectedSilhouettes(orthoCam)[0]!;
    if (c.kind === "conic") {
      const { rx, ry } = ellipseAxes(c.params);
      const major = Math.max(rx, ry);
      const minor = Math.min(rx, ry);
      expect(major / minor).toBeCloseTo(3);
      expect(major).toBeCloseTo(300); // 3 / 0.01
      expect(minor).toBeCloseTo(100); // 1 / 0.01
    }
  });
});

describe("sphere — raycast (closed-form)", () => {
  const s = sphere([0, 0, 0], 2);

  test("axial ray: two ordered hits, correct normals and facing", () => {
    const hits = s.raycast({ origin: [0, 0, 10], dir: [0, 0, -1] });
    expect(hits).toHaveLength(2);
    expect(hits[0]!.t).toBeCloseTo(8); // enters at z = +2
    expect(hits[1]!.t).toBeCloseTo(12); // exits at z = -2
    expect(hits[0]!.point[2]).toBeCloseTo(2);
    expect(hits[0]!.normal[2]).toBeCloseTo(1);
    expect(hits[0]!.frontFacing).toBe(true);
    expect(hits[1]!.frontFacing).toBe(false);
  });

  test("tangent ray: single grazing hit (double root)", () => {
    const hits = s.raycast({ origin: [2, 0, 10], dir: [0, 0, -1] });
    expect(hits).toHaveLength(1);
    expect(hits[0]!.point[0]).toBeCloseTo(2);
    expect(hits[0]!.point[2]).toBeCloseTo(0);
  });

  test("missing ray: no hits (clean, no NaN)", () => {
    expect(s.raycast({ origin: [5, 0, 10], dir: [0, 0, -1] })).toHaveLength(0);
  });
});

describe("sphere — bounds", () => {
  test("axis-aligned box around the centre", () => {
    const b = sphere([1, 2, 3], 2).bounds();
    expect(b.min).toEqual([-1, 0, 1]);
    expect(b.max).toEqual([3, 4, 5]);
  });
});
