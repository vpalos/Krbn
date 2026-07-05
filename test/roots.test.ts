import { describe, expect, test } from "bun:test";
import { solveQuadratic, solveCubicReal } from "../src/curve/roots.js";

describe("solveQuadratic", () => {
  test("two distinct real roots, ascending", () => {
    const r = solveQuadratic(1, -3, 2); // (x-1)(x-2)
    expect(r.kind).toBe("two");
    if (r.kind === "two") {
      expect(r.x0).toBeCloseTo(1);
      expect(r.x1).toBeCloseTo(2);
    }
  });

  test("double root (tangency) reported as one", () => {
    const r = solveQuadratic(1, -2, 1); // (x-1)²
    expect(r.kind).toBe("double");
    if (r.kind === "double") expect(r.x).toBeCloseTo(1);
  });

  test("near-double root still classified as double within tolerance", () => {
    // roots at 1 ± 1e-8 → discriminant ~ 4e-16 relative to scale ~ few → double
    const eps = 1e-8;
    const r = solveQuadratic(1, -2, 1 - eps * eps);
    expect(r.kind).toBe("double");
  });

  test("no real roots returns clean 'none', never NaN", () => {
    const r = solveQuadratic(1, 0, 1); // x² + 1
    expect(r.kind).toBe("none");
  });

  test("linear fallback when a ≈ 0", () => {
    const r = solveQuadratic(0, 2, -4);
    expect(r.kind).toBe("single");
    if (r.kind === "single") expect(r.x).toBeCloseTo(2);
  });

  test("all-zero coefficients → coincident constraint", () => {
    expect(solveQuadratic(0, 0, 0).kind).toBe("all");
    expect(solveQuadratic(0, 0, 5).kind).toBe("none");
  });

  test("no catastrophic cancellation for widely separated roots", () => {
    // x² - (1e8 + 1e-8) x + 1 = 0 → roots 1e8 and 1e-8
    const b = -(1e8 + 1e-8);
    const r = solveQuadratic(1, b, 1);
    expect(r.kind).toBe("two");
    if (r.kind === "two") {
      expect(r.x0).toBeGreaterThan(0);
      // small root must retain precision (naive formula loses it to 0)
      expect(Math.abs(r.x0 - 1e-8) / 1e-8).toBeLessThan(1e-6);
      expect(Math.abs(r.x1 - 1e8) / 1e8).toBeLessThan(1e-6);
    }
  });
});

describe("solveCubicReal", () => {
  test("three distinct real roots", () => {
    // (x+3)(x)(x-2) = x³ + x² - 6x
    const roots = solveCubicReal(1, 1, -6, 0);
    expect(roots).toHaveLength(3);
    expect(roots[0]).toBeCloseTo(-3);
    expect(roots[1]).toBeCloseTo(0);
    expect(roots[2]).toBeCloseTo(2);
  });

  test("one real root (two complex)", () => {
    // x³ + x + 1 has a single real root ≈ -0.6823
    const roots = solveCubicReal(1, 0, 1, 1);
    expect(roots).toHaveLength(1);
    expect(roots[0]).toBeCloseTo(-0.6823278);
  });

  test("triple root", () => {
    // (x-2)³ = x³ - 6x² + 12x - 8
    const roots = solveCubicReal(1, -6, 12, -8);
    expect(roots.length).toBeGreaterThanOrEqual(1);
    for (const r of roots) expect(r).toBeCloseTo(2);
  });

  test("double + simple root (discriminant ≈ 0)", () => {
    // (x-1)²(x+2) = x³ - 3x + 2
    const roots = solveCubicReal(1, 0, -3, 2);
    expect(roots.length).toBeGreaterThanOrEqual(2);
    // must contain 1 (double) and -2
    const has = (v: number) => roots.some((r) => Math.abs(r - v) < 1e-6);
    expect(has(1)).toBeTruthy();
    expect(has(-2)).toBeTruthy();
  });

  test("degenerates to quadratic when leading coeff ≈ 0", () => {
    const roots = solveCubicReal(0, 1, -3, 2); // x² -3x +2
    expect(roots).toHaveLength(2);
    expect(roots[0]).toBeCloseTo(1);
    expect(roots[1]).toBeCloseTo(2);
  });

  test("every returned root actually satisfies the cubic", () => {
    const [a, b, c, d] = [2, -1, -5, 3];
    for (const r of solveCubicReal(a, b, c, d)) {
      const val = a * r * r * r + b * r * r + c * r + d;
      expect(Math.abs(val)).toBeLessThan(1e-9);
    }
  });
});
