// ---------------------------------------------------------------------------
// STL import → pencil render.  bun run render:importers  → one SVG per model.
//
// The import path, end to end:
//
//     parseSTL(bytes)              a *pure* format decoder — binary or ASCII is
//                                  auto-detected (by the exact size formula, not
//                                  the header: binary files often start with
//                                  `solid` too), winding repaired against each
//                                  facet's stored normal, and the full-detail
//                                  triangle soup comes back as a `MeshInput`.
//     new Mesh(input, { weldEps }) welds that soup back into shared topology (STL
//                                  stores no shared vertices) — and `weldEps` is
//                                  *also the decimation knob*: a coarser weld
//                                  merges more vertices, so the mesh gets lighter.
//                                  The level is the caller's, per model, right
//                                  here — never baked into the loader.
//
// A tiny watertight cube at full detail (faceted triple hatch), and a heart shown
// flat hatch vs the mesh's curvature-driven hatch side by side (same geometry, only
// the stroke flow differs). See `frame.ts` for the shared framing.
// ---------------------------------------------------------------------------
import { parseSTL } from "../../src/mesh/loaders.js";
import { renderModels, type Model } from "./frame.js";

const MODELS: Model[] = [
  {
    file: "cube.stl",
    name: "cube",
    parse: parseSTL,
    levels: [{ detail: 0.001, tag: "full detail" }],
    hatch: "triple",
    spin: 5,
    fov: Math.PI / 4.2,
    viewport: { width: 380, height: 380 },
    light: [-0.45, -0.25, -0.6],
  },
  {
    file: "heart.stl",
    name: "heart",
    parse: parseSTL,
    // same geometry both panels; the columns differ only in hatch style
    levels: [
      { detail: 0.01, tag: "flat hatch", flat: true },
      { detail: 0.01, tag: "curvature hatch", flat: false },
    ],
    hidden: "drop",
    hatch: "triple",
    creaseAngle: (50 * Math.PI) / 180, // keep the sharp panel edges, drop tessellation noise
    fov: Math.PI / 6,
    viewport: { width: 420, height: 320 },
    light: [-0.5, -0.55, -0.5],
  },
];

export default renderModels(MODELS);
