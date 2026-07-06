// Temporal-coherence demo: an offline frame sequence rendered through a
// `FrameSession` (ai/DESIGN.md §3.3.7; ROADMAP Phase-2 item 6). A slow camera
// orbit of a mixed analytic + mesh scene with wobble, hatching, abstraction,
// and suggestive contours all on — every mechanism the coherence work
// stabilized. Regenerate with:
//
//     bun run examples/animation.ts
//
// Writes examples/animation/frame-###.svg plus flipbook.html (open it in a
// browser; scrub or play). Output is deterministic end to end: the same run
// always produces byte-identical frames.
//
// What to look for while it plays: silhouettes slide smoothly (persistent ids,
// canonical orientation), hatch lines pan *with* the surfaces (object-anchored
// phase, static streamline atlas, dyadic iso-ladders at complete levels), each
// line keeps its hand-drawn character (identity-keyed wobble seeds), and
// feature detail thins by fading, never popping (threshold fades). The
// per-frame coherence report is printed so churn (born/died/reversed) is
// visible at a glance.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Camera } from "../src/math/types.js";
import { Scene } from "../src/scene/scene.js";
import { FrameSession } from "../src/scene/session.js";
import { sphere } from "../src/primitives/quadric.js";
import { Cylinder } from "../src/primitives/cylinder.js";
import { Mesh } from "../src/mesh/mesh-source.js";
import { torusMesh } from "../src/mesh/shapes.js";

const OUT =
  process.env.KRBN_ANIMATION_OUT ??
  join(dirname(fileURLToPath(import.meta.url)), "animation");
mkdirSync(OUT, { recursive: true });

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
  new Mesh(
    torusMesh(1.1, 0.45, 40, 20),
    { suggestive: { threshold: 0.02, fade: 0.05 } },
    "torus",
  ),
  {
    style: { hatch: { mode: "cross", angle: 0 } },
  },
);
scene.add(sphere([2.2, 1.2, 0.4], 0.8, "ball"), {
  style: { hatch: { mode: "cross", angle: 20 } },
});
scene.add(new Cylinder([-2.4, -0.6, -1.1], [0, 0, 2.2], 0.7, "cyl"), {
  style: { hatch: { mode: "cross", angle: 0 } },
});

const session = new FrameSession(scene);
const svgs: string[] = [];
const t0 = performance.now();
for (let k = 0; k < FRAMES; k++) {
  const r = session.render(cam((ORBIT * k) / (FRAMES - 1)));
  svgs.push(r.svg);
  writeFileSync(join(OUT, `frame-${String(k).padStart(3, "0")}.svg`), r.svg);
  const c = r.coherence;
  const churn = c.born.length + c.died.length + c.reversed.length;
  console.log(
    `frame ${String(k).padStart(3, "0")}  strokes ${r.strokes.length}  runs ${r.renderStrokes.length}` +
      (k > 0
        ? `  born ${c.born.length} died ${c.died.length} reversed ${c.reversed.length}${churn ? "  ⚠" : ""}`
        : ""),
  );
}
console.log(
  `${FRAMES} frames in ${((performance.now() - t0) / 1000).toFixed(1)}s`,
);

// --- one-file flipbook -------------------------------------------------------
const flipbook = `<!doctype html>
<meta charset="utf-8">
<title>Krbn — temporal-coherence flipbook</title>
<style>
  body { margin: 0; background: #faf9f5; font: 13px system-ui, sans-serif; color: #444;
         display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 16px; }
  #stage { width: ${W}px; height: ${H}px; border: 1px solid #ddd; }
  #stage svg { display: block; }
  #bar { display: flex; gap: 10px; align-items: center; }
  input[type=range] { width: ${W - 160}px; }
  button { font: inherit; padding: 2px 12px; }
</style>
<div id="stage"></div>
<div id="bar">
  <button id="play">play</button>
  <input id="scrub" type="range" min="0" max="${FRAMES - 1}" value="0" step="1">
  <span id="label">0 / ${FRAMES - 1}</span>
</div>
<script>
  const frames = ${JSON.stringify(svgs)};
  const stage = document.getElementById("stage");
  const scrub = document.getElementById("scrub");
  const label = document.getElementById("label");
  const play = document.getElementById("play");
  let timer = null;
  const show = (k) => { stage.innerHTML = frames[k]; scrub.value = k; label.textContent = k + " / " + (frames.length - 1); };
  scrub.addEventListener("input", () => { stop(); show(+scrub.value); });
  const stop = () => { if (timer) { clearInterval(timer); timer = null; play.textContent = "play"; } };
  play.addEventListener("click", () => {
    if (timer) return stop();
    play.textContent = "stop";
    timer = setInterval(() => show((+scrub.value + 1) % frames.length), 83);
  });
  show(0);
</script>`;
writeFileSync(join(OUT, "flipbook.html"), flipbook);
console.log("wrote animation/flipbook.html");
