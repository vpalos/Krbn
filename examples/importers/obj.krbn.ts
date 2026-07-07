// ---------------------------------------------------------------------------
// OBJ import → pencil render.  bun run render:importers  → one SVG per model.
//
//     parseOBJ(bytes)              reads the geometry subset (`v`/`f`), skipping
//                                  `vt`/`vn`/`g`/`usemtl`/… . Face vertices may be
//                                  `v`, `v/vt`, `v/vt/vn`, or `v//vn`; indices are
//                                  1-based (negatives count from the end); quads
//                                  and n-gons are fan-triangulated.
//     new Mesh(input, { weldEps }) — unlike STL, OBJ already ships a *shared* vertex
//                                  table, so the topology is there for free (no weld
//                                  needed); `weldEps` here is purely the decimation knob.
//
// Three models — a low-poly mushroom, a Tower-of-Hanoi stack, and an organic fist
// scan — each shown flat hatch vs the mesh's **curvature-driven hatch** (streamlines
// of the principal-direction field that wrap the form). Same pipeline as every other
// source; only the bytes came from a different format. See `frame.ts` for the framing.
// ---------------------------------------------------------------------------
import { parseOBJ } from "../../src/mesh/loaders.js";
import { renderModels, type Model } from "./frame.js";

const MODELS: Model[] = [
  {
    file: "mushroom.obj",
    name: "mushroom",
    parse: parseOBJ,
    levels: [
      { detail: 0.01, tag: "flat hatch", flat: true },
      { detail: 0.01, tag: "curved hatch", flat: false },
    ],
    hatch: "triple",
    creaseAngle: Math.PI / 3, // organic scan — suppress the pseudo-creases decimation would invent
    flatHatch: true,
    hidden: "drop",
    spin: 180, // face the fist toward the camera
    up: [0, 1, 0],
    fov: Math.PI / 4.6,
    viewport: { width: 420, height: 420 },
    light: [-0.45, -0.5, -0.6],
  },
  {
    file: "hanoi.obj",
    name: "hanoi",
    parse: parseOBJ,
    levels: [
      { detail: 0.01, tag: "flat hatch", flat: true },
      { detail: 0.01, tag: "curved hatch", flat: false },
    ],
    hatch: "triple",
    creaseAngle: Math.PI, // organic scan — suppress the pseudo-creases decimation would invent
    flatHatch: true,
    hidden: "drop",
    up: [0, 1, 0],
    spin: 180,
    fov: Math.PI / 4.6,
    viewport: { width: 420, height: 420 },
    light: [-0.45, -0.5, -0.6],
  },
  {
    file: "fist.obj",
    name: "fist",
    parse: parseOBJ,
    levels: [
      { detail: 0.012, tag: "flat hatch", flat: true },
      { detail: 0.012, tag: "curved hatch", flat: false },
    ],
    hatch: "triple",
    creaseAngle: Math.PI, // organic scan — suppress the pseudo-creases decimation would invent
    hidden: "drop",
    up: [0, 1, 0],
    spin: 250, // face the fist toward the camera
    fov: Math.PI / 4.6,
    viewport: { width: 420, height: 420 },
    light: [-0.45, -0.5, -0.6],
  },
];

export default renderModels(MODELS);
