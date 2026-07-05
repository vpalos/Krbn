// Seeded, deterministic "hand-drawn" wobble (ai/DESIGN.md §4).
//
// The default (`createWobble`) offsets each vertex by a screen-space vector
// sampled from a seeded 3-D noise field keyed on the vertex's *object-space
// position*. This is the coherence-preserving formulation:
//   • deterministic — same scene ⇒ same wobble, never re-randomized per frame;
//   • joins at shared vertices — two strokes through the same 3-D point (a
//     cylinder ruling meeting its rim, a cone's generators at the apex) receive
//     the *same* offset, so they meet exactly instead of splitting;
//   • continuous across visibility intervals — a hidden/visible split shares the
//     one field, so dashes line up with solids;
//   • anchored to geometry, not screen — a fixed 3-D point keeps its offset as the
//     camera moves (view-dependent features like silhouettes still drift mildly,
//     since their generating point moves on the surface).
//
// `applyWobble` (the older per-stroke lateral offset) is kept as a lower-level
// building block.

import type { Vec2, Vec3 } from "../math/types.js";
import { EPS_POINT } from "../curve/epsilon.js";

/** Peak lateral offset (px) at wobble = 1 (lateral `applyWobble`). */
const AMPLITUDE_PX = 2.6;
/** Noise cycles per world unit of arclength (lateral `applyWobble`). */
const FREQUENCY = 3.1;
/** Default vertex spacing (px) when densifying a run so wobble has room to bend. */
const WOBBLE_STEP_PX = 6;

/** Peak per-axis screen offset (px) at wobble = 1 for the spatial field. */
const SPATIAL_AMPLITUDE_PX = 1.9;
/** Spatial-noise cycles per world unit. */
const SPATIAL_FREQUENCY = 1.7;

/** FNV-1a string hash → uint32, for turning a stroke identity into a seed. */
export function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Integer-lattice hash → [-1, 1]. */
function latticeNoise(i: number, seed: number): number {
  let h = Math.imul(i ^ seed, 2246822519);
  h ^= h >>> 15;
  h = Math.imul(h, 3266489917);
  h ^= h >>> 13;
  return ((h >>> 0) / 0xffffffff) * 2 - 1;
}

/** Smooth 1-D value noise in [-1, 1]. */
function valueNoise(x: number, seed: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f); // smoothstep
  const a = latticeNoise(i, seed);
  const b = latticeNoise(i + 1, seed);
  return a + (b - a) * u;
}

/** Two-octave fractal noise for a slightly richer line. */
function fbm(x: number, seed: number): number {
  return 0.68 * valueNoise(x, seed) + 0.32 * valueNoise(x * 2.03 + 11.7, seed ^ 0x9e3779b9);
}

/** 3-D integer-lattice hash → [-1, 1]. */
function lattice3(ix: number, iy: number, iz: number, seed: number): number {
  let h = Math.imul((ix | 0) ^ seed, 2246822519);
  h = Math.imul(h ^ (iy | 0), 3266489917);
  h ^= h >>> 15;
  h = Math.imul(h ^ (iz | 0), 668265263);
  h ^= h >>> 13;
  return ((h >>> 0) / 0xffffffff) * 2 - 1;
}

/** Trilinear smooth value noise in 3-D, in [-1, 1]. */
function valueNoise3(x: number, y: number, z: number, seed: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const w = fz * fz * (3 - 2 * fz);
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const c000 = lattice3(ix, iy, iz, seed), c100 = lattice3(ix + 1, iy, iz, seed);
  const c010 = lattice3(ix, iy + 1, iz, seed), c110 = lattice3(ix + 1, iy + 1, iz, seed);
  const c001 = lattice3(ix, iy, iz + 1, seed), c101 = lattice3(ix + 1, iy, iz + 1, seed);
  const c011 = lattice3(ix, iy + 1, iz + 1, seed), c111 = lattice3(ix + 1, iy + 1, iz + 1, seed);
  const x00 = lerp(c000, c100, u), x10 = lerp(c010, c110, u);
  const x01 = lerp(c001, c101, u), x11 = lerp(c011, c111, u);
  return lerp(lerp(x00, x10, v), lerp(x01, x11, v), w);
}

function fbm3(x: number, y: number, z: number, seed: number): number {
  return 0.66 * valueNoise3(x, y, z, seed) + 0.34 * valueNoise3(x * 2.02 + 9.3, y * 2.02 + 4.1, z * 2.02 + 7.7, seed ^ 0x9e3779b9);
}

/** Screen-space offset (px) for a 3-D point, sampled from the seeded field. */
function spatialOffset(p: Vec3, seed: number, ampPx: number, freq: number): [number, number] {
  const x = p[0] * freq, y = p[1] * freq, z = p[2] * freq;
  const ox = fbm3(x, y, z, seed);
  const oy = fbm3(x + 11.3, y + 7.1, z + 5.9, seed ^ 0x85ebca6b);
  return [ox * ampPx, oy * ampPx];
}

/**
 * Offset each vertex of `path` laterally by a seeded noise sampled at that
 * vertex's object-space arclength. `arclength[i]` is the cumulative world-space
 * distance to vertex i; `amount` is the wobble intensity (0 = ruler). Returns a
 * new path (endpoints participate, so strokes read as sketched, not clamped).
 */
