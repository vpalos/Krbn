// The exact conic kernel — the critical path of the whole engine
// (ai/DESIGN.md §2.9.1, §5). Quantitative-invisibility crossings reduce to
// line–conic and conic–conic intersections, so this file has to be both exact
// and robust in every degenerate configuration (see numerical-robustness.md).
//
// Representation. A projective conic is the symmetric 3×3 matrix M with
//     pᵀ M p = 0,   p = (x, y, 1),
// related to the coefficient form A x² + B xy + C y² + D x + E y + F = 0 by
//     M = [ A    B/2  D/2 ]
//         [ B/2  C    E/2 ]
//         [ D/2  E/2  F   ].
//
// Intersection strategy (no high-degree solves):
//   • line–conic  → substitute the parametric line → one quadratic in t.
//   • conic–conic → the pencil C1 + λ C2 contains a *degenerate* member (a line
//     pair) at a real root of the cubic det(C1 + λ C2) = 0. Split that member
//     into its two lines, then reuse line–conic. Everything stays ≤ degree 3.

import type { Vec2 } from "../math/types.js";
import type { Mat3 } from "../math/mat3.js";
import type { ConicParams } from "./types.js";
import {
  adjugate,
  col,
  det,
  frobeniusNorm,
  quadForm,
  row,
  skew,
  symmetric,
  traceMul,
  addM,
  scaleM,
} from "../math/mat3.js";
import { solveCubicReal, solveQuadratic } from "./roots.js";
import { EPS_ABS, EPS_ONCURVE, EPS_POINT, EPS_RANK, EPS_REL } from "./epsilon.js";

// ---------------------------------------------------------------------------
// Conic <-> matrix, constructors
// ---------------------------------------------------------------------------

export function conicToMatrix(k: ConicParams): Mat3 {
  return symmetric(k.A, k.B / 2, k.D / 2, k.C, k.E / 2, k.F);
}

export function matrixToConic(m: Mat3): ConicParams {
  return {
    A: m[0],
    B: 2 * m[1],
    C: m[4],
    D: 2 * m[2],
    E: 2 * m[5],
    F: m[8],
  };
}

/** Circle (x-cx)² + (y-cy)² = r². */
export function circle(cx: number, cy: number, r: number): ConicParams {
  return { A: 1, B: 0, C: 1, D: -2 * cx, E: -2 * cy, F: cx * cx + cy * cy - r * r };
}

/** Axis-aligned ellipse centered at (cx,cy) with semi-axes (rx,ry). */
export function ellipseAxisAligned(cx: number, cy: number, rx: number, ry: number): ConicParams {
  const A = 1 / (rx * rx);
  const C = 1 / (ry * ry);
  return { A, B: 0, C, D: -2 * A * cx, E: -2 * C * cy, F: A * cx * cx + C * cy * cy - 1 };
}

/** Evaluate the conic polynomial at (x, y). Zero ⇒ on the curve. */
export function evaluateConic(k: ConicParams, x: number, y: number): number {
  return k.A * x * x + k.B * x * y + k.C * y * y + k.D * x + k.E * y + k.F;
}

// ---------------------------------------------------------------------------
// Lines in the plane
// ---------------------------------------------------------------------------

/** A parametric line P(t) = point + t · dir (dir need not be unit). */
export interface Line2 {
  point: Vec2;
  dir: Vec2;
}

/** Homogeneous line a·x + b·y + c = 0. */
export interface HomLine2 {
  a: number;
  b: number;
  c: number;
}

/** Homogeneous line → parametric line (nearest point to origin + perpendicular dir). */
export function homLineToParametric(l: HomLine2): Line2 {
  const nn = l.a * l.a + l.b * l.b;
  const s = nn > 0 ? -l.c / nn : 0;
  return {
    point: [l.a * s, l.b * s],
    dir: [l.b, -l.a], // orthogonal to the normal (a, b)
  };
}

// ---------------------------------------------------------------------------
// Line–conic intersection
// ---------------------------------------------------------------------------

