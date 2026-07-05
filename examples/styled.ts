// A styled scene: the Scene/importance model + full stage-4 styling
// (seeded wobble, ghosted hidden lines, cross/hatch shading). Run with:
//   bun run examples/styled.ts
//
// The sphere is the subject (bold, hero wobble, cross-hatched); the cylinder is
// context (lighter, single-hatched); the skewering line is drawn plain.

import { writeFileSync } from "node:fs";
import type { Camera } from "../src/math/types.js";
import { Scene } from "../src/scene/scene.js";
import { sphere } from "../src/primitives/quadric.js";
import { Cylinder } from "../src/primitives/cylinder.js";
import { Line } from "../src/primitives/line.js";

const cam: Camera = {
  eye: [4.5, 3.0, 4.2],
  target: [0, 0, 0.2],
  up: [0, 0, 1],
  projection: "perspective",
  scale: Math.PI / 4,
  viewport: { width: 720, height: 540 },
};

const scene = new Scene({
  light: { direction: [-0.6, -0.5, -0.7] },
  svg: { background: "#faf9f5" },
});

scene
  .add(sphere([0.1, 0.1, 1.6], 0.8))
  .setImportance(1, { role: "subject" })
  .style({ wobble: 0.7, hatch: { mode: "cross", angle: 30 } });

scene
  .add(new Cylinder([0, 0, -1.2], [0, 0, 2.4], 0.95))
  .setImportance(0.3, { role: "context" })
  .style({ wobble: 0.35 });

scene.add(new Line([-2.6, -1.6, 0.1], [2.7, 1.5, 0.1])).style({ wobble: 0.5 });

writeFileSync(new URL("./styled.svg", import.meta.url), scene.toSVG(cam));
console.log("wrote examples/styled.svg");
