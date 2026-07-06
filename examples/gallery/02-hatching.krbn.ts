import type { Camera } from "../../src/math/types.js";
import { Scene } from "../../src/scene/scene.js";
import { sphere } from "../../src/primitives/quadric.js";
import { Polygon } from "../../src/primitives/polygon.js";
import { raw, textAt, withLabels } from "../../src/layout/index.js";

const BG = "#faf9f5";

// ---------------------------------------------------------------------------
// 2. Hatching — the three modes, tonal shading on curved surfaces, and a flat
//    face that hatches uniformly. Light from upper-right.
// ---------------------------------------------------------------------------
const cam: Camera = {
  eye: [0, 0, 10],
  target: [0, 0, 0],
  up: [0, 1, 0],
  projection: "orthographic",
  scale: 0.008,
  viewport: { width: 1000, height: 320 },
};
const scene = new Scene({
  light: { direction: [-0.6, -0.5, -0.65] },
  svg: { background: BG },
});
const r = 0.85;
// field: false — this demo is the straight-hatch baseline; the sphere's own
// iso-parameter field gets its showcase in demo 12
scene.add(sphere([-2.9, 0, 0], r)).style({
  wobble: 0.25,
  hatch: { mode: "single", angle: 20, field: false },
});
scene
  .add(sphere([-0.9, 0, 0], r))
  .style({ wobble: 0.25, hatch: { mode: "cross", angle: 20, field: false } });
scene.add(sphere([1.1, 0, 0], r)).style({
  wobble: 0.25,
  hatch: { mode: "triple", angle: 20, field: false },
});
// a flat quad (seen face-on so it fills), single-hatched → uniform tone
scene
  .add(
    new Polygon([
      [2.7, -0.9, 0],
      [3.9, -0.9, 0],
      [3.9, 0.9, 0],
      [2.7, 0.9, 0],
    ]),
  )
  .style({ wobble: 0.2, hatch: { mode: "single", angle: 45 } });

export default raw(
  withLabels(scene.toSVG(cam), [
    textAt(cam, [-2.9, -1.15, 0], "1 layer"),
    textAt(cam, [-0.9, -1.15, 0], "2 layers"),
    textAt(cam, [1.1, -1.15, 0], "3 layers"),
    textAt(cam, [3.3, -1.15, 0], "flat"),
  ]),
);
