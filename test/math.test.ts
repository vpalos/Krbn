import { describe, expect, test } from "bun:test";
import { cross, dot, normalize, length, anyPerpendicular } from "../src/math/vec3.js";
import { adjugate, det, mulM, mulVec, skew, symmetric, traceMul, IDENTITY3 } from "../src/math/mat3.js";
import type { Mat3 } from "../src/math/mat3.js";

describe("vec3", () => {
  test("cross product is orthogonal to both inputs", () => {
    const a = [1, 2, 3] as const;
    const b = [-2, 0, 5] as const;
    const c = cross(a, b);
    expect(Math.abs(dot(a, c))).toBeLessThan(1e-12);
    expect(Math.abs(dot(b, c))).toBeLessThan(1e-12);
  });

  test("normalize yields unit length", () => {
    expect(length(normalize([3, 4, 12]))).toBeCloseTo(1);
  });

  test("normalize leaves zero vector unchanged (no NaN)", () => {
    expect(normalize([0, 0, 0])).toEqual([0, 0, 0]);
  });

  test("anyPerpendicular is unit and orthogonal", () => {
    for (const v of [[0, 0, 1], [1, 0, 0], [1, 1, 1], [0.001, 0, 5]] as const) {
      const p = anyPerpendicular(v);
      expect(length(p)).toBeCloseTo(1);
      expect(Math.abs(dot(p, v))).toBeLessThan(1e-9);
    }
  });
});

describe("mat3", () => {
  test("adjugate · M = det(M) · I", () => {
    const M: Mat3 = [2, -1, 0, 1, 3, 1, 0, 2, 4];
    const d = det(M);
    const prod = mulM(adjugate(M), M);
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++)
        expect(prod[i * 3 + j] as number).toBeCloseTo(i === j ? d : 0);
  });

  test("skew(v) · w == v × w", () => {
    const v = [1, -2, 3] as const;
    const w = [4, 5, -6] as const;
    const viaMat = mulVec(skew(v), w);
    const viaCross = cross(v, w);
    expect(viaMat[0]).toBeCloseTo(viaCross[0]);
    expect(viaMat[1]).toBeCloseTo(viaCross[1]);
    expect(viaMat[2]).toBeCloseTo(viaCross[2]);
  });

  test("traceMul(A,B) equals trace of A·B", () => {
    const A: Mat3 = [1, 2, 3, 4, 5, 6, 7, 8, 10];
    const B: Mat3 = [-1, 0, 2, 3, 1, 0, 4, -2, 1];
    const prod = mulM(A, B);
    const tr = (prod[0] as number) + (prod[4] as number) + (prod[8] as number);
    expect(traceMul(A, B)).toBeCloseTo(tr);
  });

  test("symmetric builder mirrors the upper triangle", () => {
    const M = symmetric(1, 2, 3, 4, 5, 6);
    expect(M[1]).toBe(M[3]);
    expect(M[2]).toBe(M[6]);
    expect(M[5]).toBe(M[7]);
  });

  test("det(I) = 1", () => {
    expect(det(IDENTITY3)).toBeCloseTo(1);
  });
});
