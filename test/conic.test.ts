import { describe, expect, test } from "bun:test";
import type { Mat3 } from "../src/math/mat3.js";
import { adjugate, det, mulM, scaleM, transpose } from "../src/math/mat3.js";
import type { ConicParams } from "../src/curve/types.js";
import {
  circle,
  ellipseAxisAligned,
  conicToMatrix,
  matrixToConic,
  evaluateConic,
  intersectLineConic,
  intersectConicConic,
  splitDegenerateConic,
  type Line2,
} from "../src/curve/conic.js";

const lineThrough = (p: readonly [number, number], q: readonly [number, number]): Line2 => ({
  point: [p[0], p[1]],
  dir: [q[0] - p[0], q[1] - p[1]],
});

// build a line-pair conic matrix M = ℓ mᵀ + m ℓᵀ from two homogeneous lines
function linePairMatrix(l: readonly number[], m: readonly number[]): Mat3 {
  const M: number[] = new Array(9).fill(0);
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      M[i * 3 + j] = (l[i] as number) * (m[j] as number) + (m[i] as number) * (l[j] as number);
  return M as unknown as Mat3;
}

const homLineMatches = (got: { a: number; b: number; c: number }, want: readonly number[]) => {
  // proportional (cross product of homogeneous 3-vectors ≈ 0)
  const g = [got.a, got.b, got.c];
  const cx = g[1]! * want[2]! - g[2]! * want[1]!;
  const cy = g[2]! * want[0]! - g[0]! * want[2]!;
  const cz = g[0]! * want[1]! - g[1]! * want[0]!;
  const mag = Math.hypot(cx, cy, cz);
  const scale = Math.hypot(...g) * Math.hypot(...(want as number[]));
  return mag <= 1e-9 * (scale || 1);
};

describe("line–conic intersection", () => {
  const unit = circle(0, 0, 1);

  test("secant line: two crossings", () => {
    const res = intersectLineConic(lineThrough([-2, 0], [2, 0]), unit);
    expect(res.kind).toBe("two");
    if (res.kind === "two") {
      const xs = res.hits.map((h) => h.point[0]).sort((a, b) => a - b);
      expect(xs[0]).toBeCloseTo(-1);
      expect(xs[1]).toBeCloseTo(1);
      // returned points lie exactly on the conic
      for (const h of res.hits) expect(Math.abs(evaluateConic(unit, h.point[0], h.point[1]))).toBeLessThan(1e-12);
      // parameter t reproduces the point
      for (const h of res.hits) {
        expect(h.point[0]).toBeCloseTo(-2 + h.t * 4);
      }
    }
  });

  test("tangent line: clean double root, one point", () => {
    const res = intersectLineConic(lineThrough([-2, 1], [2, 1]), unit); // y = 1
    expect(res.kind).toBe("tangent");
    if (res.kind === "tangent") {
      expect(res.hit.point[0]).toBeCloseTo(0);
      expect(res.hit.point[1]).toBeCloseTo(1);
    }
  });

  test("missing line: none (no NaN)", () => {
    const res = intersectLineConic(lineThrough([-2, 2], [2, 2]), unit); // y = 2
    expect(res.kind).toBe("none");
  });

  test("near-tangent line still resolves (ill-conditioned)", () => {
    // y = 1 - 1e-10 : two extremely close real roots near (0,1)
    const res = intersectLineConic(lineThrough([-2, 1 - 1e-10], [2, 1 - 1e-10]), unit);
    expect(res.kind === "tangent" || res.kind === "two").toBeTruthy();
  });

  test("works on an axis-aligned ellipse", () => {
    const e = ellipseAxisAligned(0, 0, 2, 1); // x²/4 + y² = 1
    const res = intersectLineConic(lineThrough([-3, 0], [3, 0]), e); // y=0 → x=±2
    expect(res.kind).toBe("two");
    if (res.kind === "two") {
      const xs = res.hits.map((h) => h.point[0]).sort((a, b) => a - b);
      expect(xs[0]).toBeCloseTo(-2);
      expect(xs[1]).toBeCloseTo(2);
    }
  });
});

