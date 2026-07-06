// ---------------------------------------------------------------------------
// 18. Mesh creases — sharp dihedral edges. Where two facets meet above the crease
//     angle the edge is a permanent, view-independent feature (unlike the moving
//     silhouette). A faceted cube + tetrahedron: every box/tet edge is a 90°/70°
//     ridge, so the whole wireframe is creases. Left: creases + silhouette with
//     hidden-line — the near edges solid, the three edges hiding behind each solid
//     dashed. Right: the same solids flat-shaded — each facet hatches to a uniform
//     tone by its own orientation to the light, reading as faceted planes.
// ---------------------------------------------------------------------------
import type { Camera } from "../../src/math/types.js";
import type { MeshInput } from "../../src/mesh/halfedge.js";
import { Mesh } from "../../src/mesh/mesh-source.js";
import { cube, rotate, tetrahedron, translate } from "../../src/mesh/shapes.js";
import { Scene } from "../../src/scene/scene.js";
import { grid } from "../../src/layout/index.js";

const BG = "#faf9f5";

const cam: Camera = {
  eye: [3.8, 3.0, 2.5],
  target: [0.2, 0, 0.1],
  up: [0, 0, 1],
  projection: "perspective",
  scale: Math.PI / 5.0,
  viewport: { width: 430, height: 380 },
};
const scaled = (mi: MeshInput, s: number): MeshInput => ({
  positions: mi.positions.map((p) => [p[0] * s, p[1] * s, p[2] * s] as [number, number, number]),
  triangles: mi.triangles,
});
// a box (all 90° creases) and a tetrahedron (all ~70.5° creases), tilted off
// axis so the 3/4 view shows three faces of each and the hidden back edges
const boxMesh = () => translate(rotate(scaled(cube(), 0.7), [0, 0, 1], 0.5), [-1.05, -0.15, 0.2]);
const tetMesh = () => translate(rotate(scaled(tetrahedron(), 0.72), [0, 0, 1], -0.3), [1.4, 0.3, 0.4]);
const build = (shade: boolean): string => {
  const scene = new Scene({ light: { direction: [-0.5, -0.45, -0.55] }, svg: { background: BG } });
  // flat per-face shading: with the faceted mesh returning face normals, the
  // tonal layers of a cross-hatch land a uniform number of layers on each face,
  // so each facet reads as one flat tone set by its angle to the light
  const style = shade ? { wobble: 0.25, hatch: { mode: "cross" as const, angle: 18, spacingPx: 9, field: false } } : { wobble: 0.25 };
  scene.add(new Mesh(boxMesh())).style(style);
  scene.add(new Mesh(tetMesh())).style(style);
  return scene.render(cam).svg;
};

export default grid(
  cam.viewport,
  [[build(false), build(true)]],
  { rowLabels: [""], colLabels: ["creases (hidden-line)", "faceted shading"] },
);
