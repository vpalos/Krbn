// Shared framing for the STL/OBJ import demos (imported by `stl.krbn.ts` and
// `obj.krbn.ts`). Not a `*.krbn.ts` itself — it exports helpers, not a
// deliverable, so the render CLI never picks it up as a scene.
//
// A `Model` is a file + a parser + one or more panels; this normalizes the mesh to
// a common size/orientation (any STL/OBJ, whatever its authored units or centre),
// renders each panel to an SVG, and stitches them into one labelled `Drawing`. A
// one-panel model is a single still; a two-panel model is a side-by-side grid —
// each panel varying one knob (flat vs curvature hatch, or two decimation levels).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Camera, Light, Vec3 } from "../../src/math/types.js";
import type { MeshInput } from "../../src/mesh/halfedge.js";
import type { StyleOverride } from "../../src/pipeline/style.js";
import { Mesh } from "../../src/mesh/mesh-source.js";
import { Scene } from "../../src/scene/scene.js";
import {
  figures,
  grid,
  label,
  raw,
  withLabels,
  type Drawing,
  type Figures,
} from "../../src/layout/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const BG = "#faf9f5";
/** normalize every model to this bounding-box diagonal, so one camera frames any file. */
export const SIZE = 3;

/** One decimation level: `weldEps` as a fraction of the model's size (tiny ≈ full
 *  detail; larger decimates), plus a short label for its panel. */
export interface Level {
  detail: number;
  tag: string;
  /** override the model's `flatHatch` for this panel — lets a two-panel grid
   *  compare flat vs curvature hatch on the same geometry, not just decimation. */
  flat?: boolean;
}

export interface Model {
  /** file in this folder. */
  file: string;
  /** output basename → `<name>.svg`. */
  name: string;
  /** the format decoder — `parseSTL` or `parseOBJ` (both take the raw bytes). */
  parse: (bytes: Uint8Array) => MeshInput;
  /** one level → a single still; two → a coarse-vs-fine decimation grid. */
  levels: Level[];
  /** surface hatch (tonal shading), or contours-only when omitted. */
  hatch?: "single" | "cross" | "triple";
  /** force straight parallel hatch instead of the surface's curved direction
   *  field (curvature streamlines). Only matters when `hatch` is set. */
  flatHatch?: boolean;
  /** how occluded lines are drawn: "ghost" (faint x-ray dashes, the default) or
   *  "drop" (omitted, so the surface reads as opaque). */
  hidden?: "ghost" | "drop";
  /** dihedral above which an edge is a crease (radians); default keeps the engine
   *  default. Past π suppresses creases entirely (smooth organic scans). */
  creaseAngle?: number;
  /** model axis to point up (default +z); rotated onto the camera's up. */
  up?: Vec3;
  /** rotation about the vertical axis, in degrees, applied after `up` — spins the
   *  model to face the camera however you like (e.g. 180 to see its front). */
  spin?: number;
  /** camera half-FOV — smaller zooms in. */
  fov: number;
  /** per-panel size. */
  viewport: { width: number; height: number };
  light: Vec3;
}

/** Center a model at the origin, scale it to `SIZE`, rotate `up` onto +z, then
 *  spin `spinDeg` about the vertical axis. */