export interface LineConicHit {
  /** parameter along the line: P(t) = line.point + t · line.dir */
  t: number;
  point: Vec2;
}

export type LineConicResult =
  /** the line lies entirely on (a component of) the conic */
  | { kind: "contained" }
  /** no real intersection */
  | { kind: "none" }
  /** tangency — a single point of double contact */
  | { kind: "tangent"; hit: LineConicHit }
  /** one crossing (degenerate quadratic: line meets an unbounded/degenerate conic once) */
  | { kind: "one"; hit: LineConicHit }
  /** two distinct crossings */
  | { kind: "two"; hits: [LineConicHit, LineConicHit] };

export function intersectLineConic(line: Line2, k: ConicParams): LineConicResult {
  const [ax, ay] = line.point;
  const [dx, dy] = line.dir;
  const { A, B, C, D, E, F } = k;

  // Quadratic q2 t² + q1 t + q0 = 0 from substituting P(t) into the conic.
  const q2 = A * dx * dx + B * dx * dy + C * dy * dy;
  const q1 = 2 * A * ax * dx + B * (ax * dy + ay * dx) + 2 * C * ay * dy + D * dx + E * dy;
  const q0 = A * ax * ax + B * ax * ay + C * ay * ay + D * ax + E * ay + F;

  const at = (t: number): LineConicHit => ({ t, point: [ax + t * dx, ay + t * dy] });

  const roots = solveQuadratic(q2, q1, q0);
  switch (roots.kind) {
    case "all":
      return { kind: "contained" };
    case "none":
      return { kind: "none" };
    case "double":
      return { kind: "tangent", hit: at(roots.x) };
    case "single":
      return { kind: "one", hit: at(roots.x) };
    case "two":
      return { kind: "two", hits: [at(roots.x0), at(roots.x1)] };
  }
}

// ---------------------------------------------------------------------------
// Degenerate-conic splitting (a line pair → its two lines)
// ---------------------------------------------------------------------------
//
// For a real line pair A = ℓ mᵀ + m ℓᵀ, one has adj(A) = -p pᵀ with p = ℓ × m
// (the lines' intersection point). Recover p from adj(A); then the antisymmetric
// identity [p]_× = m ℓᵀ - ℓ mᵀ gives the rank-1 matrix A - [p]_× = 2 ℓ mᵀ, whose
// columns are all multiples of ℓ and whose rows are all multiples of m. This is
// the numerically clean split (Richter-Gebert): only adjugate, a skew add, and
// picking the dominant row/column — no root finding beyond what got us here.

export type DegenerateSplit =
  | { kind: "lines"; lines: HomLine2[] } // one (doubled) or two real lines
  | { kind: "point"; p: Vec2 } // imaginary line pair meeting at a real point
  | { kind: "empty" };

function dominantColumn(m: Mat3): [number, number, number] {
  let best = 0;
  let bestNorm = -1;
  for (let c = 0; c < 3; c++) {
    const v = col(m, c);
    const n = v[0] * v[0] + v[1] * v[1] + v[2] * v[2];
    if (n > bestNorm) {
      bestNorm = n;
      best = c;
    }
  }
  const v = col(m, best);
  return [v[0], v[1], v[2]];
}

function dominantRow(m: Mat3): [number, number, number] {
  let best = 0;
  let bestNorm = -1;
  for (let r = 0; r < 3; r++) {
    const v = row(m, r);
    const n = v[0] * v[0] + v[1] * v[1] + v[2] * v[2];
    if (n > bestNorm) {
      bestNorm = n;
      best = r;
    }
  }
  const v = row(m, best);
  return [v[0], v[1], v[2]];
}

