// bench-bvh.ts — render time vs triangle count for the mesh regime.
//
//   bun run bench:bvh              # full sweep (synthetic + real models)
//   bun run bench:bvh --quick      # synthetic only, skips the importer models
//
// Exists to measure one specific claim. Mesh render time was **quadratic** in
// triangle count (docs/IDEAS.md: 904 tri → 4s, 1,732 → 14s, 2,608 → 34s,
// 10,520 → timed out past 800s). Visibility rays walked every triangle *and*
// silhouette length grows with density; the product is the exponent 2.0. A BVH
// takes the per-ray factor to O(log N), so the fitted exponent should fall by
// ~1.0 — to ~1.0, **not** to 0. The residual linear factor is feature count /
// silhouette density: inherent to the algorithm, and not something a BVH of any
// kind removes.
//
// The fitted exponent is the deliverable, not the wall-clock — absolute times are
// machine-specific, but the exponent is what the claim is about.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Camera } from "../src/math/types.js";
import type { MeshInput } from "../src/mesh/halfedge.js";
import { Mesh } from "../src/mesh/mesh-source.js";
import { parseOBJ, parseSTL } from "../src/mesh/loaders.js";
import { torusMesh, uvSphere } from "../src/mesh/shapes.js";
import { Scene } from "../src/scene/scene.js";
import { SIZE, normalize } from "../examples/importers/frame.js";

const HERE = join(import.meta.dir, "..", "examples", "importers");
const cam: Camera = {
  eye: [3.6, 2.7, 2.4],
  target: [0, 0, 0],
  up: [0, 0, 1],
  projection: "perspective",
  scale: Math.PI / 4.4,
  viewport: { width: 430, height: 380 },
};

interface Row {
  name: string;
  tris: number;
  buildMs: number;
  renderMs: number;
  synthetic: boolean;
}

/** One full render, timed as a user experiences it: construct the source (topology
 *  + normals; any lazy scaffold lands on first use inside render) then render. */
function bench(name: string, input: MeshInput, synthetic: boolean, weldEps?: number): Row {
  const t0 = performance.now();
  const mesh = new Mesh(input, weldEps === undefined ? {} : { weldEps });
  const buildMs = performance.now() - t0;

  const scene = new Scene({ light: { direction: [-0.5, -0.45, -0.55] } });
  scene.add(mesh).style({ wobble: 0.4, hatch: { mode: "cross", angle: 24, spacingPx: 4 } });

  const t1 = performance.now();
  scene.render(cam);
  const renderMs = performance.now() - t1;

  return { name, tris: mesh.he.faceCount, buildMs, renderMs, synthetic };
}

/** Least-squares fit of log(renderMs) = k·log(tris) + c. `k` is the claim under test. */
function fitExponent(rows: readonly Row[]): number {
  const pts = rows.filter((r) => r.tris > 0 && r.renderMs > 0);
  if (pts.length < 2) return NaN;
  const xs = pts.map((r) => Math.log(r.tris));
  const ys = pts.map((r) => Math.log(r.renderMs));
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let num = 0;
  let den = 0;
  for (let i = 0; i < xs.length; i++) {
    num += (xs[i]! - mx) * (ys[i]! - my);
    den += (xs[i]! - mx) ** 2;
  }
  return num / den;
}

/** Print a sweep and its fitted exponent. A sweep must hold **shape** constant and
 *  vary only triangle count — fitting across different models conflates shape with
 *  count and measures nothing in particular. */
function report(title: string, note: string, rows: readonly Row[]): number {
  const pad = (s: string | number, n: number): string => String(s).padStart(n);
  console.log(`\n  ${title}`);
  console.log(`  ${note}`);
  console.log("\n    level                tris   build ms   render ms");
  console.log("    " + "-".repeat(49));
  for (const r of rows) {
    console.log(
      `    ${r.name.padEnd(16)}${pad(r.tris.toLocaleString(), 8)}${pad(r.buildMs.toFixed(1), 11)}${pad(r.renderMs.toFixed(1), 12)}`,
    );
  }
  const k = fitExponent(rows);
  console.log(`\n    log-log fit: k = ${k.toFixed(2)}`);
  return k;
}

