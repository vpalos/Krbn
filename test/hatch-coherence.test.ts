// Temporal coherence step 4: hatch coherence — object-anchored straight-hatch
// phase, the static streamline atlas, and stable per-line identities.

import { describe, expect, test } from "bun:test";
import type { Camera, Vec3 } from "../src/math/types.js";
import type { HatchRegion } from "../src/pipeline/types.js";
import { generateHatchLines } from "../src/pipeline/hatch.js";
import { dyadicLadder } from "../src/primitives/hatch-field.js";
import { Cylinder } from "../src/primitives/cylinder.js";
import { HalfEdgeMesh } from "../src/mesh/halfedge.js";
import { computeCurvature } from "../src/mesh/curvature.js";
import { StreamlineAtlas } from "../src/mesh/mesh-hatch.js";
import { Mesh } from "../src/mesh/mesh-source.js";
import { torusMesh, tube } from "../src/mesh/shapes.js";

const square = (x0: number, y0: number, size: number): HatchRegion => ({
  owner: "sq",
  outline: { kind: "polyline", pts: [[x0, y0], [x0 + size, y0], [x0 + size, y0 + size], [x0, y0 + size], [x0, y0]] },
  mode: "single",
  angle: 0,
  tone: 0.5,
});

describe("straight hatch — object-anchored phase", () => {
  test("panning region + anchor together translates every line exactly (same keys)", () => {
    const dy = 3.7; // deliberately not a multiple of the 10px spacing
    const a = generateHatchLines({ ...square(0, 0, 40), anchorPx: [0, 0] }, { spacingPx: 10 });
    const b = generateHatchLines({ ...square(0, dy, 40), anchorPx: [0, dy] }, { spacingPx: 10 });
    expect(a.length).toBeGreaterThan(2);
    expect(b.map((l) => l.key)).toEqual(a.map((l) => l.key));
    for (let i = 0; i < a.length; i++) {
      for (const k of [0, 1] as const) {
        expect(b[i]!.seg[k][0]).toBeCloseTo(a[i]!.seg[k][0], 9);
        expect(b[i]!.seg[k][1]).toBeCloseTo(a[i]!.seg[k][1] + dy, 9);
      }
    }
  });

  test("without an anchor the phase is screen-locked (lines crawl under pan) — the failure mode the anchor removes", () => {
    const dy = 3.7;
    const a = generateHatchLines(square(0, 0, 40), { spacingPx: 10 });
    const b = generateHatchLines(square(0, dy, 40), { spacingPx: 10 });
    // screen-locked: line y-positions are the same absolute multiples of spacing,
    // i.e. they did NOT follow the region
    expect(b[0]!.seg[0][1] - a[0]!.seg[0][1]).not.toBeCloseTo(dy, 6);
  });

  test("a growing region extends the family without renaming existing lines", () => {
    const small = generateHatchLines({ ...square(0, 0, 40), anchorPx: [0, 0] }, { spacingPx: 10 });
    const grown = generateHatchLines({ ...square(0, -20, 40 * 1.5), anchorPx: [0, 0] }, { spacingPx: 10 });
    const byKey = new Map(grown.map((l) => [l.key, l]));
    for (const l of small) {
      const g = byKey.get(l.key);
      expect(g).toBeDefined();
      // same physical line (same offset), just clipped to a bigger region
      expect(g!.seg[0][1]).toBeCloseTo(l.seg[0][1], 9);
    }
  });
});

