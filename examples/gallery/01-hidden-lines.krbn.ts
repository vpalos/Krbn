import type { Camera } from "../../src/math/types.js";
import { Scene } from "../../src/scene/scene.js";
import { sphere } from "../../src/primitives/quadric.js";
import { Cylinder } from "../../src/primitives/cylinder.js";
import { Line } from "../../src/primitives/line.js";
import { view } from "../../src/layout/index.js";

const BG = "#faf9f5";

// ---------------------------------------------------------------------------
// 1. Visible / hidden lines — exact quantitative invisibility.
//    A cylinder self-occludes (its far rim halves are ghosted/dashed) and a rod
//    skewers it (dashed where it passes through the body, solid outside). A far
//    sphere sits beside it, its silhouette dashed only where the cylinder hides
//    it. Wobble 0 to keep the focus on the visibility classification.
// ---------------------------------------------------------------------------
const cam: Camera = {
  eye: [4.6, 3.2, 2.7],
  target: [0, 0, -0.1],
  up: [0, 0, 1],
  projection: "perspective",
  scale: Math.PI / 4,
  viewport: { width: 720, height: 520 },
};
const scene = new Scene({ svg: { background: BG } });
scene.add(new Cylinder([0, 0, -1.1], [0, 0, 2.2], 0.9));
// sphere beside/behind the cylinder: the exposed part is solid, the part the
// cylinder hides is dashed
scene.add(sphere([-1.85, -0.15, 0.1], 0.9));
scene.add(new Line([-2.4, -1.6, 0.35], [2.6, 1.5, -0.15])); // rod skewering the cylinder

export default view(scene, cam);
