// Hatch generation (docs/DESIGN.md §2.6). Parallel lines in the region's direction
// field, clipped *exactly* to its projected outline: for a conic outline the clip
// is a line–conic chord (kernel-exact); for a polygon it is the usual even–odd
// edge crossing. `single`/`cross`/`triple` stack 1/2/3 angle sets; spacing comes
// from the region tone (denser = darker) unless overridden.
//
// This produces the *geometry* only. Clipping the hatch to the visible surface
// (so gaps reveal what is behind — the alpha-free transparency of §0.3) is done
// by the scene render, which back-projects each segment onto the owner surface
// and reuses the same occlusion test as the visibility stage.

import type { Vec2 } from "../math/types.js";
import type { Curve2D, ConicParams } from "../curve/types.js";
import type { HatchMode, HatchRegion } from "./types.js";
import { intersectLineConic, evaluateConic } from "../curve/conic.js";
import { EPS_ABS, EPS_DENOM, EPS_PARAM, EPS_POINT } from "../curve/epsilon.js";

export type Segment = readonly [Vec2, Vec2];

export interface HatchOptions {
  /** overrides the tone-derived spacing */
  spacingPx?: number;
  /** clamp so a bad tone can't emit thousands of lines */
  minSpacingPx?: number;
}

const DEG = Math.PI / 180;

/** The hatch angle set for a mode: 1 (single), 2 (cross), or 3 (triple) angles.
 *  Also used by the scene to draw one *tonal layer* per angle. */
export function hatchAngles(mode: HatchMode, angleDeg: number): number[] {
  switch (mode) {
    case "single":
      return [angleDeg];
    case "cross":
      return [angleDeg, angleDeg + 90];
    case "triple":
      return [angleDeg, angleDeg + 60, angleDeg + 120];
  }
}

/** Darker regions hatch tighter. tone 0 → 11px, tone 1 → 3px (slightly denser
 *  than the original 14→4 so tonal bands read more strongly). Shared with the
 *  scene so curved direction fields pick the same tone-driven spacing. */
export function toneToSpacing(tone: number): number {
  const t = Math.max(0, Math.min(1, tone));
  return 11 - 8 * t;
}

function conicCenter(k: ConicParams): Vec2 {
  const det = 4 * k.A * k.C - k.B * k.B;
  if (Math.abs(det) < EPS_DENOM) return [0, 0];
  return [(-2 * k.C * k.D + k.B * k.E) / det, (-2 * k.A * k.E + k.B * k.D) / det];
}

/** Sample points around a conic (for bbox / offset range only). */
function sampleConic(k: ConicParams): Vec2[] {
  const [cx, cy] = conicCenter(k);
  const Fc = evaluateConic(k, cx, cy);
  const pts: Vec2[] = [];
  for (let i = 0; i < 64; i++) {
    const th = (2 * Math.PI * i) / 64;
    const c = Math.cos(th);
    const s = Math.sin(th);
    const form = k.A * c * c + k.B * c * s + k.C * s * s;
    if (Math.abs(form) < EPS_DENOM) continue;
    const ratio = -Fc / form; // sign-invariant: Fc and form flip together
    if (ratio <= 0) continue;
    const rho = Math.sqrt(ratio);
    pts.push([cx + rho * c, cy + rho * s]);
  }
  return pts;
}

/** Region outline as sample points (for offset range) + a kind tag for clipping. */
function outlinePoints(outline: Curve2D): Vec2[] {
  switch (outline.kind) {
    case "polyline":
      return outline.pts.map((p) => [p[0], p[1]]);
    case "conic":
      return sampleConic(outline.params);
    case "line":
      return [outline.a, outline.b];
    case "arc":
      return []; // arcs are not fillable regions
  }
}

const cross2 = (px: number, py: number, qx: number, qy: number) => px * qy - py * qx;

/** Clip an infinite hatch line (point + unit dir) to one or more closed loops,
 *  even–odd — so an outline plus holes yields the annulus between them. */
function clipToLoops(point: Vec2, dir: Vec2, loops: readonly Vec2[][]): Segment[] {
  const ts: number[] = [];
  for (const poly of loops) {
    const n = poly.length;
    for (let i = 0; i < n; i++) {
      const a = poly[i]!;
      const b = poly[(i + 1) % n]!;
      const ex = b[0] - a[0];
      const ey = b[1] - a[1];
      const denom = cross2(dir[0], dir[1], ex, ey);
      if (Math.abs(denom) < EPS_ABS) continue;
      const apx = a[0] - point[0];
      const apy = a[1] - point[1];
      const t = cross2(apx, apy, ex, ey) / denom;
      const u = cross2(apx, apy, dir[0], dir[1]) / denom;
      if (u >= -EPS_PARAM && u <= 1 + EPS_PARAM) ts.push(t);
    }
  }
  ts.sort((p, q) => p - q);
  const segs: Segment[] = [];
  for (let i = 0; i + 1 < ts.length; i += 2) {
    const t0 = ts[i]!;
    const t1 = ts[i + 1]!;
    if (t1 - t0 < EPS_POINT) continue;
    segs.push([
      [point[0] + t0 * dir[0], point[1] + t0 * dir[1]],
      [point[0] + t1 * dir[0], point[1] + t1 * dir[1]],
    ]);
  }
  return segs;
}

