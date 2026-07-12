// ---------------------------------------------------------------------------
// 20. Extruded hard solids — a 2-D profile pushed to a height by `extrude`
//     (krbn/shapes). Both panels are prisms: a flat lid, a flat floor, and one
//     wall per profile edge, ear-clipped so non-convex outlines work. What differs
//     is the profile. Left: a ROUNDED rectangle — the corners are sampled finely,
//     so the wall reads as one smooth curved band while the lid stays flat. That
//     mix is the whole point: crease-aware corner normals shade the flat lid flat
//     while the rounded wall shades light→dark, instead of averaging the lid into a
//     dome. Right: a SHARP five-point star — every corner is a real crease, so the
//     solid is faceted and each flat wall takes a single tone by its angle to the
//     light. One generator, two regimes, chosen entirely by the profile.
// ---------------------------------------------------------------------------
import type { Camera, Vec2 } from "../../src/math/types.js";
import { Mesh } from "../../src/mesh/mesh-source.js";
import { extrude } from "../../src/mesh/shapes.js";
import { Scene } from "../../src/scene/scene.js";
import { grid } from "../../src/layout/index.js";

const BG = "#faf9f5";

const cam: Camera = {
  eye: [3.4, 3.0, 2.6],
  target: [0, 0, 0.15],
  up: [0, 0, 1],
  projection: "perspective",
  scale: Math.PI / 5.2,
  viewport: { width: 430, height: 380 },
};

// a rounded rectangle: four quarter-arcs sampled `seg` ways, joined by straight
// edges — a smooth-walled footprint
function roundedRect(w: number, h: number, r: number, seg: number): Vec2[] {
  const cx = w / 2 - r, cy = h / 2 - r;
  const corners: [number, number, number][] = [
    [cx, -cy, -Math.PI / 2], // bottom-right
    [cx, cy, 0], //            top-right
    [-cx, cy, Math.PI / 2], // top-left
    [-cx, -cy, Math.PI], //    bottom-left
  ];
  const pts: Vec2[] = [];
  for (const [ccx, ccy, a0] of corners) {
    for (let k = 0; k <= seg; k++) {
      const a = a0 + (Math.PI / 2) * (k / seg);
      pts.push([ccx + r * Math.cos(a), ccy + r * Math.sin(a)]);
    }
  }
  return pts;
}

// an m-point star: alternating outer/inner radii — a non-convex, sharp footprint
function star(m: number, rOut: number, rIn: number): Vec2[] {
  const pts: Vec2[] = [];
  for (let i = 0; i < 2 * m; i++) {
    const a = Math.PI / 2 + (Math.PI * i) / m;
    const r = i % 2 === 0 ? rOut : rIn;
    pts.push([r * Math.cos(a), r * Math.sin(a)]);
  }
  return pts;
}

const panel = (profile: Vec2[], height: number): string => {
  const scene = new Scene({ light: { direction: [-0.5, -0.4, -0.62] }, svg: { background: BG } });
  scene
    .add(new Mesh(extrude(profile, height)))
    .style({ wobble: 0.35, weight: 1.4, hidden: "drop", hatch: { mode: "cross", angle: 20, spacingPx: 8, field: false }, hatchOpacity: 0.5 });
  return scene.render(cam).svg;
};

export default grid(
  cam.viewport,
  [[panel(roundedRect(2.7, 1.7, 0.6, 8), 0.7), panel(star(5, 1.35, 0.58), 0.7)]],
  { rowLabels: [""], colLabels: ["rounded profile — smooth walls, flat lid", "sharp profile — faceted"] },
);
