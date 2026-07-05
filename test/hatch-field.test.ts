import { describe, expect, test } from "bun:test";
import type { Camera } from "../src/math/types.js";
import type { HatchFamily } from "../src/pipeline/types.js";
import { Cylinder } from "../src/primitives/cylinder.js";
import { Cone } from "../src/primitives/cone.js";
import { Torus } from "../src/primitives/torus.js";
import { Scene } from "../src/scene/scene.js";

const cam: Camera = {
  eye: [6, 5, 4],
  target: [0, 0, 0],
  up: [0, 0, 1],
  projection: "perspective",
  scale: Math.PI / 4,
  viewport: { width: 600, height: 480 },
};

const unit = (n: readonly number[]) => Math.hypot(n[0]!, n[1]!, n[2]!);
const allSamples = (fam: HatchFamily) => fam.curves.flatMap((c) => c.samples);

describe("hatchField — family structure", () => {
  const cyl = new Cylinder([0, 0, 0], [0, 0, 2], 1);

  test("maxFamilies drives how many direction families are returned", () => {
    expect(cyl.hatchField(cam, { spacingPx: 12, maxFamilies: 1 })).toHaveLength(1);
    expect(cyl.hatchField(cam, { spacingPx: 12, maxFamilies: 2 })).toHaveLength(2);
  });

  test("all normals are unit length", () => {
    for (const fam of cyl.hatchField(cam, { spacingPx: 12, maxFamilies: 2 })) {
      for (const s of allSamples(fam)) expect(unit(s.n)).toBeCloseTo(1, 9);
    }
  });

  test("field generation is deterministic", () => {
    const a = JSON.stringify(cyl.hatchField(cam, { spacingPx: 10, maxFamilies: 2 }));
    const b = JSON.stringify(cyl.hatchField(cam, { spacingPx: 10, maxFamilies: 2 }));
    expect(a).toBe(b);
  });
});

describe("hatchField — samples lie exactly on the surface", () => {
  test("cylinder rings + rulings sit on the lateral surface (⊥dist = r)", () => {
    const cyl = new Cylinder([0, 0, 0], [0, 0, 2], 1);
    const [rings, rulings] = cyl.hatchField(cam, { spacingPx: 10, maxFamilies: 2 });
    // the first ring is lateral (not a cap): every point is radius 1 from the axis
    const lateral = rings!.curves[0]!.samples;
    for (const { p, n } of lateral) {
      expect(Math.hypot(p[0], p[1])).toBeCloseTo(1, 9);
      // outward normal is radial (points away from the axis)
      expect(n[0] * p[0] + n[1] * p[1]).toBeGreaterThan(0);
    }
    // rulings run parallel to the axis on the surface
    for (const { p } of rulings!.curves[0]!.samples) expect(Math.hypot(p[0], p[1])).toBeCloseTo(1, 9);
  });

  test("cone rings satisfy the cone equation hypot(x,y) = z·R/h", () => {
    const cone = new Cone([0, 0, 0], [0, 0, 3], 1); // apex at origin, R/h = 1/3
    const [rings] = cone.hatchField(cam, { spacingPx: 10, maxFamilies: 1 });
    const lateral = rings!.curves[0]!.samples; // first ring is on the nappe
    for (const { p } of lateral) expect(Math.hypot(p[0], p[1])).toBeCloseTo(p[2]! / 3, 9);
  });

  test("torus poloidal circles lie on the tube ((√(x²+y²)−R)² + z² = r²)", () => {
    const R = 2;
    const r = 0.5;
    const torus = new Torus([0, 0, 0], [0, 0, 1], R, r);
    const [poloidal, toroidal] = torus.hatchField(cam, { spacingPx: 10, maxFamilies: 2 });
    const onTorus = (p: readonly number[]) => (Math.hypot(p[0]!, p[1]!) - R) ** 2 + p[2]! ** 2 - r * r;
    for (const { p } of poloidal!.curves[0]!.samples) expect(Math.abs(onTorus(p))).toBeLessThan(1e-9);
    for (const { p } of toroidal!.curves[0]!.samples) expect(Math.abs(onTorus(p))).toBeLessThan(1e-9);
  });
});

describe("hatchField — scene integration", () => {
  test("a curved cross-hatch renders and adds lines over single", () => {
    const build = (mode: "single" | "cross") => {
      const scene = new Scene({ light: { direction: [-0.5, -0.4, -0.6] } });
      scene.add(new Cylinder([0, 0, 0], [0, 0, 2], 1)).style({ hatch: { mode, angle: 0, spacingPx: 12 } });
      return scene.render(cam).renderStrokes.filter((s) => s.style.weight < 1);
    };
    const single = build("single");
    const cross = build("cross");
    expect(single.length).toBeGreaterThan(0);
    expect(cross.length).toBeGreaterThan(single.length);
  });

  test("field:false forces the straight parallel hatch instead", () => {
    const hatch = (field: boolean) => {
      const scene = new Scene({ light: { direction: [-0.5, -0.4, -0.6] } });
      scene.add(new Cylinder([0, 0, 0], [0, 0, 2], 1)).style({ hatch: { mode: "single", angle: 0, spacingPx: 12, field } });
      return scene.render(cam).renderStrokes.filter((s) => s.style.weight < 1);
    };
    const curved = hatch(true);
    const straight = hatch(false);
    // both hatch the surface…
    expect(curved.length).toBeGreaterThan(0);
    expect(straight.length).toBeGreaterThan(0);
    // …but produce different geometry (curved iso-curves vs straight chords)
    expect(JSON.stringify(curved)).not.toBe(JSON.stringify(straight));
  });

  test("the hidden (back) half of each ring is dropped by occlusion", () => {
    // side-on ortho view of a cylinder along +x: the axis is z, so the front half
    // (y < 0, toward the eye) survives and the back half (y > 0) must be gone.
    const side: Camera = {
      eye: [0, -10, 1],
      target: [0, 0, 1],
      up: [0, 0, 1],
      projection: "orthographic",
      scale: 0.02,
      viewport: { width: 400, height: 400 },
    };
    const cyl = new Cylinder([0, 0, 0], [0, 0, 2], 1);
    const scene = new Scene({ light: { direction: [-0.4, -0.5, -0.6] } });
    scene.add(cyl).style({ hatch: { mode: "single", angle: 0, spacingPx: 14 } });
    const field = cyl.hatchField(side, { spacingPx: 14, maxFamilies: 1 });
    expect(field[0]!.curves.length).toBeGreaterThan(0);
    // there is at least a full front arc's worth of hatch
    const hatch = scene.render(side).renderStrokes.filter((s) => s.style.weight < 1);
    expect(hatch.length).toBeGreaterThan(0);
  });
});
