// Phase-2: curvature-driven hatch field for meshes (docs/DESIGN.md §2.6, §3.3.2).
//
// The analytic primitives hatch along their exact iso-parameter curves. The mesh
// analogue is to hatch along the **principal-curvature direction field** — the
// lines a sculptor's tool would follow. We trace evenly-spaced streamlines of that
// field across the surface (Jobard & Lefebvre 1997) and hand them back as
// `HatchFieldCurve`s, so the scene's `clipHatchField` gives them visibility,
// tonal shading, wobble, and variable width for free.
//
// Three subtleties: (1) principal directions are a *line* field (± ambiguous), so
// interpolation aligns signs first and tracing keeps a consistent heading;
// (2) near umbilic points (κ1 ≈ κ2, e.g. a sphere) the direction is undefined —
// streamlines stop there, and if the whole surface is isotropic the field is empty
// (the scene then falls back to straight hatch); (3) tracing walks face-to-face
// over the triangle mesh.

import type { Vec3 } from "../math/types.js";
import type { HatchFieldCurve, HatchSample } from "../pipeline/types.js";
import { addScaled, cross, dot, length, normalize, sub } from "../math/vec3.js";
import type { HalfEdgeMesh } from "./halfedge.js";
import type { CurvatureField } from "./curvature.js";

/** Point located on the mesh: which face, its barycentric coords, the 3-D point. */
interface Loc {
  face: number;
  bary: [number, number, number];
  p: Vec3;
}

const BARY_TOL = 0.02;

/** Barycentric location of `q` (projected onto face `f`'s plane); null if outside. */
function locateInFace(mesh: HalfEdgeMesh, q: Vec3, f: number): Loc | null {
  const t = mesh.triangles[f]!;
  const a = mesh.positions[t[0]]!;
  const b = mesh.positions[t[1]]!;
  const c = mesh.positions[t[2]]!;
  const v0 = sub(b, a);
  const v1 = sub(c, a);
  const v2 = sub(q, a);
  const d00 = dot(v0, v0);
  const d01 = dot(v0, v1);
  const d11 = dot(v1, v1);
  const d20 = dot(v2, v0);
  const d21 = dot(v2, v1);
  const denom = d00 * d11 - d01 * d01;
  if (Math.abs(denom) < 1e-20) return null;
  const w1 = (d11 * d20 - d01 * d21) / denom;
  const w2 = (d00 * d21 - d01 * d20) / denom;
  const w0 = 1 - w1 - w2;
  if (w0 < -BARY_TOL || w1 < -BARY_TOL || w2 < -BARY_TOL) return null;
  const p: Vec3 = [a[0] + v0[0] * w1 + v1[0] * w2, a[1] + v0[1] * w1 + v1[1] * w2, a[2] + v0[2] * w1 + v1[2] * w2];
  return { face: f, bary: [w0, w1, w2], p };
}

/** Relocate `q` to the face containing it, searching `from` and its 1- and 2-ring
 *  face neighbours (streamline steps are small, so the point stays local). */
function relocate(mesh: HalfEdgeMesh, neighbors: number[][], q: Vec3, from: number): Loc | null {
  const seen = new Set<number>([from]);
  const ring: number[] = [from, ...neighbors[from]!];
  for (const n of neighbors[from]!) for (const nn of neighbors[n]!) if (!seen.has(nn)) { seen.add(nn); ring.push(nn); }
  let best: Loc | null = null;
  let bestDist = Infinity;
  for (const f of ring) {
    const loc = locateInFace(mesh, q, f);
    if (!loc) continue;
    const d = length(sub(q, loc.p));
    if (d < bestDist) {
      bestDist = d;
      best = loc;
    }
  }
  return best;
}

/** Per-face edge-adjacent neighbours (via half-edge twins). */
function faceNeighbors(mesh: HalfEdgeMesh): number[][] {
  const out: number[][] = [];
  for (let f = 0; f < mesh.faceCount; f++) {
    const ns: number[] = [];
    for (let k = 0; k < 3; k++) {
      const tw = mesh.heTwin[3 * f + k]!;
      if (tw >= 0) ns.push(mesh.heFace[tw]!);
    }
    out.push(ns);
  }
  return out;
}

