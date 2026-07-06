// ---------------------------------------------------------------------------
// 13. Mesh regime (Phase 2). A triangle mesh is just another `FeatureSource`, so
//     it renders through the same pipeline. Left: a smooth mesh sphere — its
//     silhouette is an interpolated zero-set and it shades from the interpolated
//     vertex normals. Right: a mesh torus — the silhouette's near arcs are solid
//     and the arcs behind the tube are dashed, hidden-line falling straight out of
//     the shared visibility stage (raycast + projected silhouettes). Wobbled and
//     variable-width like everything else.
// ---------------------------------------------------------------------------
import type { Camera } from "../../src/math/types.js";
import { Mesh } from "../../src/mesh/mesh-source.js";
import { torusMesh, uvSphere } from "../../src/mesh/shapes.js";
import { Scene } from "../../src/scene/scene.js";
import { grid } from "../../src/layout/index.js";

const BG = "#faf9f5";

const cam: Camera = {
  eye: [3.4, 2.6, 2.3],
  target: [0, 0, 0],
  up: [0, 0, 1],
  projection: "perspective",
  scale: Math.PI / 4.4,
  viewport: { width: 430, height: 380 },
};
const sphere = (): string => {
  const scene = new Scene({ light: { direction: [-0.5, -0.45, -0.55] }, svg: { background: BG } });
  scene.add(new Mesh(uvSphere(1.25, 32, 22))).style({ wobble: 0.4, hatch: { mode: "cross", angle: 20 } });
  return scene.render(cam).svg;
};
const torus = (): string => {
  const scene = new Scene({ light: { direction: [-0.55, 0.5, -0.55] }, svg: { background: BG } });
  // contours only, to show hidden-line on a mesh cleanly (near arcs solid, far dashed)
  scene.add(new Mesh(torusMesh(1.3, 0.5, 44, 22))).style({ wobble: 0.4 });
  return scene.render(cam).svg;
};
export default grid(cam.viewport, [[sphere(), torus()]], { rowLabels: [""], colLabels: ["mesh sphere (shaded)", "mesh torus (hidden-line)"] });
