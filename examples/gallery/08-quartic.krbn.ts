// 8. Quadric ∩ quadric quartic — an ellipsoid meeting a sphere. Their
//    intersection is a quartic space curve, traced via plane-sweep + the exact
//    conic∩conic kernel and drawn as a bold loop, solid where visible and dashed
//    where it passes behind the surfaces. Columns: wireframe / straight triple
//    hatch / the surfaces' own iso-parameter fields (triple: parallels +
//    meridians + the diagonal third family).
import type { Camera } from "../../src/math/types.js";
import { sphere, ellipsoid } from "../../src/primitives/quadric.js";
import { Scene } from "../../src/scene/scene.js";
import { grid } from "../../src/layout/index.js";

const BG = "#faf9f5";

const cam: Camera = {
  eye: [3.4, 2.6, 2.1],
  target: [0, 0, 0],
  up: [0, 0, 1],
  projection: "perspective",
  scale: Math.PI / 4.4,
  viewport: { width: 560, height: 420 },
};
// rows = wobble off / on; columns = wireframe / flat hatch / curved field
type Shade = "wire" | "flat" | "field";
const build = (wobble: number, shade: Shade): string => {
  // front-lit (from the camera side, upper) so the highlight faces the viewer
  const scene = new Scene({
    light: { direction: [-0.4, -0.45, -0.55] },
    svg: { background: BG },
  });
  const style =
    shade === "wire"
      ? { wobble }
      : {
          wobble,
          hatch: {
            mode: "triple" as const,
            angle: 20,
            spacingPx: 6,
            field: shade === "field",
          },
        };
  const a = scene
    .add(ellipsoid([-0.55, 0, 0], [1.3, 0.8, 0.85]))
    .setImportance(0.3, { role: "context" })
    .style(style);
  const b = scene
    .add(sphere([0.7, 0.1, 0.15], 0.9))
    .setImportance(0.3, { role: "context" })
    .style(style);
  scene.intersect(a, b, { emphasis: "bold" }).style({ wobble });
  return scene.render(cam).svg;
};
const shades: Shade[] = ["wire", "flat", "field"];

export default grid(
  { width: cam.viewport.width, height: cam.viewport.height },
  [0, 1].map((w) => shades.map((s) => build(w, s))),
  {
    rowLabels: ["wobble: off", "wobble: on"],
    colLabels: ["wireframe", "flat", "curved field"],
  },
);
