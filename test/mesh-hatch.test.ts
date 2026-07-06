import { describe, expect, test } from "bun:test";
import { HalfEdgeMesh } from "../src/mesh/halfedge.js";
import { computeCurvature } from "../src/mesh/curvature.js";
import { meshHatchField } from "../src/mesh/mesh-hatch.js";
import { torusMesh, uvSphere } from "../src/mesh/shapes.js";

describe("mesh hatch field (curvature streamlines)", () => {
  test("a sphere is isotropic (umbilic everywhere) ⇒ no curvature field", () => {
    const m = HalfEdgeMesh.build(uvSphere(2, 40, 28));
    const curv = computeCurvature(m);
    expect(meshHatchField(m, curv, { spacing: 0.3, family: 0 })).toHaveLength(0);
    expect(meshHatchField(m, curv, { spacing: 0.3, family: 1 })).toHaveLength(0);
  });

  test("a torus yields streamlines that lie on the surface and run tangent to it", () => {
    const R = 1.4;
    const r = 0.55;
    const m = HalfEdgeMesh.build(torusMesh(R, r, 64, 32));
    const curv = computeCurvature(m);
    const curves = meshHatchField(m, curv, { spacing: 0.18, family: 0 });
    expect(curves.length).toBeGreaterThan(10);

    const onTorus = (p: readonly number[]) => (Math.hypot(p[0]!, p[1]!) - R) ** 2 + p[2]! ** 2 - r * r;
    let checked = 0;
    for (const c of curves) {
      for (const s of c.samples) {
        expect(Math.abs(onTorus(s.p))).toBeLessThan(0.02); // on the tube (chord slack)
        expect(Math.hypot(s.n[0], s.n[1], s.n[2])).toBeCloseTo(1, 6);
      }
      // consecutive samples step tangent to the surface: (p1−p0) ⟂ n
      for (let i = 1; i < c.samples.length; i++) {
        const a = c.samples[i - 1]!;
        const b = c.samples[i]!;
        const dx = b.p[0] - a.p[0];
        const dy = b.p[1] - a.p[1];
        const dz = b.p[2] - a.p[2];
        const dl = Math.hypot(dx, dy, dz);
        if (dl < 1e-9) continue;
        const cosang = (dx * a.n[0] + dy * a.n[1] + dz * a.n[2]) / dl;
        expect(Math.abs(cosang)).toBeLessThan(0.2); // nearly tangent
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(50);
  });

  test("family 1 (min-curvature direction) also produces streamlines, deterministically", () => {
    const m = HalfEdgeMesh.build(torusMesh(1.4, 0.55, 64, 32));
    const curv = computeCurvature(m);
    const a = meshHatchField(m, curv, { spacing: 0.2, family: 1 });
    const b = meshHatchField(m, curv, { spacing: 0.2, family: 1 });
    expect(a.length).toBeGreaterThan(0);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
