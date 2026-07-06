// ---------------------------------------------------------------------------
// 15. Mesh showcase (Phase 2). Two trefoil-knot tubes threaded through each
//     other — arbitrary organic geometry, not a primitive. Each tube is engraved
//     with its **curvature-driven hatch** (streamlines of the principal-direction
//     field wrapping the tube), and **mutual occlusion** falls out of the shared
//     visibility stage: where one tube passes behind the other its contour ghosts
//     away. Wobble + variable-width ribbons throughout.
// ---------------------------------------------------------------------------
import type { Camera } from "../../src/math/types.js";
import { Mesh } from "../../src/mesh/mesh-source.js";
import { knotTube, rotate, translate } from "../../src/mesh/shapes.js";
import { Scene } from "../../src/scene/scene.js";
import { grid } from "../../src/layout/index.js";

const BG = "#faf9f5";

const cam: Camera = {
  eye: [3.9, 3.0, 2.4],
  target: [0.7, 0, 0],
  up: [0, 0, 1],
  projection: "perspective",
  scale: Math.PI / 4.0,
  viewport: { width: 520, height: 440 },
};
const knotA = () => knotTube(0.3, 150, 20, 0.5);
const knotB = () => translate(rotate(knotTube(0.26, 130, 18, 0.42), [0, 1, 0], Math.PI / 2), [1.9, 0.2, 0.1]);
// left = curvature-driven hatch (streamlines wrap the tubes); right = flat parallels
const build = (field: boolean): string => {
  const scene = new Scene({ light: { direction: [-0.55, -0.4, -0.55] }, svg: { background: BG } });
  const style = { wobble: 0.25, ghostOpacity: 0.16, hatch: { mode: "single" as const, angle: field ? 0 : 28, spacingPx: 7, field } };
  scene.add(new Mesh(knotA())).style(style);
  scene.add(new Mesh(knotB())).style(style);
  return scene.render(cam).svg;
};
export default grid(cam.viewport, [[build(true), build(false)]], { rowLabels: [""], colLabels: ["curvature hatch", "flat hatch"] });
