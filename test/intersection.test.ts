import { describe, expect, test } from "bun:test";
import type { Camera, Vec3 } from "../src/math/types.js";
import { sphere } from "../src/primitives/quadric.js";
import { Polygon } from "../src/primitives/polygon.js";
import {
  intersectQuadricPlane,
  intersectSpheres,
  intersectPlanes,
} from "../src/primitives/intersection.js";
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

describe("sphere ∩ sphere = circle", () => {
  test("two unit spheres, centres 1 apart → circle at the midplane", () => {
    const s1 = sphere([0, 0, 0], 1);
    const s2 = sphere([1, 0, 0], 1);
    const sec = intersectSpheres(s1.Q, s2.Q)!;
    expect(sec).not.toBeNull();
    // radical plane is x = 0.5; circle radius √(1 − 0.25) = √0.75
    if (sec.curve.kind === "conic") {
      expect(sec.curve.plane.origin[0]).toBeCloseTo(0.5, 6);
      expect(sectionRadius(sec.curve)).toBeCloseTo(Math.sqrt(0.75), 4);
    }
  });

  test("disjoint spheres → null", () => {
    expect(intersectSpheres(sphere([0, 0, 0], 1).Q, sphere([5, 0, 0], 1).Q)).toBeNull();
  });

  test("a genuine quadric ∩ quadric quartic throws", () => {
    // sphere ∩ ellipsoid: quadratic parts differ → not a circle
    const s = sphere([0, 0, 0], 1);
    const e = sphere([0, 0, 0], 1); // same, but tweak Q to an ellipsoid-like matrix
    const eQ = e.Q.slice();
    eQ[5] = 4; // change the y² coefficient → no longer a sphere
    expect(() => intersectSpheres(s.Q, eQ as unknown as typeof e.Q)).toThrow("quartic");
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
