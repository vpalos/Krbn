// 10. Torus — the one non-quadric primitive. Its silhouette is a *quartic* image
//     curve, extracted numerically from the implicit form as two contour loops
//     (outer + hole) and hidden-line classified: the near arcs are solid, the far
//     arcs (behind the tube) dashed. Two rows (wobble off / on).
import type { Camera } from "../../src/math/types.js";
import { Torus } from "../../src/primitives/torus.js";
import { Scene } from "../../src/scene/scene.js";
import { grid } from "../../src/layout/index.js";

const BG = "#faf9f5";

const cam: Camera = {
  eye: [4.0, 3.0, 2.7],
  target: [0, 0, 0],
  up: [0, 0, 1],
  projection: "perspective",
  scale: Math.PI / 4.6,
  viewport: { width: 620, height: 400 },
};
const build = (wobble: number, field: boolean): string => {
  const scene = new Scene({
    light: { direction: [-0.55, 0.5, -0.55] },
    svg: { background: BG },
  });
  scene
    .add(new Torus([0, 0, 0], [0, 0, 1], 1.5, 0.6))
    .style({ wobble, hatch: { mode: "cross", angle: 20, field } });
  return scene.render(cam).svg;
};
// rows = wobble off / on; columns = curved poloidal/toroidal field vs flat parallels

export default grid(
  { width: cam.viewport.width, height: cam.viewport.height },
  [
    [build(0, false), build(0, true)],
    [build(0.6, false), build(0.6, true)],
  ],
  {
    rowLabels: ["wobble: off", "wobble: on"],
    colLabels: ["flat", "curved field"],
  },
);
