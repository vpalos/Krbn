// 3x3 matrix algebra, row-major. Used by the conic kernel: a projective conic is
// a symmetric 3x3 acting on homogeneous points p = (x, y, 1), with pᵀ M p = 0.
// The pencil/degenerate-split intersection method (ai/DESIGN.md §2.4) needs
// determinant, adjugate, and the skew (cross-product) matrix, so they live here.

import type { Vec3 } from "./types.js";

/** Row-major 3x3: [ m00,m01,m02, m10,m11,m12, m20,m21,m22 ]. */
export type Mat3 = readonly [
  number, number, number,
  number, number, number,
  number, number, number,
];

export const IDENTITY3: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

export function mat3(
  m00: number, m01: number, m02: number,
  m10: number, m11: number, m12: number,
  m20: number, m21: number, m22: number,
): Mat3 {
  return [m00, m01, m02, m10, m11, m12, m20, m21, m22];
}

/** Symmetric matrix from its upper triangle — the natural conic constructor. */
export function symmetric(
  m00: number, m01: number, m02: number,
  m11: number, m12: number,
  m22: number,
): Mat3 {
  return [m00, m01, m02, m01, m11, m12, m02, m12, m22];
}

export function get(m: Mat3, r: number, c: number): number {
  return m[r * 3 + c] as number;
}

/** Column r of the matrix. */
export function col(m: Mat3, c: number): Vec3 {
  return [m[c] as number, m[c + 3] as number, m[c + 6] as number];
}

/** Row r of the matrix. */
export function row(m: Mat3, r: number): Vec3 {
  const o = r * 3;
  return [m[o] as number, m[o + 1] as number, m[o + 2] as number];
}

export function addM(a: Mat3, b: Mat3): Mat3 {
  return [
    a[0] + b[0], a[1] + b[1], a[2] + b[2],
    a[3] + b[3], a[4] + b[4], a[5] + b[5],
    a[6] + b[6], a[7] + b[7], a[8] + b[8],
  ];
}

export function scaleM(a: Mat3, s: number): Mat3 {
  return [
    a[0] * s, a[1] * s, a[2] * s,
    a[3] * s, a[4] * s, a[5] * s,
    a[6] * s, a[7] * s, a[8] * s,
  ];
}

export function transpose(m: Mat3): Mat3 {
  return [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
}

export function mulM(a: Mat3, b: Mat3): Mat3 {
  return [
    a[0] * b[0] + a[1] * b[3] + a[2] * b[6],
    a[0] * b[1] + a[1] * b[4] + a[2] * b[7],
    a[0] * b[2] + a[1] * b[5] + a[2] * b[8],
    a[3] * b[0] + a[4] * b[3] + a[5] * b[6],
    a[3] * b[1] + a[4] * b[4] + a[5] * b[7],
    a[3] * b[2] + a[4] * b[5] + a[5] * b[8],
    a[6] * b[0] + a[7] * b[3] + a[8] * b[6],
    a[6] * b[1] + a[7] * b[4] + a[8] * b[7],
    a[6] * b[2] + a[7] * b[5] + a[8] * b[8],
  ];
}

/** M · v (v as a column vector). */
export function mulVec(m: Mat3, v: Vec3): Vec3 {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}

/** Bilinear form aᵀ M b — the conic membership test when a = b = point. */
export function quadForm(m: Mat3, a: Vec3, b: Vec3): number {
  return (
    a[0] * (m[0] * b[0] + m[1] * b[1] + m[2] * b[2]) +
    a[1] * (m[3] * b[0] + m[4] * b[1] + m[5] * b[2]) +
    a[2] * (m[6] * b[0] + m[7] * b[1] + m[8] * b[2])
  );
}

export function det(m: Mat3): number {
  return (
    m[0] * (m[4] * m[8] - m[5] * m[7]) -
    m[1] * (m[3] * m[8] - m[5] * m[6]) +
    m[2] * (m[3] * m[7] - m[4] * m[6])
  );
}

/**
 * Adjugate (classical adjoint) = transpose of the cofactor matrix.
 * For a symmetric M the adjugate is symmetric too. Central to splitting a
 * degenerate conic: adj of a rank-2 line-pair conic is the (rank-1) matrix of
 * their intersection point.
 */
export function adjugate(m: Mat3): Mat3 {
  const c00 = m[4] * m[8] - m[5] * m[7];
  const c01 = m[5] * m[6] - m[3] * m[8];
  const c02 = m[3] * m[7] - m[4] * m[6];
  const c10 = m[2] * m[7] - m[1] * m[8];
  const c11 = m[0] * m[8] - m[2] * m[6];
  const c12 = m[1] * m[6] - m[0] * m[7];
  const c20 = m[1] * m[5] - m[2] * m[4];
  const c21 = m[2] * m[3] - m[0] * m[5];
  const c22 = m[0] * m[4] - m[1] * m[3];
  // adjugate = transpose of cofactor matrix
  return [c00, c10, c20, c01, c11, c21, c02, c12, c22];
}

/** trace(a · b) without forming the full product — used in det(A + λB) expansion. */
export function traceMul(a: Mat3, b: Mat3): number {
  // sum_i (a·b)_ii = sum_i sum_k a_ik b_ki
  let s = 0;
  for (let i = 0; i < 3; i++) {
    for (let k = 0; k < 3; k++) {
      s += (a[i * 3 + k] as number) * (b[k * 3 + i] as number);
    }
  }
  return s;
}

/** Cross-product matrix [v]_× such that [v]_× w = v × w. Antisymmetric. */
export function skew(v: Vec3): Mat3 {
  return [
    0, -v[2], v[1],
    v[2], 0, -v[0],
    -v[1], v[0], 0,
  ];
}

export function frobeniusNorm(m: Mat3): number {
  let s = 0;
  for (let i = 0; i < 9; i++) s += (m[i] as number) * (m[i] as number);
  return Math.sqrt(s);
}
