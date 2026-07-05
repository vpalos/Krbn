// Centralized tolerances for the exact-primitive path.
//
// Per .claude/rules/numerical-robustness.md: epsilons are explicit and live in
// ONE place, never sprinkled as magic numbers, and are relative/scaled wherever
// a meaningful scale exists. Each constant documents *why* it has its value.
//
// The base unit is the f64 machine epsilon (~2.22e-16). Everything else is a
// deliberate multiple of it, so tolerances scale with the precision we actually
// have rather than with arbitrary hand-tuned decimals.

/** IEEE-754 double machine epsilon. */
export const MACHINE_EPS = 2.220446049250313e-16;

/**
 * Absolute floor used when a quantity has no natural scale to relativize
 * against (e.g. a bare determinant of a normalized matrix). ~1e-12 leaves
 * ~4 decimal digits of headroom above machine noise for degree ≤ 4 algebra.
 */
export const EPS_ABS = 1e-12;

/**
 * Relative tolerance for comparing magnitudes (a ≈ b when |a-b| ≤ REL·max(|a|,|b|)).
 * ~1e-9 is the practical accuracy of closed-form conic roots after the handful
 * of multiply/adds in the pencil method; tighter would flag well-conditioned
 * results as failures.
 */
export const EPS_REL = 1e-9;

/**
 * Discriminant tolerance for classifying a quadratic root as a *double* root
 * (tangency). Scaled by the polynomial's coefficient magnitude at the call
 * site; this is the dimensionless threshold applied to the normalized
 * discriminant. Chosen loose enough to catch near-tangency (an ill-conditioned
 * near-double root) as the design demands (numerical-robustness.md).
 */
export const EPS_DISCRIMINANT = 1e-9;

/**
 * Tolerance for deciding a matrix is rank-deficient (degenerate conic / singular
 * pencil member), applied to a determinant that has been normalized by the
 * matrix's Frobenius scale so the test is genuinely relative.
 */
export const EPS_RANK = 1e-9;

/** Two screen/plane points are the same when within this distance (post-scale). */
export const EPS_POINT = 1e-9;

/**
 * Smallest determinant / denominator we will divide by in a closed-form solve
 * (conic centre, plane→screen homography, 2×2 / 3×3 linear systems). Below this
 * the formula is treated as degenerate rather than producing a blown-up result.
 * Near machine epsilon because these divisors are not pre-normalized.
 */
export const EPS_DENOM = 1e-15;

/**
 * Inclusion slack for a *normalized* parameter at an interval endpoint — e.g. a
 * segment parameter in [0,1] or a curve parameter at its domain ends. Absolute
 * because the parameter is already unit-scaled.
 */
export const EPS_PARAM = 1e-9;

/**
 * Relative slack (fraction of the parameter span) for merging/deduping feature
 * parameters — visibility crossing events and interval bounds. Looser than
 * EPS_PARAM so distinct-but-adjacent events collapse, tighter than any real
 * interval we care to keep.
 */
export const EPS_PARAM_REL = 1e-7;

/**
 * Relative tolerance for on-curve membership and back-projection *residuals*
 * (point-on-conic, ray↔line closest-approach distance). Deliberately looser than
 * EPS_REL: these values survive a chain of projective ops (project → intersect →
 * unproject) and accumulate more rounding than a single closed-form root.
 */
export const EPS_ONCURVE = 1e-6;

/** Absolute tolerance on an angle in radians (arc closed-flag, θ-range clamps). */
export const EPS_ANGLE = 1e-9;

/**
 * Relative depth floor (fraction of scene scale) used to skip a viewing ray's
 * *originating* surface when testing occlusion — the self-hit sits at t ≈ 0, so
 * anything nearer than this is the feature's own surface, not an occluder.
 */
export const EPS_DEPTH_REL = 1e-6;

/**
 * Relative comparison helper: true when a and b agree to EPS_REL, with an
 * absolute floor so values near zero still compare sanely.
 */
export function approxEq(a: number, b: number, rel = EPS_REL, abs = EPS_ABS): boolean {
  const diff = Math.abs(a - b);
  if (diff <= abs) return true;
  return diff <= rel * Math.max(Math.abs(a), Math.abs(b));
}

/** True when |x| is within the absolute floor of zero. */
export function isZero(x: number, abs = EPS_ABS): boolean {
  return Math.abs(x) <= abs;
}