export function normalize(
  mi: MeshInput,
  up: Vec3 = [0, 0, 1],
  spinDeg = 0,
): MeshInput {
  let pts = mi.positions;
  // Rotate `up` onto +z (Rodrigues about up×z by the angle between them).
  const ax: Vec3 = [up[1], -up[0], 0]; // up × (0,0,1)
  const axLen = Math.hypot(ax[0], ax[1], ax[2]);
  if (axLen > 1e-9) {
    const k: Vec3 = [ax[0] / axLen, ax[1] / axLen, ax[2] / axLen];
    const ang = Math.atan2(axLen, up[2]); // angle(up, +z)
    const c = Math.cos(ang),
      s = Math.sin(ang);
    pts = pts.map((p) => {
      const kd = k[0] * p[0] + k[1] * p[1] + k[2] * p[2];
      const cr: Vec3 = [
        k[1] * p[2] - k[2] * p[1],
        k[2] * p[0] - k[0] * p[2],
        k[0] * p[1] - k[1] * p[0],
      ];
      return [
        p[0] * c + cr[0] * s + k[0] * kd * (1 - c),
        p[1] * c + cr[1] * s + k[1] * kd * (1 - c),
        p[2] * c + cr[2] * s + k[2] * kd * (1 - c),
      ] as Vec3;
    });
  }
  // Spin about the (now-vertical) +z axis.
  if (spinDeg) {
    const a = (spinDeg * Math.PI) / 180;
    const c = Math.cos(a),
      s = Math.sin(a);
    pts = pts.map(
      (p) => [p[0] * c - p[1] * s, p[0] * s + p[1] * c, p[2]] as Vec3,
    );
  }
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const p of pts)
    for (let i = 0; i < 3; i++) {
      if (p[i]! < min[i]!) (min as number[])[i] = p[i]!;
      if (p[i]! > max[i]!) (max as number[])[i] = p[i]!;
    }
  const cen: Vec3 = [
    (min[0] + max[0]) / 2,
    (min[1] + max[1]) / 2,
    (min[2] + max[2]) / 2,
  ];
  const scl =
    SIZE / (Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) || 1);
  return {
    positions: pts.map(
      (p) =>
        [
          (p[0] - cen[0]) * scl,
          (p[1] - cen[1]) * scl,
          (p[2] - cen[2]) * scl,
        ] as Vec3,
    ),
    triangles: mi.triangles,
  };
}

/** A 3/4 perspective view framing the normalized (radius ≈ SIZE/2) model. */
const camFor = (m: Model): Camera => ({
  eye: [3.6, 2.7, 2.4],
  target: [0, 0, 0],
  up: [0, 0, 1],
  projection: "perspective",
  scale: m.fov,
  viewport: m.viewport,
});

/** Render one decimation level to an SVG panel, returning its face count too. */
function renderPanel(
  m: Model,
  mi: MeshInput,
  level: Level,
): { svg: string; faces: number } {
  const light: Light = { direction: m.light };
  const scene = new Scene({ svg: { background: BG }, light });
  const mesh = new Mesh(mi, {
    weldEps: SIZE * level.detail,
    ...(m.creaseAngle !== undefined ? { creaseAngle: m.creaseAngle } : {}),
  });
  const flat = level.flat ?? m.flatHatch; // per-panel override, else the model default
  const style: StyleOverride = { wobble: 0.7 };
  if (m.hidden) style.hidden = m.hidden;
  // field:false forces straight parallel hatch instead of the curvature streamlines
  if (m.hatch)
    style.hatch = {
      mode: m.hatch,
      spacingPx: 4,
      angle: 24,
      ...(flat ? { field: false } : {}),
    };
  scene.add(mesh).style(style);
  return { svg: scene.render(camFor(m)).svg, faces: mesh.he.faceCount };
}

function renderModel(m: Model): Drawing {
  const mi = normalize(m.parse(readFileSync(join(HERE, m.file))), m.up, m.spin);
  const panels = m.levels.map((l) => ({
    ...renderPanel(m, mi, l),
    tag: l.tag,
  }));
  // Each column is one level, labelled with its face count (top-centered by
  // `grid`); the source file is a caption along the bottom-left, clear of them.
  const colLabels = panels.map((p) =>
    p.tag
      ? `${p.tag} · ${p.faces.toLocaleString()} faces`
      : `${p.faces.toLocaleString()} faces`,
  );
  const sheet = grid(m.viewport, [panels.map((p) => p.svg)], {
    colLabels,
  }).toSvg();
  return raw(withLabels(sheet, [label(14, m.viewport.height - 12, m.file)]));
}

/** Render each model to its own named SVG (a `Figures` deliverable → one file per
 *  model, written beside the scene file by the render CLI). */
export function renderModels(models: Model[]): Figures {
  return figures(
    models.map((m) => ({ name: m.name, drawing: renderModel(m) })),
  );
}
