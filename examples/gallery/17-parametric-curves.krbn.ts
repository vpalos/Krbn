// ---------------------------------------------------------------------------
// 17. Parametric curves — the free-form primitive that has no closed-form feature
//     carrier, so it is the one place per-frame screen-adaptive sampling is
//     legitimate (§2.3). A 1-D curve does not occlude, but it *is* occludable.
//     Left: a helix wound just outside a cylinder — the back of every turn is
//     dashed where the cylinder hides it, so the coil reads in depth. Middle: a
//     cubic Bézier carried *exactly* as its control points (the faint dashed
//     control polygon + dots) and sampled only at emit. Right: a function plot
//     y = g(x), a damped sine over an axis cross. Wobble makes each hand-drawn.
// ---------------------------------------------------------------------------
import type { Camera } from "../../src/math/types.js";
import { Cylinder } from "../../src/primitives/cylinder.js";
import { Line } from "../../src/primitives/line.js";
import { Point } from "../../src/primitives/point.js";
import { BezierCurve, functionPlot, helix } from "../../src/primitives/parametric.js";
import { Scene } from "../../src/scene/scene.js";
import { grid } from "../../src/layout/index.js";

const BG = "#faf9f5";

const W = 380;
const H = 360;

// A — helix wrapping a cylinder (hidden-line on a parametric curve)
const helixPanel = (): string => {
  const cam: Camera = {
    eye: [4.2, 3.0, 2.2],
    target: [0, 0, 0],
    up: [0, 0, 1],
    projection: "perspective",
    scale: Math.PI / 4.4,
    viewport: { width: W, height: H },
  };
  const scene = new Scene({ svg: { background: BG } });
  scene
    .add(new Cylinder([0, 0, -1.5], [0, 0, 3], 0.8))
    .setImportance(0.3, { role: "context" })
    .style({ wobble: 0.2 });
  // radius just outside the cylinder so the coil sits on the surface; 5 turns
  // rising the full height ⇒ pitch = 3 / 5
  scene
    .add(helix([0, 0, -1.5], 0.82, 3 / 5, 5))
    .setImportance(1, { role: "subject" })
    .style({ wobble: 0.3, weight: 1.4 });
  return scene.render(cam).svg;
};

// B — exact cubic Bézier + its control polygon, viewed face-on
const bezierPanel = (): string => {
  const cam: Camera = {
    eye: [0, 0, 10],
    target: [0, 0, 0],
    up: [0, 1, 0],
    projection: "orthographic",
    scale: 0.02,
    viewport: { width: W, height: H },
  };
  const scene = new Scene({ svg: { background: BG } });
  // crossed handles ⇒ a pronounced S the straight control polygon can't fake
  const ctrl: [number, number, number][] = [
    [-2.4, -1.7, 0],
    [2.6, -1.5, 0],
    [-2.6, 1.5, 0],
    [2.4, 1.7, 0],
  ];
  // faint control polygon (thin segments) + control-point dots
  for (let i = 0; i + 1 < ctrl.length; i++) {
    scene
      .add(new Line(ctrl[i]!, ctrl[i + 1]!))
      .setImportance(0.2, { role: "context" })
      .style({ wobble: 0, weight: 0.5 });
  }
  for (const c of ctrl) scene.add(new Point(c, { mark: "dot", sizePx: 7 }));
  scene
    .add(new BezierCurve(ctrl))
    .setImportance(1, { role: "subject" })
    .style({ wobble: 0.3, weight: 1.4 });
  return scene.render(cam).svg;
};

// C — function plot y = g(x) with an axis cross
const plotPanel = (): string => {
  const cam: Camera = {
    eye: [0, 0, 10],
    target: [0, 0, 0],
    up: [0, 1, 0],
    projection: "orthographic",
    scale: 0.02,
    viewport: { width: W, height: H },
  };
  const scene = new Scene({ svg: { background: BG } });
  scene.add(new Line([-3.4, 0, 0], [3.4, 0, 0])).setImportance(0.2, { role: "context" }).style({ wobble: 0, weight: 0.5 });
  scene.add(new Line([0, -2.2, 0], [0, 2.2, 0])).setImportance(0.2, { role: "context" }).style({ wobble: 0, weight: 0.5 });
  const g = (x: number) => 1.9 * Math.exp(-0.16 * x * x) * Math.sin(3.0 * x);
  scene
    .add(functionPlot(g, -3.3, 3.3))
    .setImportance(1, { role: "subject" })
    .style({ wobble: 0.3, weight: 1.4 });
  return scene.render(cam).svg;
};

export default grid(
  { width: W, height: H },
  [[helixPanel(), bezierPanel(), plotPanel()]],
  { rowLabels: [""], colLabels: ["helix (hidden-line)", "Bézier (exact carrier)", "function plot"] },
);
