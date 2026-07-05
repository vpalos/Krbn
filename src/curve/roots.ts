// Robust real-root solvers for the low-degree polynomials the conic kernel
// reduces to (numerical-robustness.md: "roots of low-degree polynomials, solved
// in closed form"). Quadratics come from line–conic; the cubic resolvent from
// the conic–conic pencil.
//
// Two robustness commitments here:
//   1. No catastrophic cancellation in the quadratic — we use the
//      sign-stable (Citardauq) form q = -½(b + sgn(b)√D), x = {q/a, c/q}.
//   2. Degeneracy is a *typed outcome*, never a NaN. Double roots (tangency),
//      the linear fallback (a→0), and the empty/identical cases are named.

import { EPS_ABS, EPS_DISCRIMINANT } from "./epsilon.js";

export type QuadraticRoots =
  /** a ≈ b ≈ c ≈ 0: every x satisfies it (coincident constraint). */
  | { kind: "all" }
  /** No real root (negative discriminant, or a=b=0 with c≠0). */
  | { kind: "none" }
  /** Linear case (a ≈ 0): a single simple root. */
  | { kind: "single"; x: number }
  /** Real double root — the tangency / near-tangency case. */
  | { kind: "double"; x: number }
  /** Two distinct real roots, returned ascending. */
  | { kind: "two"; x0: number; x1: number };

/**
 * Solve a·x² + b·x + c = 0 over the reals.
 *
 * The discriminant is classified against a tolerance *scaled by the magnitudes
 * of b² and 4ac*, so "double root" means the two roots coincide to relative
 * precision — this is what lets a line tangent to a conic report a clean double
 * root instead of two noisy nearly-equal ones (numerical-robustness.md).
 */
export function solveQuadratic(a: number, b: number, c: number): QuadraticRoots {
  // Degenerate to linear when the quadratic coefficient vanishes.
  if (Math.abs(a) <= EPS_ABS) {
    if (Math.abs(b) <= EPS_ABS) {
      return Math.abs(c) <= EPS_ABS ? { kind: "all" } : { kind: "none" };
    }
    return { kind: "single", x: -c / b };
  }

  const disc = b * b - 4 * a * c;
  // Relative scale of the discriminant's constituent terms.
  const scale = b * b + Math.abs(4 * a * c);
  const discTol = EPS_DISCRIMINANT * (scale > 0 ? scale : 1);

  if (Math.abs(disc) <= discTol) {
    // Double root (tangency). -b/(2a) is exact at the coincidence.
    return { kind: "double", x: -b / (2 * a) };
  }
  if (disc < 0) return { kind: "none" };

  // Sign-stable quadratic formula to avoid cancellation in b ± √disc.
  const sqrtD = Math.sqrt(disc);
  const q = -0.5 * (b + Math.sign(b || 1) * sqrtD);
  const r0 = q / a;
  const r1 = c / q;
  return r0 <= r1 ? { kind: "two", x0: r0, x1: r1 } : { kind: "two", x0: r1, x1: r0 };
}

/**
 * Real roots of a·x³ + b·x² + c·x + d = 0, ascending. Length 1–3 for a genuine
 * cubic. Falls through to the quadratic/linear solvers when leading
 * coefficients vanish. Uses the trigonometric method for three real roots
 * (well-conditioned, no complex arithmetic) and Cardano for the single-real
 * case.
 */
