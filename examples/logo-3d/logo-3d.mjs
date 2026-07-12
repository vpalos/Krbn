// logo-3d — extrude the AhaBlitz logo into 3-D prisms and render them hatched
// with Krbn. Runs on plain Node against the prebuilt ./dist (no bun needed):
//
//   node examples/logo-3d/logo-3d.mjs        # writes logo-3d-front.svg + -tilt.svg
//
// Geometry (profiles.json, built by make_profiles.py from web/static/logo.svg):
//   * hole-free glyphs  -> krbn/shapes `extrude(ring, HEIGHT)`
//   * glyphs with counters (A? a, B) -> a hole-aware extrusion: earcut caps with
//     the counters left open (real tunnels) + one wall loop per ring. No keyhole
//     bridge, so no spurious crease cuts across the faces.
// Krbn then runs its hidden-line + silhouette + cross-hatch pass. The green word
// "Aha" + bolt + diamond and the dark word "Blitz" are the two brand tones.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Scene, Mesh } from "../../dist/index.js";
import { extrude } from "../../dist/shapes.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(readFileSync(join(HERE, "profiles.json"), "utf8"));

const HEIGHT = 3.6; // extrusion depth (world units)
const BG = "#faf9f5";

// A hole-aware prism: floor + lid share the same 2-D vertex table `verts`; the
// lid is the earcut cap (counters open), the floor its reverse, and every ring
// (outer CCW + holes CW) contributes a wall loop. Mirrors krbn/shapes `extrude`,
// generalised to holes.
function holedExtrude(verts, rings, captris, height) {
  const V = verts.length;
  const positions = [];
  for (const [x, y] of verts) positions.push([x, y, 0]);
  for (const [x, y] of verts) positions.push([x, y, height]);
  const triangles = [];
  for (const [a, b, c] of captris) triangles.push([V + a, V + b, V + c]); // lid +z
  for (const [a, b, c] of captris) triangles.push([a, c, b]);             // floor -z
  for (const [start, count] of rings) {
    for (let k = 0; k < count; k++) {
      const i = start + k;
      const j = start + ((k + 1) % count);
      triangles.push([i, j, V + j]);
      triangles.push([i, V + j, V + i]);
    }
  }
  return { positions, triangles };
}

const meshOf = (pr) =>
  pr.holed ? holedExtrude(pr.verts, pr.rings, pr.captris, HEIGHT) : extrude(pr.ring, HEIGHT);

const STYLE = {
  green: {
    color: "#0e9f6e",
    hatch: { mode: "single", angle: 24, spacingPx: 6, field: false },
    hatchOpacity: 0.55, weight: 1.3, wobble: 0.35, hidden: "drop",
  },
  dark: {
    color: "#26272b",
    hatch: { mode: "cross", angle: 18, spacingPx: 5.5, field: false },
    hatchOpacity: 0.6, weight: 1.4, wobble: 0.35, hidden: "drop",
  },
};

function build() {
  // grazing light: flat front faces read "dark" (low N·L) so the cross-hatch
  // second layer isn't tonally suppressed -> even hatching across both words.
  const scene = new Scene({ light: { direction: [-0.5, -0.35, -0.12] }, svg: { background: BG } });
  for (const pr of data.profiles) scene.add(new Mesh(meshOf(pr))).style(STYLE[pr.cls]);
  return scene;
}

const W = 1360, H = 470, SCALE = 0.034;
const ortho = (eye) => ({ eye, target: [0, 0, HEIGHT / 2], up: [0, 1, 0],
  projection: "orthographic", scale: SCALE, viewport: { width: W, height: H } });
// "front" is a whisper off dead-on (~5.5°): a perfectly head-on orthographic view
// puts every extrusion wall exactly edge-on — the degenerate case for silhouette
// detection — and would hide the extrusion entirely. This still reads as up-front.
const cams = {
  front: ortho([3.5, 4.5, 55]),   // ~5.5° — reads as straight-on
  tilt:  ortho([9, 6.5, 46]),     // hero 3/4, shows the extrusion depth
};

for (const [name, cam] of Object.entries(cams)) {
  const svg = build().render(cam).svg;
  writeFileSync(join(HERE, `logo-3d-${name}.svg`), svg);
  console.log(`wrote logo-3d-${name}.svg (${svg.length} bytes)`);
}