/** A cheap spatial hash for the even-spacing separation test. It stores each
 *  point with its surface normal so that two strands passing *near each other in
 *  3-D but facing opposite ways* (e.g. a tube crossing over itself) are treated as
 *  separate and both get hatched — the reject only fires when the surface faces
 *  roughly the same way (same side of the same sheet). */
class SpatialHash {
  private readonly cell: number;
  private readonly map = new Map<string, { p: Vec3; n: Vec3 }[]>();
  constructor(cell: number) {
    this.cell = cell;
  }
  add(p: Vec3, n: Vec3): void {
    const k = `${Math.floor(p[0] / this.cell)},${Math.floor(p[1] / this.cell)},${Math.floor(p[2] / this.cell)}`;
    const l = this.map.get(k);
    if (l) l.push({ p, n });
    else this.map.set(k, [{ p, n }]);
  }
  nearAny(p: Vec3, n: Vec3, r: number): boolean {
    const r2 = r * r;
    const cx = Math.floor(p[0] / this.cell);
    const cy = Math.floor(p[1] / this.cell);
    const cz = Math.floor(p[2] / this.cell);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++) {
          const l = this.map.get(`${cx + dx},${cy + dy},${cz + dz}`);
          if (!l) continue;
          for (const q of l) {
            const ex = q.p[0] - p[0], ey = q.p[1] - p[1], ez = q.p[2] - p[2];
            if (ex * ex + ey * ey + ez * ez < r2 && q.n[0] * n[0] + q.n[1] * n[1] + q.n[2] * n[2] > 0.3) return true;
          }
        }
    return false;
  }
}

export interface MeshHatchOptions {
  /** target world-space separation between adjacent streamlines */
  spacing: number;
  /** which principal family: 0 = max-curvature direction, 1 = min */
  family: 0 | 1;
  /** samples of already-placed streamlines (a coarser atlas level): new
   *  streamlines seed *between* them, refining without moving what exists */
  occupied?: readonly HatchSample[];
}

/** Trace evenly-spaced streamlines of a principal-curvature direction field over
 *  the mesh; returns them as hatch field curves (world samples with normals), or
 *  `[]` if the surface is too isotropic to define a field. */
