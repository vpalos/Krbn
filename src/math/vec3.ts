// Immutable 3-vector algebra. Pure functions over the `Vec3` tuple type; no
// hidden state, no allocation of classes. Kept exact/closed-form — this is
// foundation for the analytic primitive path (docs/DESIGN.md §2.9.1).

import type { Vec3 } from "./types.js";

export const vec3 = (x: number, y: number, z: number): Vec3 => [x, y, z];

export const ZERO3: Vec3 = [0, 0, 0];

export function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function scale(a: Vec3, s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s];
}

export function neg(a: Vec3): Vec3 {
  return [-a[0], -a[1], -a[2]];
}

/** Fused a + s*b — common enough (ray marching, lerps) to name explicitly. */
export function addScaled(a: Vec3, b: Vec3, s: number): Vec3 {
  return [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
}

export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

export function length(a: Vec3): number {
  return Math.hypot(a[0], a[1], a[2]);
}

export function lengthSq(a: Vec3): number {
  return a[0] * a[0] + a[1] * a[1] + a[2] * a[2];
}

export function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/**
 * Normalize. Returns the zero vector unchanged (caller decides if that is a
 * degenerate input); we deliberately do not throw here so hot paths stay
 * branch-light — degeneracy is handled at the geometric layer with named
 * tolerances, not by scattering guards through the algebra.
 */
export function normalize(a: Vec3): Vec3 {
  const len = length(a);
  if (len === 0) return a;
  const inv = 1 / len;
  return [a[0] * inv, a[1] * inv, a[2] * inv];
}

export function lerp(a: Vec3, b: Vec3, t: number): Vec3 {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

/** Any unit vector orthogonal to `a` (a must be non-zero). Stable choice: cross
 *  with whichever world axis is least aligned, avoiding a near-zero cross. */
export function anyPerpendicular(a: Vec3): Vec3 {
  const ax = Math.abs(a[0]);
  const ay = Math.abs(a[1]);
  const az = Math.abs(a[2]);
  const axis: Vec3 = ax <= ay && ax <= az ? [1, 0, 0] : ay <= az ? [0, 1, 0] : [0, 0, 1];
  return normalize(cross(a, axis));
}

export function approxEqual(a: Vec3, b: Vec3, eps: number): boolean {
  return (
    Math.abs(a[0] - b[0]) <= eps &&
    Math.abs(a[1] - b[1]) <= eps &&
    Math.abs(a[2] - b[2]) <= eps
  );
}
