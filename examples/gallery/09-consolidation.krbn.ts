// 9. Consolidation — off vs on. Three collinear, overlapping rods drawn by
//    different elements. With wobble on, each gets its own seeded offset, so
//    *without* consolidation they diverge into several weaving lines; *with* it
//    they merge into one clean line (re-classified for exact visibility).
import type { Camera } from "../../src/math/types.js";
import { Line } from "../../src/primitives/line.js";
import { Scene } from "../../src/scene/scene.js";
import { raw, stripSvg } from "../../src/layout/index.js";

const BG = "#faf9f5";

const cam: Camera = {
  eye: [0, 0, 10],
  target: [0, 0, 0],
  up: [0, 1, 0],
  projection: "orthographic",
  scale: 0.011,
  viewport: { width: 460, height: 220 },
};
const build = (consolidate: boolean): string => {
  const scene = new Scene({
    svg: { background: BG },
    abstraction: { consolidate },
  });
  // three rods along the same 3-D line; strong wobble so different seeds diverge
  scene
    .add(new Line([-2.1, 0, 0], [2.1, 0, 0]))
    .style({ wobble: 1.5, weight: 1.8 });
  scene
    .add(new Line([-2.1, 0, 0], [2.1, 0, 0]))
    .style({ wobble: 1.5, weight: 1.8 });
  scene
    .add(new Line([-1.1, 0, 0], [1.4, 0, 0]))
    .style({ wobble: 1.5, weight: 1.8 });
  return scene.render(cam).svg;
};
const W = cam.viewport.width;
const H = cam.viewport.height;
const gap = 24;
const svg = [
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${2 * W + gap} ${H}" width="${2 * W + gap}" height="${H}">`,
  stripSvg(build(false)),
  `<g transform="translate(${W + gap},0)">${stripSvg(build(true))}</g>`,
  `<line x1="${W + gap / 2}" y1="8" x2="${W + gap / 2}" y2="${H - 8}" stroke="#ddd" stroke-width="1" />`,
  `<text x="14" y="26" font-family="sans-serif" font-size="14" fill="#888">consolidate: off</text>`,
  `<text x="${W + gap + 14}" y="26" font-family="sans-serif" font-size="14" fill="#888">consolidate: on</text>`,
  `</svg>`,
].join("\n");

export default raw(svg);
