import { describe, expect, test } from "bun:test";
import type { Camera } from "../src/math/types.js";
import { Cone } from "../src/primitives/cone.js";

// 45° cone: apex at origin, axis +z, height 1, base radius 1.
const cone = new Cone([0, 0, 0], [0, 0, 1], 1);

const sideView: Camera = {
  eye: [10, 0, 0],
  target: [0, 0, 0],
  up: [0, 0, 1],
  projection: "orthographic",
  scale: 0.01,
  viewport: { width: 400, height: 400 },
};

describe("Cone — silhouette (ortho, side view)", () => {
  test("two generators from apex to base rim + one base circle", () => {
    const feats = cone.extractFeatures(sideView);
    const sil = feats.filter((f) => f.type === "silhouette");
    const bnd = feats.filter((f) => f.type === "boundary");
    expect(sil).toHaveLength(2);
    expect(bnd).toHaveLength(1);

    for (const f of sil) {
      if (f.curve.kind === "line") {
        // starts at apex
        expect(f.curve.a[0]!).toBeCloseTo(0);
        expect(f.curve.a[1]!).toBeCloseTo(0);
        expect(f.curve.a[2]!).toBeCloseTo(0);
        // ends on the base rim: (0, ±1, 1)
        expect(f.curve.b[0]!).toBeCloseTo(0);
        expect(Math.abs(f.curve.b[1]!)).toBeCloseTo(1);
        expect(f.curve.b[2]!).toBeCloseTo(1);
      }
    }
    if (bnd[0]!.curve.kind === "arc") {
      expect(bnd[0]!.curve.radius).toBeCloseTo(1);
      expect(bnd[0]!.curve.center[2]!).toBeCloseTo(1);
    }
  });

  test("view along the axis has no straight generators (rim only)", () => {
    const axial: Camera = { ...sideView, eye: [0, 0, 10], up: [0, 1, 0] };
    const sil = cone.extractFeatures(axial).filter((f) => f.type === "silhouette");
    expect(sil).toHaveLength(0);
  });

  test("projected silhouette: 2 generator lines + 1 rim conic (tilted)", () => {
    const tilted: Camera = { ...sideView, eye: [10, 0, 4] };
    const curves = cone.projectedSilhouettes(tilted);
    expect(curves.filter((c) => c.kind === "line")).toHaveLength(2);
    expect(curves.filter((c) => c.kind === "conic")).toHaveLength(1);
  });
});

describe("Cone — raycast", () => {
  test("ray at mid-height hits the lateral surface (radius scales with height)", () => {
    // at z = 0.5 the cone radius is 0.5
    const hits = cone.raycast({ origin: [10, 0, 0.5], dir: [-1, 0, 0] });
    expect(hits).toHaveLength(2);
    expect(hits[0]!.point[0]).toBeCloseTo(0.5);
    expect(hits[1]!.point[0]).toBeCloseTo(-0.5);
    expect(hits[0]!.frontFacing).toBe(true);
  });

  test("a ray above the finite height misses the lateral surface", () => {
    expect(cone.raycast({ origin: [10, 0, 5], dir: [-1, 0, 0] })).toHaveLength(0);
  });

  test("axial ray hits base cap then apex", () => {
    const hits = cone.raycast({ origin: [0, 0, 10], dir: [0, 0, -1] });
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits[0]!.point[2]).toBeCloseTo(1); // base cap at z = 1
  });
});

describe("Cone — bounds", () => {
  test("spans apex and base disk", () => {
    expect(cone.bounds().min).toEqual([-1, -1, 0]);
    expect(cone.bounds().max).toEqual([1, 1, 1]);
  });
});