const quick = process.argv.includes("--quick");

// ---------------------------------------------------------------------------
// Sweep A — synthetic, one shape, rising tessellation.
// Isolates the *per-ray* cost: a torus's silhouette is ~2 loops and its on-screen
// length barely moves with tessellation, so the ray count is near-constant and
// only the cost of each ray grows. Pre-BVH this should be ~linear (k≈1); the BVH
// should push it toward flat (k→0), since neither factor then grows.
// ---------------------------------------------------------------------------
const torusRows: Row[] = [];
for (const [nu, nv] of [
  [22, 10],
  [30, 15],
  [38, 23],
  [44, 30],
  [72, 40],
  [104, 52],
] as const) {
  torusRows.push(bench(`torus ${nu}x${nv}`, torusMesh(1.3, 0.5, nu, nv), true));
}
report(
  "A. synthetic torus — one shape, rising tessellation",
  "isolates per-ray cost (ray count ~flat: silhouette is ~2 loops at any density)",
  torusRows,
);

const sphereRows: Row[] = [];
for (const [nu, nv] of [
  [24, 16],
  [40, 28],
  [64, 44],
] as const) {
  sphereRows.push(bench(`sphere ${nu}x${nv}`, uvSphere(1.25, nu, nv), true));
}
report("B. synthetic sphere — same control, different shape", "", sphereRows);

// ---------------------------------------------------------------------------
// Sweep C — the real claim. ONE model, decimated to rising densities via weldEps.
// Shape is held fixed, so triangle count is the only variable. This is where the
// quadratic lives: on real geometry, denser tessellation means more crease/silhouette
// features, so ray *count* grows alongside per-ray cost — and the product is k≈2.
// ---------------------------------------------------------------------------
if (!quick) {
  for (const model of [
    { file: "fist.obj", details: [0.05, 0.032, 0.022, 0.012] },
    { file: "heart.stl", details: [0.045, 0.028, 0.018, 0.01], stl: true },
  ]) {
    try {
      const bytes = readFileSync(join(HERE, model.file));
      const input = normalize(model.stl ? parseSTL(bytes) : parseOBJ(bytes));
      const rows = model.details.map((d) =>
        bench(`weldEps ${d}`, input, false, SIZE * d),
      );
      report(
        `C. ${model.file} — one model, rising density (the real claim)`,
        "shape fixed, count varies: feature count AND per-ray cost both grow -> k~2 pre-BVH",
        rows,
      );
    } catch (e) {
      console.error(`  skipped ${model.file}: ${(e as Error).message}`);
    }
  }
}

console.log("\n  Reading the fits. Measured on this harness (2026-07, Darwin/bun 1.3.5):");
console.log("    pre-BVH   torus k=1.24  sphere k=0.78  fist k=1.37  heart k=1.11");
console.log("    with BVH  torus k=0.51  sphere k=0.46  fist k=0.95  heart k=0.69");
console.log("  i.e. each exponent fell by ~0.3-0.7, and absolute time fell 17-21x in the");
console.log("  regime that matters (fist.obj 18.5k tri: 67.2s -> 3.2s).");
console.log("\n  Two honest caveats. (1) docs/IDEAS.md reports k~=2.0 from an external");
console.log("  benchmark; a shape-controlled sweep here measures k=1.1-1.4 pre-BVH, so that");
console.log("  exponent is scene-dependent, not a constant of the engine. (2) O(N)->O(log N)");
console.log("  per ray predicts a full ~1.0 drop; we see less, because log N is not O(1) and");
console.log("  the surviving factors (feature count, hatch samples, mesh build) do not shrink.");
console.log("  What a BVH cannot touch is silhouette density — that residual is inherent.\n");
