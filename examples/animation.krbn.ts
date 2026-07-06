// animation.krbn.ts — the temporal-coherence demo as a shippable Film.
//
// A slow camera orbit of a mixed analytic + mesh scene (wobble, hatching,
// abstraction, suggestive contours all on) driven through a `FrameSession`
// (ai/DESIGN.md §3.3.7; ROADMAP Phase-2 item 6). Render it with:
//
//     bun run render examples/animation.krbn.ts
//
// → examples/animation/frame-###.svg + flipbook.html (open it; scrub or play).
// Deterministic end to end: the same run produces byte-identical frames.
//
// The only thing "animation" adds over a still is the `film(...)` driver: each
// frame is an ordinary `Drawing` (here `raw(session.render(cam).svg)`), so the
// same view/grid/stack/shapes machinery composes a frame exactly as it does a
// static figure. What to watch: silhouettes slide (persistent ids, canonical
// orientation), hatch pans *with* the surfaces (object-anchored phase, static
// atlas, dyadic ladders), each line keeps its hand-drawn character (identity-keyed
// wobble seeds), detail thins by fading not popping (threshold fades).
import type { Camera } from "../src/math/types.js";
import { Scene } from "../src/scene/scene.js";
import { FrameSession } from "../src/scene/session.js";
import { sphere } from "../src/primitives/quadric.js";
import { Cylinder } from "../src/primitives/cylinder.js";
import { Mesh } from "../src/mesh/mesh-source.js";
import { torusMesh } from "../src/mesh/shapes.js";
import { film, raw } from "../src/layout/index.js";

const FRAMES = 60;
const ORBIT = Math.PI / 1.5; // a 120° sweep over the sequence
const W = 640;
const H = 480;

const cam = (a: number): Camera => ({
  eye: [9 * Math.sin(a), -9 * Math.cos(a), 3.5],
  target: [0, 0, 0],
  up: [0, 0, 1],
  projection: "orthographic",
  scale: 0.02,
  viewport: { width: W, height: H },
});

const scene = new Scene({
  style: { wobble: 0.7 },
  abstraction: { minFeaturePx: 6 },
  svg: { background: "#faf9f5" },
});
scene.add(
  new Mesh(torusMesh(1.1, 0.45, 40, 20), { suggestive: { threshold: 0.02, fade: 0.05 } }, "torus"),
  { style: { hatch: { mode: "cross", angle: 0 } } },
);
scene.add(sphere([2.2, 1.2, 0.4], 0.8, "ball"), {
  style: { hatch: { mode: "cross", angle: 20 } },
});
scene.add(new Cylinder([-2.4, -0.6, -1.1], [0, 0, 2.2], 0.7, "cyl"), {
  style: { hatch: { mode: "cross", angle: 0 } },
});

// The session carries stroke identity across frames; each frame is a Drawing.
// `last` holds the most recent session result so the onFrame hook can print the
// coherence report (born/died/reversed) without cluttering the frame composition.
const session = new FrameSession(scene);
let last: ReturnType<typeof session.render>;

export default film(
  FRAMES,
  (k) => {
    last = session.render(cam((ORBIT * k) / (FRAMES - 1)));
    return raw(last.svg);
  },
  {
    viewport: { width: W, height: H },
    fps: 12,
    onFrame: (k) => {
      const c = last.coherence;
      const churn = c.born.length + c.died.length + c.reversed.length;
      console.log(
        `frame ${String(k).padStart(3, "0")}  strokes ${last.strokes.length}  runs ${last.renderStrokes.length}` +
          (k > 0
            ? `  born ${c.born.length} died ${c.died.length} reversed ${c.reversed.length}${churn ? "  ⚠" : ""}`
            : ""),
      );
    },
  },
);
