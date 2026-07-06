// 7. Points — small camera-facing marks (× crosses and a dot), occludable like
//    any feature: the one behind the sphere is ghosted (faint dashed), the rest
//    are solid.
import type { Camera } from "../../src/math/types.js";
import { sphere } from "../../src/primitives/quadric.js";
import { Point } from "../../src/primitives/point.js";
import { Scene } from "../../src/scene/scene.js";
import { view } from "../../src/layout/index.js";

const BG = "#faf9f5";

const cam: Camera = {
  eye: [3.6, 2.6, 2.2],
  target: [0, 0, 0],
  up: [0, 0, 1],
  projection: "perspective",
  scale: Math.PI / 4,
  viewport: { width: 620, height: 460 },
};
const scene = new Scene({ svg: { background: BG } });
scene.add(sphere([0, 0, 0], 1)).setImportance(0.3, { role: "context" });
const marks: [number, number, number][] = [
  [1.7, 0, 0.9],
  [-1.6, 0.2, 0.6],
  [0.2, 1.7, -0.4],
  [0.1, -0.1, -1.9], // directly behind the sphere → ghosted
];
for (const m of marks) scene.add(new Point(m, { mark: "cross", sizePx: 9 }));
scene.add(new Point([0, 0, 1.6], { mark: "dot", sizePx: 10 }));

export default view(scene, cam);
