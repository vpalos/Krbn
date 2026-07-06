// Temporal coherence step 6: the animation harness's property tests — the
// end-to-end guarantees every prior step adds up to. Over a slow camera orbit
// of a mixed analytic + mesh scene (hatch + wobble on):
//   • identity: zero persistent-id churn (no born/died/reversed) between
//     adjacent frames away from topological events;
//   • continuity: a small camera step moves every stroke a small screen
//     distance — nothing jumps;
//   • determinism: two fresh sessions over the same camera path emit
//     byte-identical SVG.

import { describe, expect, test } from "bun:test";
import type { Camera, Vec3 } from "../src/math/types.js";
import { Scene } from "../src/scene/scene.js";
import { FrameSession } from "../src/scene/session.js";
import { Mesh } from "../src/mesh/mesh-source.js";
import { torusMesh } from "../src/mesh/shapes.js";
import { sphere } from "../src/primitives/quadric.js";
import { Cylinder } from "../src/primitives/cylinder.js";

const STEP = 0.005; // rad per frame — a slow orbit
const FRAMES = 6;

const cam = (a: number): Camera => ({
  eye: [9 * Math.sin(a), -9 * Math.cos(a), 3.5],
  target: [0, 0, 0],
  up: [0, 0, 1],
  projection: "orthographic",
  scale: 0.02,
  viewport: { width: 640, height: 480 },
});

const buildScene = (): Scene => {
  const scene = new Scene({ style: { wobble: 0.6 }, abstraction: { minFeaturePx: 6 } });
  scene.add(new Mesh(torusMesh(1.1, 0.45, 40, 20), {}, "torus"), { style: { hatch: { mode: "single", angle: 0 } } });
  scene.add(sphere([2.2, 1.2, 0.4], 0.8, "ball"), { style: { hatch: { mode: "cross", angle: 20 } } });
  scene.add(new Cylinder([-2.4, -0.6, -1.1], [0, 0, 2.2], 0.7, "cyl"), { style: { hatch: { mode: "single", angle: 0 } } });
  return scene;
};

describe("animation harness — end-to-end coherence over a camera orbit", () => {
  const session = new FrameSession(buildScene());
  const frames = Array.from({ length: FRAMES }, (_, k) => session.render(cam(k * STEP)));

  test("zero identity churn between adjacent frames (no events on this orbit)", () => {
    for (let k = 1; k < FRAMES; k++) {
      expect(frames[k]!.coherence.born).toEqual([]);
      expect(frames[k]!.coherence.died).toEqual([]);
      expect(frames[k]!.coherence.reversed).toEqual([]);
    }
  });

  test("every stroke's persistent id set is identical across all frames", () => {
    const ids0 = frames[0]!.strokes.map((s) => s.feature.id).sort();
    expect(ids0.length).toBeGreaterThan(0);
    for (let k = 1; k < FRAMES; k++) {
      expect(frames[k]!.strokes.map((s) => s.feature.id).sort()).toEqual(ids0);
    }
  });

  test("a small camera step moves each stroke a small screen distance", () => {
    const centroid = (pts: readonly (readonly [number, number])[]): [number, number] => {
      let x = 0, y = 0;
      for (const p of pts) {
        x += p[0] / pts.length;
        y += p[1] / pts.length;
      }
      return [x, y];
    };
    for (let k = 1; k < FRAMES; k++) {
      const prev = new Map(
        frames[k - 1]!.strokes.filter((s) => s.screen.kind === "polyline").map((s) => [s.feature.id, s.screen] as const),
      );
      let compared = 0;
      for (const s of frames[k]!.strokes) {
        if (s.screen.kind !== "polyline") continue;
        const p = prev.get(s.feature.id);
        if (!p || p.kind !== "polyline") continue;
        const [ax, ay] = centroid(s.screen.pts);
        const [bx, by] = centroid(p.pts);
        expect(Math.hypot(ax - bx, ay - by)).toBeLessThan(5);
        compared++;
      }
      expect(compared).toBeGreaterThan(0);
    }
  });

  test("hatch volume stays steady frame to frame (no re-deal)", () => {
    for (let k = 1; k < FRAMES; k++) {
      const a = frames[k - 1]!.renderStrokes.length;
      const b = frames[k]!.renderStrokes.length;
      // clipping shifts run counts slightly; a re-seed/re-deal would swing wildly
      expect(Math.abs(b - a)).toBeLessThan(0.1 * a);
    }
  });

  test("two fresh sessions over the same path are byte-identical", () => {
    const s1 = new FrameSession(buildScene());
    const s2 = new FrameSession(buildScene());
    for (let k = 0; k < 3; k++) {
      const a = s1.render(cam(k * STEP));
      const b = s2.render(cam(k * STEP));
      expect(b.svg).toBe(a.svg);
    }
  });
});
