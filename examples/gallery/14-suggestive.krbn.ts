// ---------------------------------------------------------------------------
// 14. Suggestive contours (Phase 2, §3.3.5). The extra lines an artist draws
//     where the surface *almost* turns away — zeros of radial curvature on the
//     front-facing surface, increasing in the view direction (DeCarlo et al.).
//     They extend the true silhouette into the concave regions a plain contour
//     leaves blank. Left: silhouette only. Right: with suggestive contours (the
//     lighter form lines). From the mesh's curvature precompute.
// ---------------------------------------------------------------------------
import type { Camera } from "../../src/math/types.js";
import { Mesh } from "../../src/mesh/mesh-source.js";
import { torusMesh } from "../../src/mesh/shapes.js";
import { Scene } from "../../src/scene/scene.js";
import { grid } from "../../src/layout/index.js";

const BG = "#faf9f5";

const cam: Camera = {
  eye: [3.2, 2.4, 1.7],
  target: [0, 0, 0],
  up: [0, 0, 1],
  projection: "perspective",
  scale: Math.PI / 4.6,
  viewport: { width: 430, height: 360 },
};
const build = (suggestive: boolean): string => {
  const scene = new Scene({ light: { direction: [-0.5, -0.4, -0.6] }, svg: { background: BG } });
  scene.add(new Mesh(torusMesh(1.3, 0.52, 72, 36), { suggestive: suggestive ? { threshold: 0 } : false })).style({ wobble: 0.3 });
  return scene.render(cam).svg;
};
export default grid(cam.viewport, [[build(false), build(true)]], { rowLabels: [""], colLabels: ["silhouette only", "+ suggestive contours"] });
