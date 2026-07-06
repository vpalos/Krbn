// ---------------------------------------------------------------------------
// 19. Hidden lines: ghost vs drop. The same scene — a cube with a sphere behind
//     it — under the two ways of treating an occluded contour. **Ghost** (the
//     engine default) keeps hidden runs as faint dashes: an *x-ray* reading where
//     the cube's three back edges and the whole of the sphere show through, which
//     is what a technical/wireframe drawing wants. **Drop** omits hidden runs
//     entirely: *opaque* solids, where the cube hides its own back edges and cuts
//     the sphere's outline cleanly — the right choice for the gravity well (demo
//     16), where ghosting an opaque surface's own far side reads as a phantom. Same
//     exact visibility classification underneath; only the styling of the hidden
//     intervals differs (`hidden: "ghost" | "drop"`).
// ---------------------------------------------------------------------------
import type { Camera } from "../../src/math/types.js";
import type { MeshInput } from "../../src/mesh/halfedge.js";
import { sphere } from "../../src/primitives/quadric.js";
import { Mesh } from "../../src/mesh/mesh-source.js";
import { cube, rotate, translate } from "../../src/mesh/shapes.js";
import { Scene } from "../../src/scene/scene.js";
import { grid } from "../../src/layout/index.js";

const BG = "#faf9f5";

const cam: Camera = {
  eye: [3.8, 3.0, 2.6],
  target: [-0.35, -0.3, 0],
  up: [0, 0, 1],
  projection: "perspective",
  scale: Math.PI / 5.0,
  viewport: { width: 440, height: 390 },
};
const scaled = (mi: MeshInput, s: number): MeshInput => ({
  positions: mi.positions.map((p) => [p[0] * s, p[1] * s, p[2] * s] as [number, number, number]),
  triangles: mi.triangles,
});
const boxMesh = () => translate(rotate(scaled(cube(), 0.62), [0, 0, 1], 0.4), [0.15, 0.1, 0]);
const build = (hidden: "ghost" | "drop", shade: boolean): string => {
  const scene = new Scene({ light: { direction: [-0.5, -0.45, -0.55] }, svg: { background: BG } });
  // sphere behind the cube (self-hidden back edges + one object occluding another)
  const sph = shade ? { wobble: 0.2, hidden, hatch: { mode: "cross" as const, angle: 20 } } : { wobble: 0.2, hidden };
  const box = shade ? { wobble: 0.2, hidden, hatch: { mode: "cross" as const, angle: 18, spacingPx: 9, field: false } } : { wobble: 0.2, hidden };
  scene.add(sphere([-1.25, -0.95, 0.1], 0.85)).style(sph);
  scene.add(new Mesh(boxMesh())).style(box);
  return scene.render(cam).svg;
};

export default grid(
  cam.viewport,
  [
    [build("ghost", false), build("drop", false)],
    [build("ghost", true), build("drop", true)],
  ],
  { rowLabels: ["wireframe", "cross-hatch"], colLabels: ["ghost (x-ray)", "drop (opaque)"] },
);
