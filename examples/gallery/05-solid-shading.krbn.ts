import type { Camera } from "../../src/math/types.js";
import { Scene } from "../../src/scene/scene.js";
import { sphere } from "../../src/primitives/quadric.js";
import { Cylinder } from "../../src/primitives/cylinder.js";
import { Cone } from "../../src/primitives/cone.js";
import { raw, textAt, withLabels } from "../../src/layout/index.js";

const BG = "#faf9f5";

// ---------------------------------------------------------------------------
// 5. Solid shading — a 3×3 grid: rows are single / cross / triple hatch (1 / 2 /
//    3 tonal layers), columns are cone / cylinder / sphere. Each is surface-
//    hatched and shaded light→dark, so the effect of adding layers is obvious.
// ---------------------------------------------------------------------------
const cam: Camera = {
  eye: [1.4, -11, 2.2],
  target: [0, 0, 0],
  up: [0, 0, 1],
  projection: "orthographic",
  scale: 0.012,
  viewport: { width: 820, height: 760 },
};
// front-light from the upper-right (like 02) so the camera-facing surfaces get
// a strong light→dark gradient; the camera looks roughly along +y here.
const scene = new Scene({
  light: { direction: [-0.55, 0.6, -0.5] },
  svg: { background: BG },
});
const modes = ["single", "cross", "triple"] as const;
const makers = [
  (x: number, z: number) => new Cone([x, 0, z - 0.75], [0, 0, 1.5], 0.65),
  (x: number, z: number) => new Cylinder([x, 0, z - 0.75], [0, 0, 1.5], 0.65),
  (x: number, z: number) => sphere([x, 0, z], 0.7),
];
const rowZ = [2.3, 0, -2.3];
const rowLabel = ["1 layer", "2 layers", "3 layers"];
modes.forEach((mode, r) => {
  const z = rowZ[r]!;
  makers.forEach((make, c) => {
    const x = -2.9 + c * 2.9;
    // straight parallel hatch (field: false) — the flat-shading baseline;
    // the curved direction field gets its own showcase in demo 12
    scene
      .add(make(x, z))
      .style({ wobble: 0.18, hatch: { mode, angle: 15, field: false } });
  });
});

export default raw(
  withLabels(
    scene.render(cam).svg,
    rowZ.map((z, r) => textAt(cam, [-4.35, 0, z], rowLabel[r]!, "start")),
  ),
);
