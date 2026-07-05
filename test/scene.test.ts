import { describe, expect, test } from "bun:test";
import type { Camera } from "../src/math/types.js";
import { Scene } from "../src/scene/scene.js";
import { sphere } from "../src/primitives/quadric.js";
import { Line } from "../src/primitives/line.js";
import { Cone } from "../src/primitives/cone.js";

const front: Camera = {
  eye: [0, 0, 10],
  target: [0, 0, 0],
  up: [0, 1, 0],
  projection: "orthographic",
  scale: 0.01,
  viewport: { width: 400, height: 400 },
};

// hatch strokes are the thin ones (HATCH_WEIGHT = 0.7); outlines are ≥ 1.35
const hatchOf = <T extends { style: { weight: number } }>(rs: readonly T[]): T[] =>
  rs.filter((s) => s.style.weight < 1);

describe("Element authoring API", () => {
  test("add returns a configurable element; setters chain", () => {
    const scene = new Scene();
    const el = scene.add(sphere([0, 0, 0], 1)).setImportance(1, { role: "subject" }).style({ wobble: 0.4 });
    expect(el.importance).toBe(1);
    expect(el.role).toBe("subject");
    expect(el.styleOverride.wobble).toBe(0.4);
  });

  test("role + overrides resolve with the right precedence", () => {
    const scene = new Scene({ style: { color: "#333" } });
    const subject = scene.add(sphere([0, 0, 0], 1)).setRole("subject");
    const context = scene.add(sphere([3, 0, 0], 1)).setRole("context");
    expect(scene.resolveSpec(subject.id).weight).toBe(1.7); // subject role
    expect(scene.resolveSpec(context.id).weight).toBe(1.0); // context role
    expect(scene.resolveSpec(subject.id).color).toBe("#333"); // scene default
    // element override beats role
    subject.style({ weight: 5 });
    expect(scene.resolveSpec(subject.id).weight).toBe(5);
  });
});

describe("Scene.render", () => {
  test("produces strokes, render strokes, and a well-formed SVG", () => {
    const scene = new Scene();
    scene.add(sphere([0, 0, 0], 1));
    scene.add(new Line([-3, 0, -2], [3, 0, -2]));
    const res = scene.render(front);
    expect(res.strokes.length).toBeGreaterThanOrEqual(2);
    expect(res.renderStrokes.length).toBeGreaterThanOrEqual(2);
    expect(res.svg.startsWith("<svg")).toBe(true);
    expect(res.svg).toContain("<polyline");
  });

  test("highlight redraws an element on top, heavier", () => {
    const plain = new Scene();
    plain.add(sphere([0, 0, 0], 1));
    const base = plain.render(front).renderStrokes.length;

    const scene = new Scene();
    const s = scene.add(sphere([0, 0, 0], 1));
    scene.highlight(s, { weight: 3, dashWhenHidden: true });
    const withH = scene.render(front).renderStrokes;
    expect(withH.length).toBeGreaterThan(base); // extra strokes, drawn last
    expect(withH.some((st) => st.style.weight === 3)).toBe(true);
    expect(withH[withH.length - 1]!.style.weight).toBe(3); // on top
  });

  test("highlight halo adds a thick, faint stroke under the crisp outline", () => {
    const scene = new Scene();
    const s = scene.add(sphere([0, 0, 0], 1));
    scene.highlight(s, { weight: 3, halo: { weight: 10, opacity: 0.2 } });
    const rs = scene.render(front).renderStrokes;
    expect(rs.some((st) => st.style.weight === 10 && Math.abs(st.style.opacity - 0.2) < 1e-9)).toBe(true);
    expect(rs.some((st) => st.style.weight === 3 && st.style.opacity === 1)).toBe(true);
  });

  test("wobble from element style perturbs the straight line run", () => {
    const scene = new Scene();
    scene.add(sphere([0, 0, 0], 1));
    const line = scene.add(new Line([-3, 0, -2], [3, 0, -2]));
    line.style({ wobble: 0.9 });
    const res = scene.render(front);
    // the line's visible runs should now be multi-point (densified + wobbled)
    const lineRuns = res.renderStrokes.filter((s) => s.style.weight >= 1);
    expect(lineRuns.some((s) => s.path.length > 2)).toBe(true);
  });
});