export function solveCubicReal(a: number, b: number, c: number, d: number): number[] {
  if (Math.abs(a) <= EPS_ABS) {
    const q = solveQuadratic(b, c, d);
    switch (q.kind) {
      case "all":
      case "none":
        return [];
      case "single":
        return [q.x];
      case "double":
        return [q.x];
      case "two":
        return [q.x0, q.x1];
    }
  }

  // Normalize to x³ + Bx² + Cx + D.
  const B = b / a;
  const C = c / a;
  const D = d / a;

  // Depress: x = t - B/3  →  t³ + p t + q.
  const B3 = B / 3;
  const p = C - (B * B) / 3;
  const q = (2 * B * B * B) / 27 - (B * C) / 3 + D;

  const roots: number[] = [];
  const discriminant = (q * q) / 4 + (p * p * p) / 27;

  const cubeRoot = (v: number) => (v < 0 ? -Math.pow(-v, 1 / 3) : Math.pow(v, 1 / 3));

  if (Math.abs(p) <= EPS_ABS && Math.abs(q) <= EPS_ABS) {
    // Triple root at the depression center.
    roots.push(-B3);
  } else if (discriminant > EPS_ABS) {
    // One real root (Cardano), two complex.
    const sqrtDisc = Math.sqrt(discriminant);
    const u = cubeRoot(-q / 2 + sqrtDisc);
    const v = cubeRoot(-q / 2 - sqrtDisc);
    roots.push(u + v - B3);
  } else if (discriminant < -EPS_ABS) {
    // Three distinct real roots (trigonometric / Viète).
    const m = 2 * Math.sqrt(-p / 3);
    const theta = Math.acos(
      // clamp guards against tiny overshoot outside [-1, 1] from rounding.
      Math.max(-1, Math.min(1, (3 * q) / (p * m))),
    ) / 3;
    for (let k = 0; k < 3; k++) {
      roots.push(m * Math.cos(theta - (2 * Math.PI * k) / 3) - B3);
    }
  } else {
    // discriminant ≈ 0: a real double root plus a distinct real root.
    const u = cubeRoot(-q / 2);
    roots.push(2 * u - B3, -u - B3);
  }

  return roots.sort((x, y) => x - y);
}

/**
 * Real roots of a·x⁴ + b·x³ + c·x² + d·x + e = 0, ascending. Ferrari's method:
 * depress to y⁴ + p y² + q y + r, factor into two quadratics via a positive real
 * root of the resolvent cubic w³ + 2p w² + (p²−4r) w − q² = 0, then solve each
 * quadratic. Every root is finished with a couple of Newton steps on the original
 * polynomial for accuracy. The degree-4 case the ray–torus intersection needs
 * (numerical-robustness.md: closed-form where possible).
 */
export function solveQuarticReal(a: number, b: number, c: number, d: number, e: number): number[] {
  if (Math.abs(a) <= EPS_ABS) return solveCubicReal(b, c, d, e);

  const B = b / a, C = c / a, D = d / a, E = e / a;
  const B4 = B / 4;
  // depressed quartic y⁴ + p y² + q y + r  (x = y − B/4)
  const p = C - (3 * B * B) / 8;
  const q = D - (B * C) / 2 + (B * B * B) / 8;
  const r = E - (B * D) / 4 + (B * B * C) / 16 - (3 * B * B * B * B) / 256;

  const roots: number[] = [];
  const pushQuadratic = (bb: number, cc: number) => {
    const disc = bb * bb - 4 * cc;
    if (disc < 0) return;
    const s = Math.sqrt(disc);
    roots.push((-bb + s) / 2 - B4, (-bb - s) / 2 - B4);
  };

  if (Math.abs(q) <= 1e-12) {
    // biquadratic: y² = (−p ± √(p²−4r)) / 2
    const disc = p * p - 4 * r;
    if (disc >= 0) {
      const s = Math.sqrt(disc);
      for (const y2 of [(-p + s) / 2, (-p - s) / 2]) {
        if (y2 >= 0) {
          const y = Math.sqrt(y2);
          roots.push(y - B4, -y - B4);
        }
      }
    }
  } else {
    // resolvent cubic; take the largest positive real root
    let w = 0;
    for (const cr of solveCubicReal(1, 2 * p, p * p - 4 * r, -q * q)) if (cr > w) w = cr;
    if (w > 0) {
      const alpha = Math.sqrt(w);
      const beta = (p + w - q / alpha) / 2;
      const gamma = (p + w + q / alpha) / 2;
      pushQuadratic(alpha, beta); //  y² + α y + β = 0
      pushQuadratic(-alpha, gamma); //  y² − α y + γ = 0
    }
  }

  // Newton polish on the original quartic.
  const f = (x: number) => (((a * x + b) * x + c) * x + d) * x + e;
  const fp = (x: number) => ((4 * a * x + 3 * b) * x + 2 * c) * x + d;
  for (let i = 0; i < roots.length; i++) {
    let x = roots[i]!;
    for (let k = 0; k < 3; k++) {
      const yp = fp(x);
      if (Math.abs(yp) <= EPS_ABS) break;
      const nx = x - f(x) / yp;
      if (!Number.isFinite(nx)) break;
      x = nx;
    }
    roots[i] = x;
  }
  return roots.sort((u, v) => u - v);
}
