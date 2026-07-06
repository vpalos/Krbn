// ---------------------------------------------------------------------------
// 12. Curved hatch direction fields — the hatch lines are the surface's *exact*
//     iso-parameter curves, not straight parallels. Columns add families: one
//     (cylinder/cone rings, torus poloidal loops, sphere parallels), cross-hatch
//     (axial rulings / apex generators / toroidal loops / meridians), triple —
//     the diagonal third family (45° helices / spiral generators / (1,1) loops /
//     tilted-axis circles) as the darkest tonal band. Each curve's hidden half is
//     dropped by the same front-face + occlusion test.
// ---------------------------------------------------------------------------
import type { Camera } from "../../src/math/types.js";
import { sphere } from "../../src/primitives/quadric.js";
import { Cylinder } from "../../src/primitives/cylinder.js";
import { Cone } from "../../src/primitives/cone.js";
import { Torus } from "../../src/primitives/torus.js";
import { Scene } from "../../src/scene/scene.js";
import { grid } from "../../src/layout/index.js";

const BG = "#faf9f5";

const cam: Camera = {
  eye: [3.6, 2.7, 2.2],
  target: [0, 0, 0],
  up: [0, 0, 1],
  projection: "perspective",
  scale: Math.PI / 4.4,
  viewport: { width: 360, height: 320 },
};
const light = { direction: [-0.4, -0.45, -0.55] as [number, number, number] };
type Mode = "single" | "cross" | "triple";
type Add = (s: Scene, mode: Mode) => void;
const panel = (add: Add, mode: Mode): string => {
  const scene = new Scene({ light, svg: { background: BG } });
  add(scene, mode);
  return scene.render(cam).svg;
};
const style = (mode: Mode) => ({
  wobble: 0.35,
  hatch: { mode, angle: 0, spacingPx: 10 },
});
const cyl: Add = (s, mode) =>
  void s.add(new Cylinder([0, 0, -1], [0, 0, 2], 0.9)).style(style(mode));
const con: Add = (s, mode) =>
  void s.add(new Cone([0, 0, 1.1], [0, 0, -2.2], 0.95)).style(style(mode));
const tor: Add = (s, mode) =>
  void s.add(new Torus([0, 0, 0], [0, 0, 1], 1.2, 0.42)).style(style(mode));
const sph: Add = (s, mode) =>
  void s.add(sphere([0, 0, 0], 1.25)).style(style(mode));
const rows = [cyl, con, tor, sph];
const modes: Mode[] = ["single", "cross", "triple"];
export default grid(
  cam.viewport,
  rows.map((add) => modes.map((mode) => panel(add, mode))),
  {
    rowLabels: ["cylinder", "cone", "torus", "sphere"],
    colLabels: ["one family", "cross-hatch", "triple"],
  },
);
