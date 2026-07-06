// Variable stroke width (ai/DESIGN.md §4). A pencil line is not a constant-weight
// ruler stroke: it swells and thins under hand pressure and tapers at its ends.
// This computes a per-vertex width for a screen polyline, which the SVG backend
// turns into a filled *ribbon* (offset the centreline by ±w/2). Width = base
// weight (the emphasis already set by role/importance) × taper × pressure, with
// the taper/pressure *character* scaled by the element's one hand knob (`wobble`)
// so `wobble: 0` stays a uniform technical line.

import type { Vec2 } from "../math/types.js";

/** fraction of the run length over which each end ramps from tip to full width */
const TAPER_FRAC = 0.18;
/** end width as a fraction of the mid width (a visible tip, not a vanishing point) */
const END_FLOOR = 0.35;
/** ± width swing from the pressure noise, at full character */
const PRESSURE_AMP = 0.35;
/** pressure-noise cycles per screen pixel (a swell roughly every ~30px) */
const PRESSURE_FREQ = 0.03;

/** integer-lattice hash → [-1, 1] (self-contained, matches wobble's family). */
function lattice(i: number, seed: number): number {
  let h = Math.imul((i | 0) ^ seed, 2246822519);
  h ^= h >>> 15;
  h = Math.imul(h, 3266489917);
  h ^= h >>> 13;
  return ((h >>> 0) / 0xffffffff) * 2 - 1;
}

/** smooth 1-D value noise in [-1, 1]. */
function valueNoise(x: number, seed: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  const a = lattice(i, seed);
  const b = lattice(i + 1, seed);
  return a + (b - a) * u;
}

/** two-octave fractal noise for a slightly livelier pressure. */
function fbm(x: number, seed: number): number {
  return 0.68 * valueNoise(x, seed) + 0.32 * valueNoise(x * 2.03 + 11.7, seed ^ 0x9e3779b9);
}

export interface WidthInput {
  /** the final (post-wobble) screen polyline */
  path: readonly Vec2[];
  /** stroke identity seed (shared with wobble so a stroke's hand is consistent) */
  seed: number;
  /** the emphasis weight to modulate (role/importance already baked in) */
  baseWidth: number;
  /** 0 = uniform ruler width, ~1 = full pencil character (the `wobble` knob) */
  amount: number;
}

/**
 * A swappable stroke-width profile. Replace this to change how a line breathes
 * (e.g. a dry-brush or a marker) without touching the emit or backend layers —
 * they only consume the per-vertex width array.
 */
export interface WidthStrategy {
  widths(input: WidthInput): number[];
}

export interface WidthParams {
  taperFrac?: number;
  endFloor?: number;
  pressureAmp?: number;
  pressureFreq?: number;
}

/**
 * The built-in pencil profile: a smooth thin→thick→thin taper at the ends times a
 * seeded 1-D pressure noise along the (screen) arclength, blended in by `amount`
 * so a stroke with `wobble: 0` stays perfectly uniform.
 */
export function createWidth(params: WidthParams = {}): WidthStrategy {
  const taperFrac = params.taperFrac ?? TAPER_FRAC;
  const endFloor = params.endFloor ?? END_FLOOR;
  const amp = params.pressureAmp ?? PRESSURE_AMP;
  const freq = params.pressureFreq ?? PRESSURE_FREQ;
  return {
    widths({ path, seed, baseWidth, amount }) {
      const n = path.length;
      if (n < 2) return path.map(() => baseWidth);
      // cumulative screen arclength
      const L: number[] = [0];
      for (let i = 1; i < n; i++) L.push(L[i - 1]! + Math.hypot(path[i]![0] - path[i - 1]![0], path[i]![1] - path[i - 1]![1]));
      const total = L[n - 1]! || 1;
      const blend = Math.max(0, amount);
      const out: number[] = [];
      for (let i = 0; i < n; i++) {
        const u = L[i]! / total;
        const e = Math.min(1, Math.max(0, Math.min(u, 1 - u) / taperFrac));
        const taper = endFloor + (1 - endFloor) * (e * e * (3 - 2 * e)); // smoothstep ramp
        const pressure = 1 + amp * fbm(L[i]! * freq, seed);
        const mult = 1 + blend * (taper * pressure - 1); // amount 0 ⇒ uniform
        out.push(Math.max(0.15, baseWidth * mult));
      }
      return out;
    },
  };
}

/** Default width strategy — the pencil taper + pressure profile. */
export const defaultWidth: WidthStrategy = createWidth();
