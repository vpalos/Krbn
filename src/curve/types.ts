import type { Vec2, Vec3, Basis } from "../math/types.js";

/**
 * The geometry carrier that flows between pipeline stages.
 *
 * Analytic features stay analytic until emit, to preserve exactness and exact
 * crossings (ai/DESIGN.md §1.4). The mesh regime supplies { kind: 'polyline' }.
 */
export type Curve =
  | { kind: "line"; a: Vec3; b: Vec3 }
  | {
      kind: "arc";
      center: Vec3;
      radius: number;
      plane: Basis;
      a0: number;
      a1: number;
    }
  | { kind: "conic"; params: ConicParams; plane: Basis }
  | { kind: "bezier"; pts: Vec3[] }
  | { kind: "polyline"; pts: Vec3[] };

/**
 * A projected curve in screen space. Used to place quantitative-invisibility
 * crossing events (ai/DESIGN.md §2.4), so it is kept analytic where possible.
 */
export type Curve2D =
  | { kind: "line"; a: Vec2; b: Vec2 }
  | { kind: "arc"; center: Vec2; radius: number; a0: number; a1: number }
  | { kind: "conic"; params: ConicParams }
  | { kind: "polyline"; pts: Vec2[] };

/** General conic: A x² + B xy + C y² + D x + E y + F = 0. */
export interface ConicParams {
  A: number;
  B: number;
  C: number;
  D: number;
  E: number;
  F: number;
}
