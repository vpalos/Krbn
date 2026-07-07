// 4x4 matrix algebra, row-major. A quadric surface is the symmetric 4×4 matrix Q
// with Pᵀ Q P = 0 for homogeneous P = (x, y, z, 1). The apparent-contour method
// (docs/DESIGN.md §2.2) needs the *dual* quadric adj(Q), so determinant and
// adjugate live here alongside the basic ops.

import type { Vec3 } from "./types.js";

/** Row-major 4x4 (16 entries). */
export type Mat4 = readonly number[]; // length 16

export function mat4(...m: number[]): Mat4 {
  return m;
}

/** Symmetric 4×4 from its upper triangle (row-major fill of the mirror). */
export function symmetric4(
  m00: number, m01: number, m02: number, m03: number,
  m11: number, m12: number, m13: number,
  m22: number, m23: number,
  m33: number,
): Mat4 {
  return [
    m00, m01, m02, m03,
    m01, m11, m12, m13,
    m02, m12, m22, m23,
    m03, m13, m23, m33,
  ];
}

export function get4(m: Mat4, r: number, c: number): number {
  return m[r * 4 + c] as number;
}

export function transpose4(m: Mat4): Mat4 {
  const t = new Array<number>(16);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) t[c * 4 + r] = m[r * 4 + c] as number;
  return t;
}

export function mulM4(a: Mat4, b: Mat4): Mat4 {
  const out = new Array<number>(16).fill(0);
  for (let r = 0; r < 4; r++)
    for (let c = 0; c < 4; c++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += (a[r * 4 + k] as number) * (b[k * 4 + c] as number);
      out[r * 4 + c] = s;
    }
  return out;
}

/** M · (v, w) as a homogeneous 4-vector. */
export function mulVec4(m: Mat4, x: number, y: number, z: number, w: number): [number, number, number, number] {
  return [
    (m[0] as number) * x + (m[1] as number) * y + (m[2] as number) * z + (m[3] as number) * w,
    (m[4] as number) * x + (m[5] as number) * y + (m[6] as number) * z + (m[7] as number) * w,
    (m[8] as number) * x + (m[9] as number) * y + (m[10] as number) * z + (m[11] as number) * w,
    (m[12] as number) * x + (m[13] as number) * y + (m[14] as number) * z + (m[15] as number) * w,
  ];
}

/** Gradient direction (∇ of Pᵀ Q P = 2 Q P) at a point on a quadric — the surface normal. */
export function quadricNormal(q: Mat4, p: Vec3): Vec3 {
  const g = mulVec4(q, p[0], p[1], p[2], 1);
  return [g[0], g[1], g[2]];
}

// 3×3 minor determinant of the 4×4 with row `sr` and column `sc` removed.
function minor3(m: Mat4, sr: number, sc: number): number {
  const rows: number[] = [];
  const cols: number[] = [];
  for (let i = 0; i < 4; i++) {
    if (i !== sr) rows.push(i);
    if (i !== sc) cols.push(i);
  }
  const a = (r: number, c: number) => m[(rows[r] as number) * 4 + (cols[c] as number)] as number;
  return (
    a(0, 0) * (a(1, 1) * a(2, 2) - a(1, 2) * a(2, 1)) -
    a(0, 1) * (a(1, 0) * a(2, 2) - a(1, 2) * a(2, 0)) +
    a(0, 2) * (a(1, 0) * a(2, 1) - a(1, 1) * a(2, 0))
  );
}

export function det4(m: Mat4): number {
  let d = 0;
  for (let c = 0; c < 4; c++) {
    const sign = c % 2 === 0 ? 1 : -1;
    d += sign * (m[c] as number) * minor3(m, 0, c);
  }
  return d;
}

/**
 * Adjugate (transpose of the cofactor matrix). adj(Q) is the dual quadric; for
 * an invertible Q it is det(Q)·Q⁻¹. Symmetric when Q is symmetric.
 */
export function adjugate4(m: Mat4): Mat4 {
  const out = new Array<number>(16);
  for (let r = 0; r < 4; r++)
    for (let c = 0; c < 4; c++) {
      const sign = (r + c) % 2 === 0 ? 1 : -1;
      // cofactor_{r,c} = sign · minor(r,c); adjugate = transpose ⇒ store at (c,r)
      out[c * 4 + r] = sign * minor3(m, r, c);
    }
  return out;
}
