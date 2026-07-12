// ---------------------------------------------------------------------------
// 21. Capped solids in the wild — the Slack mark as eight rounded 3-D tiles laid
//     flat on a sheet of paper, 3/4 perspective. Its true geometry: four elongated
//     "bar" capsules pinwheeling around the central square, plus four rounded
//     "knob" caps. Each tile is a *plain* extrusion (`extrude`-style: flat lid, flat
//     floor, one wall per edge). With no colour to work with, the four brand hues
//     map to four hatch tones (aubergine darkest → yellow lightest).
//
//     This is the capped regime doing its job with no per-scene help: every tile is
//     smooth-walled with a flat lid meeting the wall at a 90° crease, so it renders
//     the hybrid — crease-aware corner normals shade the flat lids flat while the
//     rounded walls stay smooth; the drawn outline is the crease-aware silhouette
//     (a clean curve, no phantom drifting across the lid); and the hatch fills from
//     the exact face contour, so it clips to the real rounded edges. Drop any of
//     those pieces and the lids dome, the outlines double, and the hatch frays.
// ---------------------------------------------------------------------------
import type { Camera, Vec3 } from "../../src/math/types.js";
import type { MeshInput, Tri } from "../../src/mesh/halfedge.js";
import { Mesh } from "../../src/mesh/mesh-source.js";
import { Polygon } from "../../src/primitives/polygon.js";
import { Scene } from "../../src/scene/scene.js";
import { view } from "../../src/layout/index.js";

const R = 12.9; // Slack corner radius (capsule half-width), from the brand icon
const T = 9; //    tile thickness
const SEG = 24; //  arc points per semicircle

type P2 = [number, number];
const V3 = (x: number, y: number, z: number): Vec3 => [x, y, z];
const F = (a: number, b: number, c: number): Tri => [a, b, c];

// convex stadium / half-stadium footprint (CCW list of [x, y]); a knob has one
// rounded and one flat end, a bar has two rounded ends.
function outline(c0: P2, c1: P2, r: number, round0: boolean, round1: boolean, seg: number): P2[] {
  const dx = c1[0] - c0[0], dy = c1[1] - c0[1];
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len, nx = -uy, ny = ux;
  const ang = Math.atan2(uy, ux);
  const P: P2[] = [];
  const arc = (c: P2, a0: number, a1: number) => {
    for (let i = 1; i < seg; i++) { const a = a0 + (a1 - a0) * i / seg; P.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]); }
  };
  P.push([c0[0] - r * nx, c0[1] - r * ny]);
  P.push([c1[0] - r * nx, c1[1] - r * ny]);
  if (round1) arc(c1, ang - Math.PI / 2, ang + Math.PI / 2);
  P.push([c1[0] + r * nx, c1[1] + r * ny]);
  P.push([c0[0] + r * nx, c0[1] + r * ny]);
  if (round0) arc(c0, ang + Math.PI / 2, ang + 3 * Math.PI / 2);
  return P;
}

// extrude a convex footprint into a thin tile (flat lid + floor + walls)
function tile(out: P2[], t: number): MeshInput {
  const n = out.length;
  const pos: Vec3[] = [];
  for (const p of out) pos.push(V3(p[0], p[1], 0)); // 0..n-1  floor
  for (const p of out) pos.push(V3(p[0], p[1], t)); // n..2n-1 lid
  const tri: Tri[] = [];
  for (let i = 1; i < n - 1; i++) tri.push(F(n, n + i, n + i + 1)); // +Z lid fan
  for (let i = 1; i < n - 1; i++) tri.push(F(0, i + 1, i)); //         -Z floor fan
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    tri.push(F(i, j, n + j)); //  walls
    tri.push(F(i, n + j, n + i));
  }
  return { positions: pos, triangles: tri };
}

// four brand colours → four pencil hatch tones (aubergine darkest, yellow lightest)
const COL = {
  aub: { mode: "triple", angle: 20, spacingPx: 5 },
  blue: { mode: "cross", angle: 24, spacingPx: 7 },
  green: { mode: "single", angle: -22, spacingPx: 6 },
  yellow: { mode: "single", angle: 18, spacingPx: 9 },
} as const;

// the eight shapes in centred, y-up coords (r = 12.9): [colour, capCentre0, capCentre1, round0, round1]
const SHAPES: [keyof typeof COL, P2, P2, boolean, boolean][] = [
  ["aub", [-48.5, -16.2], [-35.6, -16.2], true, false], //   aubergine knob (points west)
  ["aub", [-16.2, -16.2], [-16.2, -48.5], true, true], //    aubergine bar  (vertical)
  ["blue", [-16.2, 48.5], [-16.2, 35.6], true, false], //    blue knob (points north)
  ["blue", [-48.5, 16.2], [-16.2, 16.2], true, true], //     blue bar  (horizontal)
  ["green", [48.5, 16.2], [35.6, 16.2], true, false], //     green knob (points east)
  ["green", [16.2, 48.5], [16.2, 16.2], true, true], //      green bar  (vertical)
  ["yellow", [16.2, -48.5], [16.2, -35.6], true, false], //  yellow knob (points south)
  ["yellow", [16.2, -16.2], [48.5, -16.2], true, true], //   yellow bar  (horizontal)
];

const scene = new Scene({
  svg: { background: "#f4f1ea" },
  light: { direction: [-0.35, 0.45, -0.82] },
});

// the flat surface (a sheet of paper): a quiet, un-hatched context plane
scene.add(new Polygon([V3(-108, -95, 0), V3(108, -95, 0), V3(108, 95, 0), V3(-108, 95, 0)]))
  .setImportance(0.25, { role: "context" })
  .style({ wobble: 0.5, weight: 1.0, hatch: null, hidden: "drop" });

for (const [c, a, b, r0, r1] of SHAPES) {
  scene.add(new Mesh(tile(outline(a, b, R, r0, r1, SEG), T)))
    .setImportance(0.9, { role: "subject" })
    .style({ wobble: 0.4, weight: 1.4, hidden: "drop", hatch: { ...COL[c], field: false }, hatchWeight: 0.8, hatchOpacity: 0.5 });
}

const cam: Camera = {
  eye: [5, -166, 116], target: [0, 6, 4], up: [0, 0, 1],
  projection: "perspective", scale: 0.525, viewport: { width: 900, height: 680 },
};

export default view(scene, cam);