describe("splitDegenerateConic (the core factorization)", () => {
  test("axis pair xy=0 → lines x=0 and y=0", () => {
    const M = linePairMatrix([1, 0, 0], [0, 1, 0]);
    const s = splitDegenerateConic(M);
    expect(s.kind).toBe("lines");
    if (s.kind === "lines") {
      expect(s.lines.length).toBe(2);
      const okX = s.lines.some((l) => homLineMatches(l, [1, 0, 0]));
      const okY = s.lines.some((l) => homLineMatches(l, [0, 1, 0]));
      expect(okX && okY).toBeTruthy();
    }
  });

  test("two general lines are recovered up to scale/order", () => {
    const L = [1, 2, -3];
    const M2 = [2, -1, 1];
    const S = splitDegenerateConic(linePairMatrix(L, M2));
    expect(S.kind).toBe("lines");
    if (S.kind === "lines") {
      expect(S.lines.length).toBe(2);
      const a = S.lines.some((l) => homLineMatches(l, L));
      const b = S.lines.some((l) => homLineMatches(l, M2));
      expect(a && b).toBeTruthy();
    }
  });

  test("two near-parallel lines still split into two", () => {
    const L = [1, 0.0001, -1];
    const M2 = [1, -0.0001, 1];
    const S = splitDegenerateConic(linePairMatrix(L, M2));
    expect(S.kind).toBe("lines");
    if (S.kind === "lines") expect(S.lines.length).toBe(2);
  });

  test("doubled line M = ℓℓᵀ → a single line", () => {
    const L = [1, -1, 2];
    const M = linePairMatrix(L, L); // = 2 ℓℓᵀ
    const S = splitDegenerateConic(M);
    expect(S.kind).toBe("lines");
    if (S.kind === "lines") {
      expect(S.lines.length).toBe(1);
      expect(homLineMatches(S.lines[0]!, L)).toBeTruthy();
    }
  });

  test("imaginary pair x²+y²=0 → isolated real point at origin", () => {
    const S = splitDegenerateConic([1, 0, 0, 0, 1, 0, 0, 0, 0]);
    expect(S.kind).toBe("point");
    if (S.kind === "point") {
      expect(S.p[0]).toBeCloseTo(0);
      expect(S.p[1]).toBeCloseTo(0);
    }
  });
});

