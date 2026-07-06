// ---------------------------------------------------------------------------
// 16. Gravity well. A heavy sphere resting in a "rubber-sheet" plane, dipped into
//     a funnel — the usual way spacetime curvature is drawn. The sheet is a warped
//     mesh; its **curvature-driven hatch** fans out as radial + concentric lines
//     (the funnel's principal directions), concentrated where the mass warps it
//     and fading on the flat outskirts. The sphere *rests on* the sheet — the well
//     is tuned so the funnel cradles the ball just below its equator instead of the
//     ball poking through the (steeper) funnel wall — mixing an analytic primitive
//     with a mesh in one scene. The sheet uses `hidden: "drop"` so it doesn't ghost
//     the far wall of its own throat back through itself (an opaque surface, not a
//     wire construction), which would otherwise read as a phantom bulge under the ball.
// ---------------------------------------------------------------------------
import type { Camera } from "../../src/math/types.js";
import { sphere } from "../../src/primitives/quadric.js";
import { Mesh } from "../../src/mesh/mesh-source.js";
import { gravitySheet } from "../../src/mesh/shapes.js";
import { Scene } from "../../src/scene/scene.js";
import { view } from "../../src/layout/index.js";

const BG = "#faf9f5";

const cam: Camera = {
  eye: [4.2, 4.6, 2.7],
  target: [0, 0, -0.85],
  up: [0, 0, 1],
  projection: "perspective",
  scale: Math.PI / 4.5,
  viewport: { width: 700, height: 520 },
};
const scene = new Scene({ light: { direction: [-0.4, -0.5, -0.7] }, svg: { background: BG } });
// widened, shallower funnel (a = 0.95) so it cradles the ball rather than being
// pointier than it; the ball (r 0.8 at z −0.66) then rests tangent, no poke-through
scene.add(new Mesh(gravitySheet(3, 72, 1.7, 0.95))).style({ wobble: 0.13, hidden: "drop", hatch: { mode: "cross", angle: 0, spacingPx: 8 } });
// both are opaque solids, so drop hidden lines rather than ghost them: the only
// hidden sliver is the ball's base behind the sheet's near lip, which shouldn't
// ghost through the opaque sheet
scene.add(sphere([0, 0, -0.66], 0.8)).style({ wobble: 0.13, hidden: "drop", hatch: { mode: "cross", angle: 20 } });

export default view(scene, cam);