export function splitDegenerateConic(conic: Mat3): DegenerateSplit {
  const scale = frobeniusNorm(conic);
  if (scale <= EPS_ABS) return { kind: "empty" };
  // Work in a normalized copy so tolerances are scale-free.
  const M = scaleM(conic, 1 / scale);

  const adj = adjugate(M);

  // Intersection point p from adj(M) = -p pᵀ : diagonal entries are -p_i².
  let iMax = 0;
  let dMax = 0;
  for (let i = 0; i < 3; i++) {
    const dv = Math.abs(adj[i * 3 + i] as number);
    if (dv > dMax) {
      dMax = dv;
      iMax = i;
    }
  }

  if (dMax <= EPS_RANK) {
    // adj ≈ 0 ⇒ M is rank ≤ 1: a single (doubled) line ℓ with M = ±ℓ ℓᵀ.
    const l = dominantColumn(M);
    if (l[0] * l[0] + l[1] * l[1] + l[2] * l[2] <= EPS_ABS) return { kind: "empty" };
    return { kind: "lines", lines: [{ a: l[0], b: l[1], c: l[2] }] };
  }

  const diag = adj[iMax * 3 + iMax] as number;
  if (diag > 0) {
    // -p_i² > 0 is impossible for a real p ⇒ imaginary line pair. The only real
    // locus is the intersection point itself (e.g. x² + y² = 0 → origin).
    // Recover it from the column even though the lines are complex.
    const pc = col(adj, iMax);
    const w = pc[2];
    if (Math.abs(w) <= EPS_ABS) return { kind: "empty" };
    return { kind: "point", p: [pc[0] / w, pc[1] / w] };
  }

  const pi = Math.sqrt(-diag);
  const pcol = col(adj, iMax);
  // B[:,i] = -p_i p  ⇒  p = -B[:,i] / p_i.
  const p: [number, number, number] = [-pcol[0] / pi, -pcol[1] / pi, -pcol[2] / pi];

  // R = M - [p]_× = 2 ℓ mᵀ (rank 1). Columns ∝ ℓ, rows ∝ m.
  const R = addM(M, scaleM(skew(p), -1));
  const l = dominantColumn(R);
  const m = dominantRow(R);

  const lines: HomLine2[] = [{ a: l[0], b: l[1], c: l[2] }];
  // Distinguish two lines from a doubled one.
  if (!linesParallelAndClose(l, m)) {
    lines.push({ a: m[0], b: m[1], c: m[2] });
  }
  return { kind: "lines", lines };
}

function linesParallelAndClose(
  l: readonly [number, number, number],
  m: readonly [number, number, number],
): boolean {
  // Compare as homogeneous 3-vectors up to scale via the cross product magnitude.
  const cx = l[1] * m[2] - l[2] * m[1];
  const cy = l[2] * m[0] - l[0] * m[2];
  const cz = l[0] * m[1] - l[1] * m[0];
  const cross = Math.hypot(cx, cy, cz);
  const nl = Math.hypot(l[0], l[1], l[2]);
  const nm = Math.hypot(m[0], m[1], m[2]);
  if (nl <= EPS_ABS || nm <= EPS_ABS) return true;
  return cross <= EPS_REL * nl * nm;
}

// ---------------------------------------------------------------------------
// Conic–conic intersection
// ---------------------------------------------------------------------------

export interface IntersectionPoint {
  point: Vec2;
  /** true when the two conics touch here (tangency / double contact) */
  tangent: boolean;
}

export type ConicConicResult =
  /** the conics are the same curve (share infinitely many points) */
  | { kind: "coincident" }
  /** no real common points */
  | { kind: "none" }
  /** up to four real intersection points */
  | { kind: "points"; points: IntersectionPoint[] };

function normalized(m: Mat3): Mat3 {
  const s = frobeniusNorm(m);
  return s > 0 ? scaleM(m, 1 / s) : m;
}

/** Proportional up to scale (same conic)? */
function proportional(a: Mat3, b: Mat3): boolean {
  // find largest |a_k| and use it as the pivot to estimate the ratio
  let k = 0;
  let amax = 0;
  for (let i = 0; i < 9; i++) {
    const v = Math.abs(a[i] as number);
    if (v > amax) {
      amax = v;
      k = i;
    }
  }
  const bk = b[k] as number;
  if (Math.abs(bk) <= EPS_ABS) return false;
  const ratio = (a[k] as number) / bk;
  let diff = 0;
  for (let i = 0; i < 9; i++) diff += Math.abs((a[i] as number) - ratio * (b[i] as number));
  const na = frobeniusNorm(a);
  return diff <= EPS_REL * (na > 0 ? na : 1);
}