export function applyWobble(
  path: readonly Vec2[],
  arclength: readonly number[],
  seed: number,
  amount: number,
): Vec2[] {
  return wobblePath(path, arclength, seed, amount, AMPLITUDE_PX, FREQUENCY);
}

/** Core offsetter, parameterized so a strategy can tune amplitude/frequency. */
function wobblePath(
  path: readonly Vec2[],
  arclength: readonly number[],
  seed: number,
  amount: number,
  amplitudePx: number,
  frequency: number,
): Vec2[] {
  if (amount <= 0 || path.length < 2) return path.map((p) => [p[0], p[1]]);
  const amp = amount * amplitudePx;
  const out: Vec2[] = [];
  for (let i = 0; i < path.length; i++) {
    const prev = path[Math.max(0, i - 1)]!;
    const next = path[Math.min(path.length - 1, i + 1)]!;
    let tx = next[0] - prev[0];
    let ty = next[1] - prev[1];
    const len = Math.hypot(tx, ty);
    if (len <= EPS_POINT) {
      out.push([path[i]![0], path[i]![1]]);
      continue;
    }
    tx /= len;
    ty /= len;
    // screen-space normal (perpendicular to the local tangent)
    const nx = -ty;
    const ny = tx;
    const w = fbm(arclength[i]! * frequency, seed) * amp;
    out.push([path[i]![0] + nx * w, path[i]![1] + ny * w]);
  }
  return out;
}

/**
 * Densify a screen polyline (and its object-space companion) so no gap exceeds
 * `stepPx`. Needed before wobbling otherwise straight, sparsely-sampled runs have
 * no interior vertices for the noise to bend. Interpolation is linear in both
 * screen and object space — exact for the flat segments the sampler produces.
 */
export function densify(
  path: readonly Vec2[],
  points3: readonly (readonly [number, number, number])[],
  stepPx: number,
): { path: Vec2[]; points3: [number, number, number][] } {
  const outP: Vec2[] = [[path[0]![0], path[0]![1]]];
  const outQ: [number, number, number][] = [[points3[0]![0], points3[0]![1], points3[0]![2]]];
  for (let i = 1; i < path.length; i++) {
    const a2 = path[i - 1]!;
    const b2 = path[i]!;
    const a3 = points3[i - 1]!;
    const b3 = points3[i]!;
    const d = Math.hypot(b2[0] - a2[0], b2[1] - a2[1]);
    const k = Math.max(1, Math.ceil(d / stepPx));
    for (let j = 1; j <= k; j++) {
      const t = j / k;
      outP.push([a2[0] + (b2[0] - a2[0]) * t, a2[1] + (b2[1] - a2[1]) * t]);
      outQ.push([a3[0] + (b3[0] - a3[0]) * t, a3[1] + (b3[1] - a3[1]) * t, a3[2] + (b3[2] - a3[2]) * t]);
    }
  }
  return { path: outP, points3: outQ };
}

/** Cumulative world-space arclength of a 3-D sample sequence. */
export function arclengthOf(points: readonly (readonly [number, number, number])[]): number[] {
  const s: number[] = [0];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    s.push(s[i - 1]! + Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]));
  }
  return s;
}

// ---------------------------------------------------------------------------
// Pluggable strategy
// ---------------------------------------------------------------------------

/** Everything a wobble algorithm gets: the sampled screen run + its object-space
 *  companion (for coherence), the identity seed, and the intensity. */
export interface WobbleInput {
  path: readonly Vec2[];
  points3: readonly Vec3[];
  /** seed derived from element identity — shared across an element's features so
   *  its strokes join at common vertices */
  seed: number;
  /** 0 = ruler, ~1 = hero sketchy */
  amount: number;
}

/**
 * A swappable line-perturbation algorithm. Replace this to change the entire
 * "hand-drawn" character without touching visibility, styling, or the backend
 * (the layer only communicates through `WobbleInput` → screen polyline).
 */
export interface WobbleStrategy {
  apply(input: WobbleInput): Vec2[];
}

export interface WobbleParams {
  /** peak per-axis screen offset (px) at amount = 1 */
  amplitudePx?: number;
  /** spatial-noise cycles per world unit */
  frequency?: number;
  /** densify spacing so straight runs have interior vertices to bend */
  stepPx?: number;
}

/**
 * The built-in coherence-preserving wobble: each densified vertex is offset in
 * screen space by a seeded 3-D noise field sampled at its object-space position,
 * so any two strokes sharing a 3-D vertex receive the same offset and stay
 * joined. Tunable amplitude / frequency / density.
 */
export function createWobble(params: WobbleParams = {}): WobbleStrategy {
  const amplitudePx = params.amplitudePx ?? SPATIAL_AMPLITUDE_PX;
  const frequency = params.frequency ?? SPATIAL_FREQUENCY;
  const stepPx = params.stepPx ?? WOBBLE_STEP_PX;
  return {
    apply({ path, points3, seed, amount }) {
      if (amount <= 0 || path.length < 2) return path.map((p) => [p[0], p[1]]);
      const dense = densify(path, points3, stepPx);
      const amp = amount * amplitudePx;
      return dense.path.map((p, i) => {
        const [ox, oy] = spatialOffset(dense.points3[i]!, seed, amp, frequency);
        return [p[0] + ox, p[1] + oy];
      });
    },
  };
}

/** Default wobble strategy — the coherence-preserving spatial field. */
export const defaultWobble: WobbleStrategy = createWobble();