describe("Scene hatching", () => {
  test("no hatch unless the element style requests it", () => {
    const scene = new Scene();
    scene.add(sphere([0, 0, 0], 1));
    expect(hatchOf(scene.render(front).renderStrokes)).toHaveLength(0);
  });

  test("hatch weight/opacity are style-driven and overridable", () => {
    const scene = new Scene();
    scene.add(sphere([0, 0, 0], 2)).style({ hatch: { mode: "single", angle: 0, spacingPx: 18 }, hatchWeight: 0.4, hatchOpacity: 0.9 });
    const hatch = hatchOf(scene.render(front).renderStrokes);
    expect(hatch.length).toBeGreaterThan(0);
    expect(hatch[0]!.style.weight).toBeCloseTo(0.4);
    expect(hatch[0]!.style.opacity).toBeCloseTo(0.9);
  });

  test("a cone can be surface-hatched (curved-surface shading)", () => {
    const scene = new Scene({ light: { direction: [-0.5, -0.5, -0.7] } });
    scene.add(new Cone([0, 0, -1], [0, 0, 2], 1)).style({ hatch: { mode: "single", angle: 20, spacingPx: 10 } });
    expect(hatchOf(scene.render(front).renderStrokes).length).toBeGreaterThan(0);
  });

  test("a hatched sphere fills its disk, clipped to the silhouette", () => {
    const scene = new Scene();
    scene.add(sphere([0, 0, 0], 2)).style({ hatch: { mode: "single", angle: 0, spacingPx: 18 } });
    const hatch = hatchOf(scene.render(front).renderStrokes);
    expect(hatch.length).toBeGreaterThan(3);
    // sphere r=2 → 200px radius at (200,200); every hatch vertex is inside the disk
    for (const s of hatch) for (const [x, y] of s.path) {
      expect(Math.hypot(x - 200, y - 200)).toBeLessThan(201);
    }
  });

  test("occlusion removes hatch where the surface is hidden", () => {
    // total visible hatch length (occlusion splits lines, so length — not count —
    // is the right metric)
    const totalLength = (scene: Scene) => {
      let sum = 0;
      for (const s of hatchOf(scene.render(front).renderStrokes)) {
        for (let i = 1; i < s.path.length; i++) {
          sum += Math.hypot(s.path[i]![0] - s.path[i - 1]![0], s.path[i]![1] - s.path[i - 1]![1]);
        }
      }
      return sum;
    };
    const far = new Scene();
    far.add(sphere([0, 0, -3], 2)).style({ hatch: { mode: "cross", angle: 30, spacingPx: 12 } });
    const occluded = new Scene();
    occluded.add(sphere([0, 0, -3], 2)).style({ hatch: { mode: "cross", angle: 30, spacingPx: 12 } });
    occluded.add(sphere([0, 0, 2], 1.2)); // sits in front, covering the middle

    expect(totalLength(occluded)).toBeLessThan(totalLength(far));
  });

  test("tonal shading: a dark-lit sphere hatches more than a bright-lit one", () => {
    const totalLength = (scene: Scene) => {
      let sum = 0;
      for (const s of hatchOf(scene.render(front).renderStrokes))
        for (let i = 1; i < s.path.length; i++)
          sum += Math.hypot(s.path[i]![0] - s.path[i - 1]![0], s.path[i]![1] - s.path[i - 1]![1]);
      return sum;
    };
    // light travelling toward −z lights the camera-facing front (bright, sparse);
    // travelling toward +z leaves the front in shadow (dark, dense).
    const bright = new Scene({ light: { direction: [0, 0, -1] } });
    bright.add(sphere([0, 0, 0], 1)).style({ hatch: { mode: "triple", angle: 0, spacingPx: 10 } });
    const dark = new Scene({ light: { direction: [0, 0, 1] } });
    dark.add(sphere([0, 0, 0], 1)).style({ hatch: { mode: "triple", angle: 0, spacingPx: 10 } });
    expect(totalLength(dark)).toBeGreaterThan(totalLength(bright) * 1.5);
  });
});
