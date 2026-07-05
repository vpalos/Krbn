// A small demo scene rendered through the full Phase-1 pipeline
// (extract → visibility → emit → SVG). Run with:  bun run examples/demo.ts
//
// It exercises inter-object occlusion (sphere over cylinder), self-occlusion
// (the cylinder's far rim), and an occluded line — all with the default ghosted
// hidden-line styling.

import { writeFileSync } from "node:fs";
import type { Camera } from "../src/math/types.js";
import { sphere } from "../src/primitives/quadric.js";
import { Cylinder } from "../src/primitives/cylinder.js";
import { Cone } from "../src/primitives/cone.js";
import { Line } from "../src/primitives/line.js";
import { renderSceneSVG } from "../src/pipeline/render.js";

const cam: Camera = {
  eye: [4.5, 3.2, 4.5],
  target: [0, 0, 0.1],
  up: [0, 0, 1],
  projection: "perspective",
  scale: Math.PI / 4,
  viewport: { width: 720, height: 540 },
};

const scene = [
  new Cylinder([0, 0, -1.2], [0, 0, 2.4], 0.9),
  sphere([0.2, 0.1, 1.7], 0.7),
  new Cone([2.1, 0.2, -1.2], [0, 0, 1.7], 0.7),
  new Line([-2.6, -1.6, 0.2], [2.7, 1.5, 0.2]),
];

const svg = renderSceneSVG(scene, cam, { svg: { background: "#faf9f5" } });
writeFileSync(new URL("./demo.svg", import.meta.url), svg);
console.log("wrote examples/demo.svg");