/** Clip an infinite hatch line to a conic; the interior chord (if any). */
function clipToConic(point: Vec2, dir: Vec2, k: ConicParams): Segment[] {
  const res = intersectLineConic({ point, dir }, k);
  if (res.kind === "two") return [[res.hits[0].point, res.hits[1].point]];
  return [];
}

/** One hatch line's clipped segments plus its stable identity within the region:
 *  `key` = angle-set index + the line's integer offset index from the region's
 *  anchor — so the same physical line keeps the same key (and hence the same
 *  wobble seed) from frame to frame, regardless of how many lines the region
 *  needs this frame or how visibility clipping splits them. */
export interface HatchLine {
  seg: Segment;
  key: string;
}

/** Generate keyed hatch lines filling a region. Line phase: offsets run through
 *  `region.anchorPx` (the projected object anchor) when present, so the family
 *  translates with the object under camera pan instead of being pinned to
 *  multiples of `spacing` from the screen origin (temporal coherence). */
export function generateHatchLines(region: HatchRegion, opts: HatchOptions = {}): HatchLine[] {
  const pts = outlinePoints(region.outline);
  if (pts.length < 2) return [];
  const minSpacing = opts.minSpacingPx ?? 2;
  const spacing = Math.max(minSpacing, opts.spacingPx ?? toneToSpacing(region.tone));

  // polygon loops: the outline plus any holes (even–odd → annulus)
  const loops =
    region.outline.kind === "polyline" || region.holes?.length
      ? [dedupClose(pts), ...(region.holes ?? []).map((h) => dedupClose(outlinePoints(h)))]
      : [];

  const lines: HatchLine[] = [];
  const angles = hatchAngles(region.mode, region.angle);
  for (let ai = 0; ai < angles.length; ai++) {
    const a = angles[ai]! * DEG;
    const dir: Vec2 = [Math.cos(a), Math.sin(a)];
    const normal: Vec2 = [-Math.sin(a), Math.cos(a)];

    // offset range: project outline points onto the normal
    let lo = Infinity;
    let hi = -Infinity;
    for (const p of pts) {
      const d = p[0] * normal[0] + p[1] * normal[1];
      if (d < lo) lo = d;
      if (d > hi) hi = d;
    }
    // phase: lines at anchor + n·spacing (screen origin when no anchor)
    const aOff = region.anchorPx ? region.anchorPx[0] * normal[0] + region.anchorPx[1] * normal[1] : 0;
    const n0 = Math.ceil((lo - aOff) / spacing);
    for (let n = n0; aOff + n * spacing <= hi; n++) {
      const off = aOff + n * spacing;
      const point: Vec2 = [normal[0] * off, normal[1] * off];
      const clipped =
        region.outline.kind === "conic" && !region.holes?.length
          ? clipToConic(point, dir, region.outline.params)
          : clipToLoops(point, dir, loops);
      for (const s of clipped) lines.push({ seg: s, key: `${ai}:${n}` });
    }
  }
  return lines;
}

/** Generate hatch segments filling a region (points-only view of
 *  `generateHatchLines`). */
export function generateHatch(region: HatchRegion, opts: HatchOptions = {}): Segment[] {
  return generateHatchLines(region, opts).map((l) => l.seg);
}

// ---------------------------------------------------------------------------
// Pluggable strategy
// ---------------------------------------------------------------------------

/**
 * A swappable hatch-pattern generator. Replace this to change how a region is
 * filled (e.g. contour-following or stippled hatching) without touching the
 * scene, styling, or visibility clipping — the scene consumes `Segment[]` and
 * clips them to the visible surface regardless of how they were produced.
 */
export interface HatchStrategy {
  generate(region: HatchRegion, opts: HatchOptions): Segment[];
  /** Optional keyed variant: the scene prefers it when present, so each line's
   *  wobble seed follows the line's stable identity across frames instead of
   *  its emission order (temporal coherence). Strategies without it still work;
   *  their lines get enumeration-order keys. */
  generateLines?(region: HatchRegion, opts: HatchOptions): HatchLine[];
}

/** The built-in parallel-line hatch. */
export const defaultHatch: HatchStrategy = {
  generate: (region, opts) => generateHatch(region, opts),
  generateLines: (region, opts) => generateHatchLines(region, opts),
};

function dedupClose(pts: Vec2[]): Vec2[] {
  if (pts.length > 1) {
    const a = pts[0]!;
    const b = pts[pts.length - 1]!;
    if (Math.abs(a[0] - b[0]) < EPS_POINT && Math.abs(a[1] - b[1]) < EPS_POINT) return pts.slice(0, -1);
  }
  return pts;
}
