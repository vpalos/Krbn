// Intersection curves + abstraction. A sphere half-cut by a plane: the exact
// waterline (sphere ∩ plane = circle) is emitted as a bold `intersection`
// feature and drawn through the same visibility + styling pipeline. Cross-hatch
// tone is quantized (stage-3 abstraction). Run with:  bun run examples/waterline.ts

import { writeFileSync } from "node:fs";
import type { Camera } from "../src/math/types.js";
import { Scene } from "../src/scene/scene.js";
import { sphere } from "../src/primitives/quadric.js";
import { Polygon } from "../src/primitives/polygon.js";

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
  svg: { background: "#faf9f5" },
  abstraction: { toneLevels: 3 }, // quantize hatch shading
});

const ball = scene
  .add(sphere([0, 0, 0.55], 1))
  .setImportance(1, { role: "subject" })
  .style({ wobble: 0.4, hatch: { mode: "cross", angle: 25 } });

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
  .style({ wobble: 0.25, hatch: { mode: "single", angle: 0, spacingPx: 12 } });

// the exact waterline where the sphere meets the plane
scene.intersect(ball, water, { emphasis: "bold" }).style({ wobble: 0.4 });

writeFileSync(new URL("./waterline.svg", import.meta.url), scene.toSVG(cam));
console.log("wrote examples/waterline.svg");
