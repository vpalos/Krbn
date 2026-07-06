// 6. Highlight — a sphere sits behind a cylinder. `scene.highlight` re-draws the
//    sphere's outline on top of everything, heavier, and dashed where the
//    cylinder hides it (an x-ray emphasis).
import type { Camera } from "../../src/math/types.js";
import { sphere } from "../../src/primitives/quadric.js";
import { Cylinder } from "../../src/primitives/cylinder.js";
import { Scene } from "../../src/scene/scene.js";
import { stack } from "../../src/layout/index.js";

const BG = "#faf9f5";

const cam: Camera = {
  eye: [4.4, 3.1, 2.4],
  target: [0, 0, 0],
  up: [0, 0, 1],
  projection: "perspective",
  scale: Math.PI / 4,
  viewport: { width: 640, height: 480 },
};
const build = (wobble: number): string => {
  const scene = new Scene({ svg: { background: BG } });
  scene
    .add(new Cylinder([0, 0, -1.1], [0, 0, 2.2], 0.9))
    .setImportance(0.3, { role: "context" })
    .style({ wobble });
  const ball = scene.add(sphere([-1.75, -0.2, 0.5], 0.85)).style({ wobble }); // behind + beside: partly exposed
  // crisp outline on top + a thick, semi-transparent marker halo around it
  scene.highlight(ball, {
    weight: 1.8,
    dashWhenHidden: true,
    halo: { weight: 12, opacity: 0.28 },
  });
  return scene.render(cam).svg;
};

export default stack(build(0), build(0.8), cam.viewport, {
  top: "wobble: off",
  bottom: "wobble: on",
});