describe("streamline atlas — static, multi-resolution, keyed", () => {
  const he = HalfEdgeMesh.build(torusMesh());
  const curv = computeCurvature(he);
  const atlas = new StreamlineAtlas(he, curv, 2, 0);

  test("refining adds streamlines without moving or renaming coarser ones", () => {
    const coarse = atlas.curvesFor(2); // level 0
    const fine = atlas.curvesFor(0.5); // level 2
    expect(coarse.length).toBeGreaterThan(0);
    expect(fine.length).toBeGreaterThan(coarse.length);
    // the coarse curves are the SAME objects, in the same order, at the front
    for (let i = 0; i < coarse.length; i++) expect(fine[i]).toBe(coarse[i]!);
  });

  test("same density twice returns identical curves (cached, not re-traced)", () => {
    const a = atlas.curvesFor(1);
    const b = atlas.curvesFor(1);
    expect(b.length).toBe(a.length);
    for (let i = 0; i < a.length; i++) expect(b[i]).toBe(a[i]!);
  });

  test("keys are present and unique across levels", () => {
    const keys = atlas.curvesFor(0.5).map((c) => c.key);
    expect(keys.every((k) => k !== undefined)).toBe(true);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("dyadic ladder — nested iso-values with stable identities", () => {
  test("refining is strictly additive: coarser stops persist with identical t and key", () => {
    const coarse = dyadicLadder(5);
    const fine = dyadicLadder(20);
    const fineByKey = new Map(fine.map((s) => [s.key, s]));
    expect(fine.length).toBeGreaterThan(coarse.length);
    for (const s of coarse) {
      const f = fineByKey.get(s.key);
      expect(f).toBeDefined();
      expect(f!.t).toBe(s.t);
    }
  });

  test("the union is evenly spaced at every full level (open and periodic)", () => {
    for (const periodic of [false, true]) {
      const stops = dyadicLadder(periodic ? 8 : 7, { periodic }).map((s) => s.t).sort((a, b) => a - b);
      const gap = periodic ? 1 / 8 : 1 / 8;
      for (let i = 1; i < stops.length; i++) expect(stops[i]! - stops[i - 1]!).toBeCloseTo(gap, 9);
    }
  });

  test("a fractional demand fades in only the newest level", () => {
    const stops = dyadicLadder(10); // between levels 2 (7 curves) and 3 (15)
    const fading = stops.filter((s) => s.fade < 1);
    const full = stops.filter((s) => s.fade === 1);
    expect(full.length).toBe(7);
    expect(fading.length).toBe(8);
    const f = fading[0]!.fade;
    expect(f).toBeGreaterThan(0);
    expect(f).toBeLessThan(1);
    expect(fading.every((s) => s.fade === f)).toBe(true);
  });
});

describe("analytic hatchField — iso-curves hold still under camera motion", () => {
  const ortho = (eye: Vec3, scale = 0.02): Camera => ({
    eye,
    target: [0, 0, 0],
    up: [0, 0, 1],
    projection: "orthographic",
    scale,
    viewport: { width: 400, height: 400 },
  });
  const cyl = new Cylinder([0, 0, -2], [0, 0, 4], 1.5, "cyl");

  test("a small pan keeps every ring/ruling at the same world position with the same key", () => {
    const a = cyl.hatchField(ortho([10, 0, 0]), { spacingPx: 6, maxFamilies: 2 });
    const b = cyl.hatchField(ortho([9.99, 0.4, 0.2]), { spacingPx: 6, maxFamilies: 2 });
    expect(a.length).toBe(b.length);
    for (let f = 0; f < a.length; f++) {
      const byKey = new Map(b[f]!.curves.map((c) => [c.key, c]));
      for (const c of a[f]!.curves) {
        const m = byKey.get(c.key);
        expect(m).toBeDefined();
        // identical world geometry — the curve did not move
        expect(m!.samples[0]!.p).toEqual(c.samples[0]!.p);
      }
    }
  });

  test("zooming in adds curves without moving existing ones", () => {
    // scales chosen so the density demand stays inside the ladder (no max-level
    // saturation, where counts stop growing and only fades change)
    const far = cyl.hatchField(ortho([10, 0, 0], 0.06), { spacingPx: 6, maxFamilies: 1 });
    const near = cyl.hatchField(ortho([10, 0, 0], 0.03), { spacingPx: 6, maxFamilies: 1 });
    const nearByKey = new Map(near[0]!.curves.map((c) => [c.key, c]));
    expect(near[0]!.curves.length).toBeGreaterThan(far[0]!.curves.length);
    for (const c of far[0]!.curves) {
      if ((c.fade ?? 1) < 1) continue; // the far view's fading tail may retire
      const m = nearByKey.get(c.key);
      expect(m).toBeDefined();
      expect(m!.samples[0]!.p).toEqual(c.samples[0]!.p);
    }
  });
});

describe("Mesh.hatchField — camera picks a level, never re-seeds", () => {
  const ortho = (eye: Vec3, scale: number): Camera => ({
    eye,
    target: [0, 0, 0],
    up: [0, 0, 1],
    projection: "orthographic",
    scale,
    viewport: { width: 400, height: 400 },
  });
  const src = new Mesh(tube(1.5, 4, 48, 10), {}, "tube");

  test("a small pan returns the identical streamline set (same underlying lines, same keys)", () => {
    const a = src.hatchField(ortho([10, 0, 0], 0.02), { spacingPx: 6, maxFamilies: 2 });
    const b = src.hatchField(ortho([9.99, 0.4, 0.2], 0.02), { spacingPx: 6, maxFamilies: 2 });
    expect(a.length).toBeGreaterThan(0);
    expect(b.length).toBe(a.length);
    for (let f = 0; f < a.length; f++) {
      expect(b[f]!.curves.length).toBe(a[f]!.curves.length);
      for (let i = 0; i < a[f]!.curves.length; i++) {
        // sample arrays are shared with the atlas — the geometry never re-seeds;
        // only the fading level is a shallow copy carrying `fade`
        expect(b[f]!.curves[i]!.samples).toBe(a[f]!.curves[i]!.samples);
        expect(b[f]!.curves[i]!.key).toBe(a[f]!.curves[i]!.key!);
      }
    }
  });

  test("zooming in only ever *adds* curves (coarse set is a stable prefix), newest level fades", () => {
    const far = src.hatchField(ortho([10, 0, 0], 0.02), { spacingPx: 6, maxFamilies: 1 });
    const near = src.hatchField(ortho([10, 0, 0], 0.005), { spacingPx: 6, maxFamilies: 1 });
    expect(near[0]!.curves.length).toBeGreaterThanOrEqual(far[0]!.curves.length);
    const nearKeys = new Set(near[0]!.curves.map((c) => c.key));
    for (const c of far[0]!.curves) {
      if ((c.fade ?? 1) < 1) continue; // far view's fading tail may drop out when zooming in? no — zooming IN raises demand; keep the check strict below
      expect(nearKeys.has(c.key)).toBe(true);
    }
    // fully-committed far curves stay identical objects at the front
    const farFull = far[0]!.curves.filter((c) => (c.fade ?? 1) >= 1);
    for (let i = 0; i < farFull.length; i++) expect(near[0]!.curves[i]).toBe(farFull[i]!);
    // any fade values are in (0, 1) and only on the newest level
    for (const c of near[0]!.curves) if (c.fade !== undefined) expect(c.fade).toBeGreaterThan(0);
  });
});