export function meshHatchField(mesh: HalfEdgeMesh, curv: CurvatureField, opts: MeshHatchOptions): HatchFieldCurve[] {
  const sep = opts.spacing;
  if (!(sep > 0)) return [];
  const dTest = 0.85 * sep;
  const step = Math.min(0.5 * sep, 0.9 * mesh.meanEdgeLength);
  if (!(step > 0)) return [];
  const neighbors = faceNeighbors(mesh);
  const grid = new SpatialHash(sep);
  for (const s of opts.occupied ?? []) grid.add(s.p, s.n);

  // A point is "umbilic" (no well-defined principal direction) when its two
  // principal curvatures are nearly equal *relative to their magnitude* — this is
  // scale-invariant, so a whole sphere reads as isotropic and yields no field.
  const UMBILIC_RATIO = 0.1;

  const N = mesh.vertexNormals;
  const P = mesh.positions;

  // principal direction (line field) at a located point, sign-aligned to `ref`.
  const fieldDir = (loc: Loc, ref: Vec3 | null): Vec3 | null => {
    const t = mesh.triangles[loc.face]!;
    const pick = (v: number): Vec3 => (opts.family === 0 ? curv.perVertex[v]!.dir1 : curv.perVertex[v]!.dir2);
    const d0 = pick(t[0]);
    let d1 = pick(t[1]);
    let d2 = pick(t[2]);
    if (dot(d1, d0) < 0) d1 = [-d1[0], -d1[1], -d1[2]];
    if (dot(d2, d0) < 0) d2 = [-d2[0], -d2[1], -d2[2]];
    const [w0, w1, w2] = loc.bary;
    let d: Vec3 = [d0[0] * w0 + d1[0] * w1 + d2[0] * w2, d0[1] * w0 + d1[1] * w1 + d2[1] * w2, d0[2] * w0 + d1[2] * w1 + d2[2] * w2];
    // project onto the face plane
    const fn = mesh.faceNormals[loc.face]!;
    d = sub(d, addScaled([0, 0, 0], fn, dot(d, fn)));
    if (length(d) < 1e-9) return null;
    d = normalize(d);
    // reject umbilic points (principal directions undefined when κ1 ≈ κ2)
    const c0 = curv.perVertex[t[0]]!;
    const c1 = curv.perVertex[t[1]]!;
    const c2 = curv.perVertex[t[2]]!;
    const k1i = c0.k1 * w0 + c1.k1 * w1 + c2.k1 * w2;
    const k2i = c0.k2 * w0 + c1.k2 * w1 + c2.k2 * w2;
    if (Math.abs(k1i - k2i) / (Math.abs(k1i) + Math.abs(k2i) + 1e-9) < UMBILIC_RATIO) return null;
    if (ref && dot(d, ref) < 0) return [-d[0], -d[1], -d[2]];
    return d;
  };

  const normalAt = (loc: Loc): Vec3 => {
    const t = mesh.triangles[loc.face]!;
    const [w0, w1, w2] = loc.bary;
    const n0 = N[t[0]]!;
    const n1 = N[t[1]]!;
    const n2 = N[t[2]]!;
    return normalize([n0[0] * w0 + n1[0] * w1 + n2[0] * w2, n0[1] * w0 + n1[1] * w1 + n2[1] * w2, n0[2] * w0 + n1[2] * w1 + n2[2] * w2]);
  };

  // cap streamline length to a few object diameters' worth of steps
  const bmin = [Infinity, Infinity, Infinity];
  const bmax = [-Infinity, -Infinity, -Infinity];
  for (const p of P) for (let i = 0; i < 3; i++) {
    if (p[i]! < bmin[i]!) bmin[i] = p[i]!;
    if (p[i]! > bmax[i]!) bmax[i] = p[i]!;
  }
  const diag = Math.hypot(bmax[0]! - bmin[0]!, bmax[1]! - bmin[1]!, bmax[2]! - bmin[2]!);
  const maxSteps = Math.ceil((3 * diag) / step) + 50;

  const dist2 = (a: Vec3, b: Vec3) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

  // Trace one direction from `seed`. `closed` means the streamline wrapped onto
  // itself (a loop) — most principal-direction lines on a tube do, so we must
  // stop instead of spiralling, and skip tracing the other way.
  //
  // Closure is detected as *self-proximity*: the trace stops when it comes
  // within `rSelf` of any of its own samples older than a short exempt tail
  // (Jobard–Lefebvre against the current line, not just finished ones). The
  // radius is capped at a few steps, NOT at dTest: an earlier version required
  // the trace to first travel 2·dTest from its seed before closure could fire,
  // and when the separation exceeds the loop size (a coarse atlas level tracing
  // a poloidal ring around a thin tube — 2·dTest > tube diameter) that could
  // never happen, so the trace wound the tube until maxSteps and rendered as a
  // dense coil. Self-proximity closes any loop after ~one circuit regardless of
  // the level's separation, and also stops a drifting spiral from packing
  // against its previous winding.
  const rSelf = Math.min(0.9 * dTest, 1.5 * step);
  const rSelf2 = rSelf * rSelf;
  const lag = Math.ceil((2 * rSelf) / step) + 1; // exempt the immediate tail
  const traceHalf = (seed: Loc, dir0: Vec3): { pts: HatchSample[]; closed: boolean } => {
    const pts: HatchSample[] = [];
    let loc: Loc = seed;
    let d: Vec3 | null = dir0;
    for (let i = 0; i < maxSteps && d; i++) {
      // relocate searches a 2-ring face neighbourhood, so on an anisotropic mesh
      // (short circumferential edges, long axial ones) a full step can overshoot
      // it; halve the step rather than kill the trace — a genuine boundary still
      // fails at every scale.
      let next = relocate(mesh, neighbors, addScaled(loc.p, d, step), loc.face);
      if (!next) next = relocate(mesh, neighbors, addScaled(loc.p, d, step / 2), loc.face);
      if (!next) next = relocate(mesh, neighbors, addScaled(loc.p, d, step / 4), loc.face);
      if (!next) break; // ran off the surface / a boundary
      if (i >= lag && dist2(next.p, seed.p) < rSelf2) return { pts, closed: true };
      for (let j = 0; j <= pts.length - lag; j++) {
        if (dist2(next.p, pts[j]!.p) < rSelf2) return { pts, closed: true };
      }
      const nn = normalAt(next);
      if (grid.nearAny(next.p, nn, dTest)) break; // too close to a same-facing streamline
      const nd = fieldDir(next, d);
      if (!nd) break; // umbilic
      pts.push({ p: next.p, n: nn });
      loc = next;
      d = nd;
    }
    return { pts, closed: false };
  };

  const curves: HatchFieldCurve[] = [];
  for (let seedFace = 0; seedFace < mesh.faceCount; seedFace++) {
    const c = mesh.faceCentroid(seedFace);
    const seed = locateInFace(mesh, c, seedFace);
    if (!seed) continue;
    const seedNormal = normalAt(seed);
    if (grid.nearAny(seed.p, seedNormal, sep)) continue; // region already covered
    const d0 = fieldDir(seed, null);
    if (!d0) continue; // umbilic seed
    const seedSample: HatchSample = { p: seed.p, n: seedNormal };
    const fwd = traceHalf(seed, d0);
    let samples: HatchSample[];
    if (fwd.closed) {
      samples = [seedSample, ...fwd.pts]; // a full loop — one direction is enough
    } else {
      const back = traceHalf(seed, [-d0[0], -d0[1], -d0[2]]);
      samples = [...back.pts.reverse(), seedSample, ...fwd.pts];
    }
    if (samples.length < 3) continue;
    for (const s of samples) grid.add(s.p, s.n); // occupy so later seeds keep their distance
    curves.push({ samples });
  }
  return curves;
}