export function intersectConicConic(k1: ConicParams, k2: ConicParams): ConicConicResult {
  const C1 = normalized(conicToMatrix(k1));
  const C2 = normalized(conicToMatrix(k2));

  if (proportional(C1, C2)) return { kind: "coincident" };

  // Pencil cubic det(C1 + λ C2) = 0, expanded via
  //   det(A + λB) = det A + λ·tr(adj(A)·B) + λ²·tr(adj(B)·A) + λ³·det B.
  const adjC1 = adjugate(C1);
  const adjC2 = adjugate(C2);
  const c0 = det(C1);
  const c1 = traceMul(adjC1, C2);
  const c2 = traceMul(adjC2, C1);
  const c3 = det(C2);

  const lambdas = solveCubicReal(c3, c2, c1, c0);

  // Candidate degenerate members: pencil roots, plus C1/C2 themselves if already
  // degenerate (covers the λ → ∞ member when det C2 ≈ 0).
  const members: Mat3[] = [];
  for (const lam of lambdas) members.push(addM(C1, scaleM(C2, lam)));
  if (Math.abs(det(C1)) <= EPS_RANK) members.push(C1);
  if (Math.abs(det(C2)) <= EPS_RANK) members.push(C2);

  const collected: IntersectionPoint[] = [];
  let sawImaginaryPoint: Vec2 | null = null;

  for (const D of members) {
    // Only split members that are genuinely degenerate.
    if (Math.abs(det(normalized(D))) > EPS_RANK) continue;

    const split = splitDegenerateConic(D);
    if (split.kind === "empty") continue;
    if (split.kind === "point") {
      // An isolated real point candidate (imaginary line pair). Keep it only if
      // it actually lies on both conics.
      if (onConic(C1, split.p) && onConic(C2, split.p)) sawImaginaryPoint = split.p;
      continue;
    }

    for (const hl of split.lines) {
      const line = homLineToParametric(hl);
      const res = intersectLineConic(line, k1);
      const hits: LineConicHit[] = [];
      let tangent = false;
      switch (res.kind) {
        case "none":
        case "contained":
          break;
        case "tangent":
          hits.push(res.hit);
          tangent = true;
          break;
        case "one":
          hits.push(res.hit);
          break;
        case "two":
          hits.push(res.hits[0], res.hits[1]);
          break;
      }
      for (const h of hits) {
        // Membership on C2 (points from a λ≠0 member are automatically on C2;
        // this guards the λ≈0 and numerically-noisy cases).
        if (!onConic(C2, h.point)) continue;
        addUnique(collected, h.point, tangent);
      }
    }
  }

  if (collected.length > 0) return { kind: "points", points: collected };
  if (sawImaginaryPoint) return { kind: "points", points: [{ point: sawImaginaryPoint, tangent: true }] };
  return { kind: "none" };
}

/** Relative on-curve membership test for a homogeneous conic matrix. */
function onConic(M: Mat3, p: Vec2): boolean {
  const hp: [number, number, number] = [p[0], p[1], 1];
  const val = Math.abs(quadForm(M, hp, hp));
  // scale by the matrix magnitude and the point's homogeneous weight²
  const scale = frobeniusNorm(M) * (p[0] * p[0] + p[1] * p[1] + 1);
  return val <= EPS_ONCURVE * (scale > 0 ? scale : 1);
}

function addUnique(list: IntersectionPoint[], point: Vec2, tangent: boolean): void {
  for (const q of list) {
    if (Math.abs(q.point[0] - point[0]) <= EPS_POINT && Math.abs(q.point[1] - point[1]) <= EPS_POINT) {
      // merge: tangency wins if either flagged it (double contact)
      if (tangent) q.tangent = true;
      return;
    }
  }
  list.push({ point, tangent });
}
