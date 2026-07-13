// ---------------------------------------------------------------------------
// 22. Per-object output masking — one scene, split into layers. Both panels are
//     the SAME gravity-well scene (demo 16: a heavy sphere resting in a dipped
//     sheet) from the SAME camera. The only thing that changes between them is
//     `output`: the LEFT panel mutes the sphere (`output: false`) so only the well
//     is drawn; the RIGHT panel mutes the well so only the sphere is drawn.
//
//     The point is what a muted element still does: it OCCLUDES. On the left the
//     invisible ball still carves its shadow out of the sheet's hatch — the well is
//     drawn exactly as it is hidden *behind* the ball — and on the right the
//     invisible sheet still hides the ball's base behind its near lip. So the two
//     layers are a faithful decomposition of the single combined render, each safe
//     to send to a different pen for multi-colour plotting: neither layer draws
//     what the other is in front of. `output` gates only the final emit; the whole
//     visibility/occlusion pipeline upstream runs over every element regardless.
//
//     The `output` flag was requested by Reddit user u/ShelfordPrefect
//     (https://www.reddit.com/user/ShelfordPrefect/).
// ---------------------------------------------------------------------------
import type { Camera } from "../../src/math/types.js";
import { sphere } from "../../src/primitives/quadric.js";
import { Mesh } from "../../src/mesh/mesh-source.js";
import { gravitySheet } from "../../src/mesh/shapes.js";
import { Scene } from "../../src/scene/scene.js";
import { grid } from "../../src/layout/index.js";

const BG = "#faf9f5";

const cam: Camera = {
  eye: [4.2, 4.6, 2.7],
  target: [0, 0, -0.85],
  up: [0, 0, 1],
  projection: "perspective",
  scale: Math.PI / 4.5,
  viewport: { width: 620, height: 500 },
};

const scene = new Scene({ light: { direction: [-0.4, -0.5, -0.7] }, svg: { background: BG } });
const well = scene
  .add(new Mesh(gravitySheet(3, 72, 1.7, 0.95)))
  .style({ wobble: 0.13, hidden: "drop", hatch: { mode: "cross", angle: 0, spacingPx: 8 } });
const ball = scene
  .add(sphere([0, 0, -0.66], 0.8))
  .style({ wobble: 0.13, hidden: "drop", hatch: { mode: "cross", angle: 20 } });

// Same scene, rendered twice — only the `output` mask changes between passes.
ball.setOutput(false); //                       left: only the well (ball still occludes)
const left = scene.render(cam).svg;
ball.setOutput(true);
well.setOutput(false); //                        right: only the ball (well still occludes)
const right = scene.render(cam).svg;
well.setOutput(true);

export default grid(cam.viewport, [[left, right]], {
  rowLabels: [""],
  colLabels: ["output: well only — ball muted, still occludes", "output: ball only — well muted, still occludes"],
});