// ---------------------------------------------------------------------------
// Streamline atlas — temporal coherence (docs/DESIGN.md §3.3.7; ROADMAP Phase-2
// item 6.4)
// ---------------------------------------------------------------------------

/**
 * A static, object-space, multi-resolution set of streamlines. Level k holds
 * only the streamlines *added* at spacing `baseSpacing / 2^k`, seeded around
 * everything coarser — so refining never moves an existing line. A frame asks
 * for the union of levels 0..k for its desired screen density; under camera
 * motion the drawn set changes only at discrete level switches (and then only
 * by *adding/removing the finest level*), never by re-seeding.
 *
 * The atlas is intrinsic geometry (like the curvature field it traces), so it
 * lives on the source and is built lazily per level — computing it inside a
 * per-frame call is caching, not view-dependent state.
 */
export class StreamlineAtlas {
  private readonly levels: HatchFieldCurve[][] = [];
  private readonly occupied: HatchSample[] = [];

  constructor(
    private readonly mesh: HalfEdgeMesh,
    private readonly curv: CurvatureField,
    readonly baseSpacing: number,
    private readonly family: 0 | 1,
    readonly maxLevels = 6,
  ) {}

  /** The complete level whose density best matches the demand: round(log2
   *  (base/desired)), clamped to the ladder. Discrete on purpose — a partially
   *  drawn interleaving level cannot look right in a still (faded by opacity it
   *  banded gray/black, by weight thick/thin, arriving line-by-line it paired
   *  lines with gaps — the artifact just moves channels; all were tried).
   *  Smoothing a zoom-driven level *switch* is cross-frame-state territory (a
   *  session-side crossfade), not a per-frame concern. */
  levelFor(desiredSpacing: number): number {
    if (!(desiredSpacing > 0) || !(this.baseSpacing > 0)) return 0;
    return Math.round(Math.min(this.maxLevels - 1, Math.max(0, Math.log2(this.baseSpacing / desiredSpacing))));
  }

  /** All streamlines of levels 0..levelFor(desiredSpacing), with stable keys
   *  (`m<family>:<level>:<i>`). Levels are traced once and cached; the camera
   *  only selects how many complete levels to draw. */
  curvesFor(desiredSpacing: number): HatchFieldCurve[] {
    const k = this.levelFor(desiredSpacing);
    while (this.levels.length <= k) {
      const lvl = this.levels.length;
      const curves = meshHatchField(this.mesh, this.curv, {
        spacing: this.baseSpacing / 2 ** lvl,
        family: this.family,
        occupied: this.occupied,
      });
      for (let i = 0; i < curves.length; i++) curves[i]!.key = `m${this.family}:${lvl}:${i}`;
      this.levels.push(curves);
      for (const c of curves) this.occupied.push(...c.samples);
    }
    return this.levels.slice(0, k + 1).flat();
  }
}
