import { describe, expect, test } from "bun:test";
import type { Camera, Vec3 } from "../src/math/types.js";
import { sphere } from "../src/primitives/quadric.js";
import { Polygon } from "../src/primitives/polygon.js";
import {
  intersectQuadricPlane,
  intersectQuadrics,
  intersectPlanes,
} from "../src/primitives/intersection.js";
import { ellipsoid } from "../src/primitives/quadric.js";
import { evaluateConic } from "../src/curve/conic.js";
import { Scene } from "../src/scene/scene.js";

// radius of the (circular) conic section, read back from its plane params
function sectionRadius(curve: { kind: string; params?: any }): number {
  const k = curve.params;
  // circle in plane coords: A x² + A y² + D x + E y + F = 0  → r² = (D²+E²)/(4A²) − F/A
  const cx = -k.D / (2 * k.A);
  const cy = -k.E / (2 * k.C);
  return Math.sqrt(cx * cx * (k.A / k.A) + cy * cy - k.F / k.A);
}

describe("quadric ∩ plane = conic", () => {
  test("unit sphere cut through the centre → great circle (radius 1)", () => {
    const s = sphere([0, 0, 0], 1);
    const sec = intersectQuadricPlane(s.Q, [0, 0, 0], [0, 0, 1])!;
    expect(sec).not.toBeNull();
    expect(sec.curve.kind).toBe("conic");
    if (sec.curve.kind === "conic") {
      expect(sectionRadius(sec.curve)).toBeCloseTo(1);
      // section lies in z = 0
      expect(Math.abs(sec.curve.plane.z[2])).toBeCloseTo(1);
    }
  });

  test("off-centre cut → smaller circle (radius √(1−d²))", () => {
    const s = sphere([0, 0, 0], 1);
    const sec = intersectQuadricPlane(s.Q, [0, 0, 0.6], [0, 0, 1])!; // d = 0.6
    if (sec.curve.kind === "conic") expect(sectionRadius(sec.curve)).toBeCloseTo(Math.sqrt(1 - 0.36), 4);
  });

  test("a plane that misses the sphere → null", () => {
    const s = sphere([0, 0, 0], 1);
    expect(intersectQuadricPlane(s.Q, [0, 0, 2], [0, 0, 1])).toBeNull();
  });

  test("section points actually satisfy the plane conic", () => {
    const s = sphere([1, 0, 0], 2);
    const sec = intersectQuadricPlane(s.Q, [1, 0, 0], [0, 1, 0])!;
    if (sec.curve.kind === "conic") {
      // the conic passes through its own sampled extent; check the equation at a few angles
      const { A, C, F } = sec.curve.params;
      // for a centred circle the params reduce to A(x²+y²) = −F → radius √(−F/A)
      expect(A).toBeCloseTo(C, 6);
      expect(Math.sqrt(-F / A)).toBeCloseTo(2, 4); // great circle of radius 2
    }
  });
});

describe("sphere ∩ sphere = circle (radical plane)", () => {
  test("two unit spheres, centres 1 apart → circle at the midplane", () => {
    const s1 = sphere([0, 0, 0], 1);
    const s2 = sphere([1, 0, 0], 1);
    const secs = intersectQuadrics(s1.Q, s2.Q, s1.bounds(), s2.bounds());
    expect(secs).toHaveLength(1);
    const sec = secs[0]!;
    // radical plane is x = 0.5; circle radius √(1 − 0.25) = √0.75
    if (sec.curve.kind === "conic") {
      expect(sec.curve.plane.origin[0]).toBeCloseTo(0.5, 6);
      expect(sectionRadius(sec.curve)).toBeCloseTo(Math.sqrt(0.75), 4);
    }
  });

  test("disjoint spheres → no section", () => {
    const s1 = sphere([0, 0, 0], 1);
    const s2 = sphere([5, 0, 0], 1);
    expect(intersectQuadrics(s1.Q, s2.Q, s1.bounds(), s2.bounds())).toHaveLength(0);
  });
});

describe("quadric ∩ quadric = quartic (traced)", () => {
  test("sphere ∩ ellipsoid → a closed polyline loop on both surfaces", () => {
    const s = sphere([0, 0, 0], 1);
    const e = ellipsoid([0, 0, 0], [1.6, 0.7, 1.2]);
    const secs = intersectQuadrics(s.Q, e.Q, s.bounds(), e.bounds());
    expect(secs.length).toBeGreaterThanOrEqual(1);
    const chain = secs[0]!.curve;
    expect(chain.kind).toBe("polyline");
    if (chain.kind === "polyline") {
      expect(chain.pts.length).toBeGreaterThan(8);
      // every traced point lies on BOTH quadrics
      for (const p of chain.pts) {
        expect(Math.abs(p[0] * p[0] + p[1] * p[1] + p[2] * p[2] - 1)).toBeLessThan(1e-4); // on unit sphere
        expect(Math.abs(p[0] * p[0] / (1.6 * 1.6) + p[1] * p[1] / (0.7 * 0.7) + p[2] * p[2] / (1.2 * 1.2) - 1)).toBeLessThan(1e-4);
      }
    }
  });

  test("disjoint quadrics → no section", () => {
    const s = sphere([0, 0, 0], 1);
    const e = ellipsoid([9, 0, 0], [1.6, 0.7, 1.2]);
    expect(intersectQuadrics(s.Q, e.Q, s.bounds(), e.bounds())).toHaveLength(0);
  });
});

describe("plane ∩ plane = line", () => {
  test("two orthogonal planes meet along their shared axis", () => {
    // plane z=0 (normal +z) and plane x=0 (normal +x) meet along the y-axis
    const sec = intersectPlanes([0, 0, 0], [0, 0, 1], [0, 0, 0], [1, 0, 0], 5)!;
    expect(sec.curve.kind).toBe("line");
    if (sec.curve.kind === "line") {
      const dir: Vec3 = [
        sec.curve.b[0] - sec.curve.a[0],
        sec.curve.b[1] - sec.curve.a[1],
        sec.curve.b[2] - sec.curve.a[2],
      ];
      // direction is ±y
      expect(Math.abs(dir[1])).toBeGreaterThan(0);
      expect(Math.abs(dir[0])).toBeCloseTo(0, 6);
      expect(Math.abs(dir[2])).toBeCloseTo(0, 6);
    }
  });

  test("parallel planes → null", () => {
    expect(intersectPlanes([0, 0, 0], [0, 0, 1], [0, 0, 1], [0, 0, 1], 5)).toBeNull();
  });
});

describe("scene.intersect integration", () => {
  const cam: Camera = {
    eye: [0, 0, 10],
    target: [0, 0, 0],
    up: [0, 1, 0],
    projection: "orthographic",
    scale: 0.01,
    viewport: { width: 400, height: 400 },
  };

  test("adds an intersection feature that renders", () => {
    const scene = new Scene();
    const s = scene.add(sphere([0, 0, 0], 1));
    const p = scene.add(
      new Polygon([
        [-2, -2, 0],
        [2, -2, 0],
        [2, 2, 0],
        [-2, 2, 0],
      ]),
    );
    const waterline = scene.intersect(s, p, { emphasis: "bold" });
    const feats = waterline.source.extractFeatures(cam);
    expect(feats).toHaveLength(1);
    expect(feats[0]!.type).toBe("intersection");
    // the bold emphasis is on the element's resolved style
    expect(scene.resolveSpec(waterline.id).weight).toBe(2.6);
    // and it makes it into the render
    const res = scene.render(cam);
    expect(res.strokes.some((st) => st.feature.type === "intersection")).toBe(true);
  });
});
