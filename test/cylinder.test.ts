import { describe, expect, test } from "bun:test";
import type { Camera } from "../src/math/types.js";
import { Cylinder } from "../src/primitives/cylinder.js";

// Cylinder along z, from z=-1 to z=1, radius 1.
const cyl = new Cylinder([0, 0, -1], [0, 0, 2], 1);

// Orthographic view along -x, screen-up = world z.
const sideView: Camera = {
  eye: [10, 0, 0],
  target: [0, 0, 0],
  up: [0, 0, 1],
  projection: "orthographic",
  scale: 0.01,
  viewport: { width: 400, height: 400 },
};

describe("Cylinder — silhouette (ortho, perpendicular view)", () => {
  test("two axis-parallel rulings + two rim circles", () => {
    const feats = cyl.extractFeatures(sideView);
    const sil = feats.filter((f) => f.type === "silhouette");
    const bnd = feats.filter((f) => f.type === "boundary");
    expect(sil).toHaveLength(2);
    expect(bnd).toHaveLength(2);
    // rulings sit at y = ±1, x = 0, spanning z ∈ [-1, 1]
    for (const f of sil) {
      if (f.curve.kind === "line") {
        expect(Math.abs(f.curve.a[1]!)).toBeCloseTo(1);
        expect(f.curve.a[0]!).toBeCloseTo(0);
        expect(Math.abs(f.curve.a[2]! - f.curve.b[2]!)).toBeCloseTo(2); // full height
      }
    }
    // rims are full circles of radius 1
    for (const f of bnd) {
      expect(f.curve.kind).toBe("arc");
      if (f.curve.kind === "arc") expect(f.curve.radius).toBeCloseTo(1);
    }
  });

  test("projected silhouette: 2 ruling lines + 2 rim conics (tilted view)", () => {
    // A tilted view so the rim circles are not edge-on and project to ellipses.
    const tilted: Camera = { ...sideView, eye: [10, 0, 4] };
    const curves = cyl.projectedSilhouettes(tilted);
    expect(curves.filter((c) => c.kind === "line")).toHaveLength(2);
    expect(curves.filter((c) => c.kind === "conic")).toHaveLength(2);
  });

  test("edge-on rims (perpendicular view) collapse — only rulings survive as lines", () => {
    const curves = cyl.projectedSilhouettes(sideView);
    expect(curves.filter((c) => c.kind === "line")).toHaveLength(2);
    expect(curves.filter((c) => c.kind === "conic")).toHaveLength(0);
  });

  test("view along the axis degenerates (no rulings)", () => {
    const axial: Camera = { ...sideView, eye: [0, 0, 10], up: [0, 1, 0] };
    const sil = cyl.extractFeatures(axial).filter((f) => f.type === "silhouette");
    expect(sil).toHaveLength(0);
  });
});

describe("Cylinder — raycast (finite solid)", () => {
  test("perpendicular ray hits the lateral surface twice", () => {
    const hits = cyl.raycast({ origin: [10, 0, 0], dir: [-1, 0, 0] });
    expect(hits).toHaveLength(2);
    expect(hits[0]!.point[0]).toBeCloseTo(1); // enters at x = +1
    expect(hits[1]!.point[0]).toBeCloseTo(-1);
    expect(hits[0]!.frontFacing).toBe(true);
  });

  test("axial ray hits the two caps", () => {
    const hits = cyl.raycast({ origin: [0, 0, 10], dir: [0, 0, -1] });
    expect(hits).toHaveLength(2);
    expect(hits[0]!.point[2]).toBeCloseTo(1); // top cap first
    expect(hits[1]!.point[2]).toBeCloseTo(-1);
    expect(hits[0]!.normal[2]).toBeCloseTo(1);
  });

  test("a ray passing above the finite extent misses", () => {
    // aimed along -x but at z = 5, outside [-1,1]
    const hits = cyl.raycast({ origin: [10, 0, 5], dir: [-1, 0, 0] });
    expect(hits).toHaveLength(0);
  });
});

describe("Cylinder — surface hatching", () => {
  test("hatchRegions returns a polygon footprint (silhouette hull)", () => {
    const regions = cyl.hatchRegions(sideView, { direction: [-0.5, -0.5, -0.7] });
    expect(regions).toHaveLength(1);
    expect(regions[0]!.outline.kind).toBe("polyline");
    if (regions[0]!.outline.kind === "polyline") expect(regions[0]!.outline.pts.length).toBeGreaterThanOrEqual(3);
  });
});

describe("Cylinder — bounds", () => {
  test("tight AABB for an axis-aligned cylinder", () => {
    expect(cyl.bounds().min).toEqual([-1, -1, -1]);
    expect(cyl.bounds().max).toEqual([1, 1, 1]);
  });
});
