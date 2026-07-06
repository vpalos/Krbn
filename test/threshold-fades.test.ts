// Temporal coherence step 5 (part 1): stateless fades at hard thresholds —
// abstraction's screen-size cull band, suggestive-contour strength, and the
// opacity plumbing through styling.

import { describe, expect, test } from "bun:test";
import type { Camera, Vec3 } from "../src/math/types.js";
import type { Stroke } from "../src/pipeline/types.js";
import { applyAbstraction, FADE_RATIO } from "../src/pipeline/abstract.js";
import { emitStyledStroke, resolveStyle } from "../src/pipeline/style.js";
import { Mesh } from "../src/mesh/mesh-source.js";
import { torusMesh } from "../src/mesh/shapes.js";

const ortho = (eye: Vec3): Camera => ({
  eye,
  target: [0, 0, 0],
  up: [0, 1, 0],
  projection: "orthographic",
  scale: 0.02,
  viewport: { width: 400, height: 400 },
});

/** a fully-visible classified stroke over a screen line of length `px` */
const strokeOf = (px: number, owner = "el"): Stroke => ({
  feature: { type: "crease", owner, id: `${owner}/crease:0`, curve: { kind: "line", a: [0, 0, 0], b: [px * 0.02, 0, 0] }, attrs: {} },
  screen: { kind: "line", a: [0, 0], b: [px, 0] },
  intervals: [{ t0: 0, t1: 1, visible: true }],
});

describe("abstraction cull — fade band instead of a pop", () => {
  const opts = { minFeaturePx: 10, importanceOf: () => 0 }; // cutoff = 10, band = [10, 16)

  test("below the cutoff drops, inside the band fades, above it is untouched", () => {
    expect(applyAbstraction([strokeOf(9)], opts)).toHaveLength(0);
    const faded = applyAbstraction([strokeOf(13)], opts);
    expect(faded).toHaveLength(1);
    expect(faded[0]!.fade).toBeCloseTo((13 - 10) / (FADE_RATIO * 10 - 10), 9);
    const kept = applyAbstraction([strokeOf(40)], opts);
    expect(kept).toHaveLength(1);
    expect(kept[0]!.fade).toBeUndefined();
  });

  test("fade is continuous: approaching the cutoff from above goes to 0", () => {
    const nearCut = applyAbstraction([strokeOf(10.01)], opts)[0]!;
    const nearTop = applyAbstraction([strokeOf(15.99)], opts)[0]!;
    expect(nearCut.fade!).toBeLessThan(0.01);
    expect(nearTop.fade!).toBeGreaterThan(0.99);
  });
});

describe("styling — fade and strength multiply stroke opacity", () => {
  const cam = ortho([0, 0, 10]);
  const spec = resolveStyle();

  test("stroke.fade scales opacity; fade 0 emits nothing", () => {
    const st = strokeOf(100);
    const full = emitStyledStroke(st, cam, spec);
    expect(full[0]!.style.opacity).toBe(1);
    const faded = emitStyledStroke({ ...st, fade: 0.4 }, cam, spec);
    expect(faded[0]!.style.opacity).toBeCloseTo(0.4, 9);
    expect(emitStyledStroke({ ...st, fade: 0 }, cam, spec)).toHaveLength(0);
  });

  test("attrs.strength compounds with stroke.fade", () => {
    const st = strokeOf(100);
    st.feature.attrs.strength = 0.5;
    const out = emitStyledStroke({ ...st, fade: 0.5 }, cam, spec);
    expect(out[0]!.style.opacity).toBeCloseTo(0.25, 9);
  });
});

describe("suggestive contours — strength from the D_w κ_r margin", () => {
  const cam = ortho([0, -6, 2.2]);

  test("a fade band yields strengths in (0,1]; without it all contours are full-strength", () => {
    const hard = new Mesh(torusMesh(), { suggestive: { threshold: 0.05 } }, "t1");
    const soft = new Mesh(torusMesh(), { suggestive: { threshold: 0.05, fade: 100 } }, "t2");
    const sHard = hard.extractFeatures(cam).filter((f) => f.type === "suggestive");
    const sSoft = soft.extractFeatures(cam).filter((f) => f.type === "suggestive");
    expect(sHard.length).toBeGreaterThan(0);
    expect(sHard.every((f) => f.attrs.strength === undefined)).toBe(true);
    // an absurdly wide band ⇒ every contour is partial-strength
    expect(sSoft.length).toBe(sHard.length);
    expect(sSoft.every((f) => f.attrs.strength !== undefined && f.attrs.strength > 0 && f.attrs.strength < 1)).toBe(true);
  });
});
