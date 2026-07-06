// ---------------------------------------------------------------------------
// 11. Two interlocking toruses (chain links) passing through each other, each
//     cross-hatched and wobbled. Mutual occlusion falls out of the visibility
//     stage — each torus dashes the other's hidden silhouette and stops its hatch
//     where the other is in front.
// ---------------------------------------------------------------------------
import type { Camera } from "../../src/math/types.js";
import { Torus } from "../../src/primitives/torus.js";
import { Scene } from "../../src/scene/scene.js";
import { grid } from "../../src/layout/index.js";

const BG = "#faf9f5";

const cam: Camera = {
  eye: [4.4, 3.2, 3.4],
  target: [0.7, 0, 0.1],
  up: [0, 0, 1],
  projection: "perspective",
  scale: Math.PI / 6,
  viewport: { width: 680, height: 680 },
};
const build = (mode: "single" | "cross", field: boolean): string => {
  const scene = new Scene({
    light: { direction: [-0.55, 0.5, -0.55] },
    svg: { background: BG },
  });
  scene
    .add(new Torus([0, 0, 0], [0, 0, 1], 1.3, 0.42))
    .style({ wobble: 0.7, hatch: { mode, angle: 22, field } });
  scene
    .add(new Torus([1.4, 0, 0], [0, 1, 0], 1.5, 0.42))
    .style({ wobble: 0.7, hatch: { mode, angle: -22, field } });
  return scene.render(cam).svg;
};
// columns = curved poloidal/toroidal field vs flat parallel hatch
export default grid(
  cam.viewport,
  [
    [build("single", true), build("single", false)],
    [build("cross", true), build("cross", false)],
  ],
  { rowLabels: [""], colLabels: ["curved field", "flat"] },
);
