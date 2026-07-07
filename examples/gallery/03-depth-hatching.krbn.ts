import type { Camera } from "../../src/math/types.js";
import { Scene } from "../../src/scene/scene.js";
import { sphere } from "../../src/primitives/quadric.js";
import { Polygon } from "../../src/primitives/polygon.js";
import { view } from "../../src/layout/index.js";

const BG = "#faf9f5";

// ---------------------------------------------------------------------------
// 3. Hatching with depth — a ball half-submerged through a plane. The exact
//    waterline (sphere ∩ plane) is bold, dashed on its hidden back arc; the
//    plane's hatch stops where the ball occludes it (gaps reveal depth); the
//    ball shades light→dark. Tone quantized (stage-3 abstraction).
// ---------------------------------------------------------------------------
const cam: Camera = {
  eye: [3.6, 2.6, 2.2],
  target: [0, 0, 0.1],
  up: [0, 0, 1],
  projection: "perspective",
  scale: Math.PI / 4,
  viewport: { width: 720, height: 540 },
};
const scene = new Scene({
  light: { direction: [-0.5, -0.6, -0.7] },
  svg: { background: BG },
  abstraction: { toneLevels: 3 },
});
const ball = scene
  .add(sphere([0, 0, 0.25], 1))
  .setImportance(1, { role: "subject" })
  .style({ wobble: 0.35, hatch: { mode: "cross", angle: 25, field: false } });
const water = scene
  .add(
    new Polygon([
      [-1.8, -1.8, 0],
      [1.8, -1.8, 0],
      [1.8, 1.8, 0],
      [-1.8, 1.8, 0],
    ]),
  )
  .setImportance(0.3, { role: "context" })
  .style({ wobble: 0.2, hatch: { mode: "single", angle: 0, spacingPx: 12 } });
scene.intersect(ball, water, { emphasis: "bold" }).style({ wobble: 0.35 });

export default view(scene, cam);
