// Immutable 2-vector algebra (screen / plane space). Mirrors vec3.ts.

import type { Vec2 } from "./types.js";

export const vec2 = (x: number, y: number): Vec2 => [x, y];

export function add2(a: Vec2, b: Vec2): Vec2 {
  return [a[0] + b[0], a[1] + b[1]];
}

export function sub2(a: Vec2, b: Vec2): Vec2 {
  return [a[0] - b[0], a[1] - b[1]];
}

export function scale2(a: Vec2, s: number): Vec2 {
  return [a[0] * s, a[1] * s];
}

export function dot2(a: Vec2, b: Vec2): number {
  return a[0] * b[0] + a[1] * b[1];
}

/** 2D scalar cross (z of the 3D cross) — sign gives orientation. */
export function cross2(a: Vec2, b: Vec2): number {
  return a[0] * b[1] - a[1] * b[0];
}

export function length2(a: Vec2): number {
  return Math.hypot(a[0], a[1]);
}

export function distance2(a: Vec2, b: Vec2): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

export function normalize2(a: Vec2): Vec2 {
  const len = length2(a);
  if (len === 0) return a;
  const inv = 1 / len;
  return [a[0] * inv, a[1] * inv];
}

export function approxEqual2(a: Vec2, b: Vec2, eps: number): boolean {
  return Math.abs(a[0] - b[0]) <= eps && Math.abs(a[1] - b[1]) <= eps;
}