describe("conic–conic intersection", () => {
  test("two circles crossing at two points", () => {
    const a = circle(0, 0, 1);
    const b = circle(1.5, 0, 1);
    const res = intersectConicConic(a, b);
    expect(res.kind).toBe("points");
    if (res.kind === "points") {
      expect(res.points.length).toBe(2);
      for (const p of res.points) {
        expect(p.point[0]).toBeCloseTo(0.75);
        expect(Math.abs(p.point[1])).toBeCloseTo(Math.sqrt(1 - 0.5625));
        expect(p.tangent).toBe(false);
      }
    }
  });

  test("externally tangent circles → single tangent point", () => {
    const a = circle(0, 0, 1);
    const b = circle(2, 0, 1); // touch at (1,0)
    const res = intersectConicConic(a, b);
    expect(res.kind).toBe("points");
    if (res.kind === "points") {
      expect(res.points.length).toBe(1);
      expect(res.points[0]!.point[0]).toBeCloseTo(1);
      expect(res.points[0]!.point[1]).toBeCloseTo(0);
      expect(res.points[0]!.tangent).toBe(true);
    }
  });

  test("concentric circles: no real intersection (clean)", () => {
    expect(intersectConicConic(circle(0, 0, 1), circle(0, 0, 2)).kind).toBe("none");
  });

  test("nested non-concentric circles: no intersection", () => {
    expect(intersectConicConic(circle(0, 0, 1), circle(0.5, 0, 0.2)).kind).toBe("none");
  });

  test("identical conics report coincident", () => {
    expect(intersectConicConic(circle(1, 2, 3), circle(1, 2, 3)).kind).toBe("coincident");
    // also proportional-but-scaled matrices
    const k = circle(0, 0, 1);
    const scaled: ConicParams = { A: 5, B: 0, C: 5, D: 0, E: 0, F: -5 };
    expect(intersectConicConic(k, scaled).kind).toBe("coincident");
  });

  test("circle ∩ ellipse at four points", () => {
    const c = circle(0, 0, 1);
    const e = ellipseAxisAligned(0, 0, Math.SQRT2, Math.sqrt(0.5)); // x²/2 + 2y² = 1
    const res = intersectConicConic(c, e);
    expect(res.kind).toBe("points");
    if (res.kind === "points") {
      expect(res.points.length).toBe(4);
      for (const p of res.points) {
        expect(Math.abs(p.point[0])).toBeCloseTo(Math.sqrt(2 / 3));
        expect(Math.abs(p.point[1])).toBeCloseTo(Math.sqrt(1 / 3));
        // lies on both curves
        expect(Math.abs(evaluateConic(c, p.point[0], p.point[1]))).toBeLessThan(1e-9);
        expect(Math.abs(evaluateConic(e, p.point[0], p.point[1]))).toBeLessThan(1e-9);
      }
    }
  });

  test("degenerate input conic (xy=0) ∩ circle → 4 axis points", () => {
    const cross: ConicParams = { A: 0, B: 1, C: 0, D: 0, E: 0, F: 0 }; // xy = 0
    const res = intersectConicConic(cross, circle(0, 0, 1));
    expect(res.kind).toBe("points");
    if (res.kind === "points") {
      expect(res.points.length).toBe(4);
      for (const p of res.points) {
        expect(Math.abs(evaluateConic(circle(0, 0, 1), p.point[0], p.point[1]))).toBeLessThan(1e-9);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Property: invariance of intersection under a 2D rigid transform of the scene.
// ---------------------------------------------------------------------------

function rigid(theta: number, tx: number, ty: number): Mat3 {
  const c = Math.cos(theta), s = Math.sin(theta);
  return [c, -s, tx, s, c, ty, 0, 0, 1];
}
function inverseMat3(m: Mat3): Mat3 {
  const d = det(m);
  return scaleM(adjugate(m), 1 / d);
}
function transformConic(k: ConicParams, T: Mat3): ConicParams {
  const Minv = inverseMat3(T);
  const M2 = mulM(transpose(Minv), mulM(conicToMatrix(k), Minv));
  return matrixToConic(M2);
}
function apply(T: Mat3, p: readonly [number, number]): [number, number] {
  return [
    (T[0] as number) * p[0] + (T[1] as number) * p[1] + (T[2] as number),
    (T[3] as number) * p[0] + (T[4] as number) * p[1] + (T[5] as number),
  ];
}

describe("rigid-transform invariance (property)", () => {
  test("intersection points transform with the scene", () => {
    const a = circle(0, 0, 1);
    const b = circle(1.5, 0.3, 1.1);
    const base = intersectConicConic(a, b);
    expect(base.kind).toBe("points");
    if (base.kind !== "points") return;

    const T = rigid(0.7, 3, -2);
    const at = transformConic(a, T);
    const bt = transformConic(b, T);
    const moved = intersectConicConic(at, bt);
    expect(moved.kind).toBe("points");
    if (moved.kind !== "points") return;

    expect(moved.points.length).toBe(base.points.length);
    // each transformed base point must appear in the moved result
    for (const p of base.points) {
      const tp = apply(T, p.point);
      const found = moved.points.some(
        (q) => Math.hypot(q.point[0] - tp[0], q.point[1] - tp[1]) < 1e-7,
      );
      expect(found).toBeTruthy();
    }
  });
});
