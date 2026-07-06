// The first analytic primitive: a quadric surface, and Sphere/Ellipsoid as
// configurations of it (ai/DESIGN.md §2.2 — "the organizing fact of the
// primitive layer"). One implementation of `FeatureSource` gives every quadric
// an exact silhouette (a conic) and closed-form ray hits.
//
// Silhouette, two exact routes:
//   • object space (extractFeatures): the contour generator is Q ∩ π, where π is
//     the polar plane of the eye. We build a frame on π and reduce Q to a 3×3
//     conic in that plane.
//   • screen space (projectedSilhouettes): the apparent outline is the conic
//     whose dual is P · adj(Q) · Pᵀ (P the 3×4 projection). Projection-model
//     agnostic; exact for ortho and perspective alike.

import type { AABB, Basis, Camera, Hit, Ray, Vec3 } from "../math/types.js";
import type { Curve2D, ConicParams } from "../curve/types.js";
import type { ElementId, Feature, HatchFamily, HatchFieldCurve, HatchFieldOptions, HatchRegion, Light } from "../pipeline/types.js";
import type { FeatureSource } from "../scene/feature-source.js";
import type { Mat4 } from "../math/mat4.js";
import type { Mat3 } from "../math/mat3.js";
import { adjugate4, mulVec4, quadricNormal, symmetric4 } from "../math/mat4.js";
import { adjugate as adjugate3 } from "../math/mat3.js";
import { basisFromNormal } from "../math/basis.js";
import { aabbFromCenterRadius, aabbCenter } from "../math/aabb.js";
import { cameraFrame, projectionMatrix, type Proj } from "../math/camera.js";
import { matrixToConic } from "../curve/conic.js";
import { add, addScaled, dot, normalize, sub } from "../math/vec3.js";
import { circleCurve, curveCount, paramCurve, screenDist } from "./hatch-field.js";
import { solveQuadratic } from "../curve/roots.js";
import { EPS_ABS } from "../curve/epsilon.js";

let autoId = 0;
const nextId = (): ElementId => `quadric-${autoId++}`;

export class Quadric implements FeatureSource {
  /** symmetric 4×4; Pᵀ Q P = 0 for homogeneous P = (x, y, z, 1). */
  readonly Q: Mat4;
  readonly id: ElementId;
  private readonly aabb: AABB;

  constructor(Q: Mat4, aabb: AABB, id: ElementId = nextId()) {
    this.Q = Q;
    this.id = id;
    this.aabb = aabb;
  }

  bounds(): AABB {
    return this.aabb;
  }

  hatchRegions(cam: Camera, light: Light): HatchRegion[] {
    // The fillable region is the (closed) apparent outline conic. Tone comes from
    // Lambert at the point of the surface facing the camera — a single-tone
    // approximation until stage-3 tone quantization refines it per patch.
    const P = projectionMatrix(cam);
    const conic = outlineScreenConic(this.Q, P);
    if (!conic || conic.kind !== "conic") return [];
    const center = aabbCenter(this.aabb);
    const nFront = normalize([cam.eye[0] - center[0], cam.eye[1] - center[1], cam.eye[2] - center[2]]);
    const diffuse = Math.max(0, dot(nFront, [-light.direction[0], -light.direction[1], -light.direction[2]]));
    const tone = Math.min(1, Math.max(0, 1 - diffuse));
    return [{ owner: this.id, outline: conic, mode: "single", angle: 0, tone }];
  }

  /** Closed-form ray–quadric intersection: substitute P(t) = O + tD into Pᵀ Q P. */
  raycast(ray: Ray): Hit[] {
    const { origin: o, dir: d } = ray;
    const Qd = mulVec4(this.Q, d[0], d[1], d[2], 0);
    const Qo = mulVec4(this.Q, o[0], o[1], o[2], 1);
    const a = d[0] * Qd[0] + d[1] * Qd[1] + d[2] * Qd[2];
    const b = 2 * (d[0] * Qo[0] + d[1] * Qo[1] + d[2] * Qo[2]);
    const c = o[0] * Qo[0] + o[1] * Qo[1] + o[2] * Qo[2] + Qo[3];

    const roots = solveQuadratic(a, b, c);
    const ts: number[] = [];
    switch (roots.kind) {
      case "two":
        ts.push(roots.x0, roots.x1);
        break;
      case "double":
        ts.push(roots.x); // grazing / tangent ray
        break;
      case "single":
        ts.push(roots.x);
        break;
      case "none":
      case "all":
        break;
    }

    return ts
      .sort((p, q) => p - q)
      .map((t): Hit => {
        const point: Vec3 = [o[0] + t * d[0], o[1] + t * d[1], o[2] + t * d[2]];
        const n = normalize(quadricNormal(this.Q, point));
        return { t, point, normal: n, frontFacing: dot(n, d) < 0 };
      });
  }

  extractFeatures(cam: Camera): Feature[] {
    const conic = this.silhouetteObjectSpace(cam);
    if (!conic) return [];
    return [
      {
        type: "silhouette",
        owner: this.id,
        curve: conic,
        attrs: {},
      },
    ];
  }

  projectedSilhouettes(cam: Camera): Curve2D[] {
    const P = projectionMatrix(cam);
    const conic = outlineScreenConic(this.Q, P);
    return conic ? [conic] : [];
  }

  // --- silhouette helpers -------------------------------------------------

  /** Polar plane of the eye: π = Q·e, e = (eye,1) for perspective, (dir,0) ortho. */
  private polarPlane(cam: Camera): [number, number, number, number] {
    if (cam.projection === "perspective") {
      return mulVec4(this.Q, cam.eye[0], cam.eye[1], cam.eye[2], 1);
    }
    const f = cameraFrame(cam).forward;
    return mulVec4(this.Q, f[0], f[1], f[2], 0);
  }

  private silhouetteObjectSpace(cam: Camera): Feature["curve"] | null {
    const pi = this.polarPlane(cam);
    const n: Vec3 = [pi[0], pi[1], pi[2]];
    const nn = n[0] * n[0] + n[1] * n[1] + n[2] * n[2];
    if (nn <= EPS_ABS) return null; // no silhouette (e.g. eye at center)

    // A point on the plane π·(x,1)=0 nearest the origin: x = -π_w/|n|² · n.
    const s = -pi[3] / nn;
    const origin: Vec3 = [n[0] * s, n[1] * s, n[2] * s];
    const plane = basisFromNormal(origin, n);
    return { kind: "conic", params: quadricPlaneConic(this.Q, plane), plane };
  }
}

/**
 * Restrict a quadric to a plane: the plane section is a conic, obtained as
 * Cin = Mpᵀ Q Mp where Mp = [ x̂ | ŷ | origin ] maps in-plane (u,v,1) to world.
 * The organizing operation behind both silhouettes (§2.2, polar plane) and
 * intersection-curve features (§2.5, an arbitrary cutting plane).
 */
export function quadricPlaneConic(Q: Mat4, plane: Basis): ConicParams {
  const cols: Array<[number, number, number, number]> = [
    [plane.x[0], plane.x[1], plane.x[2], 0],
    [plane.y[0], plane.y[1], plane.y[2], 0],
    [plane.origin[0], plane.origin[1], plane.origin[2], 1],
  ];
  const Cin = new Array<number>(9);
  for (let i = 0; i < 3; i++) {
    const qi = mulVec4(Q, cols[i]![0], cols[i]![1], cols[i]![2], cols[i]![3]);
    for (let j = 0; j < 3; j++) {
      const cj = cols[j]!;
      Cin[i * 3 + j] = qi[0] * cj[0] + qi[1] * cj[1] + qi[2] * cj[2] + qi[3] * cj[3];
    }
  }
  return matrixToConic(Cin as unknown as Mat3);
}

/** Apparent outline in screen (pixel) coordinates: dual C* = P · adj(Q) · Pᵀ. */
export function outlineScreenConic(Q: Mat4, P: Proj): Curve2D | null {
  const Qadj = adjugate4(Q);
  // T = P (3×4) · Qadj (4×4) → 3×4
  const T = new Array<number>(12).fill(0);
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 4; c++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += (P[r * 4 + k] as number) * (Qadj[k * 4 + c] as number);
      T[r * 4 + c] = sum;
    }
  // Cdual = T (3×4) · Pᵀ (4×3) → 3×3, Cdual[i][j] = Σ_k T[i][k]·P[j][k]
  const Cdual = new Array<number>(9).fill(0);
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += (T[i * 4 + k] as number) * (P[j * 4 + k] as number);
      Cdual[i * 3 + j] = sum;
    }
  // Point conic = adjugate of the dual conic.
  const C = adjugate3(Cdual as unknown as Mat3);
  const frob = Math.hypot(...(C as unknown as number[]));
  if (frob <= EPS_ABS) return null;
  return { kind: "conic", params: matrixToConic(C) };
}

// --- configurations ---------------------------------------------------------

/**
 * A sphere configuration that also carries its parametrization. The `Quadric`
 * base gives the exact conic silhouette and closed-form raycast; the explicit
 * center/radius/axis add what a bare quadric matrix cannot express — the
 * iso-parameter hatch field (parallels + meridians + a tilted third family).
 */
export class Sphere extends Quadric {
  readonly center: Vec3;
  readonly radius: number;
  /** pole axis of the (u,v) chart — parallels are circles about it */
  readonly axis: Vec3;

  constructor(center: Vec3, radius: number, id?: ElementId, axis: Vec3 = [0, 0, 1]) {
    const [cx, cy, cz] = center;
    const Q = symmetric4(
      1, 0, 0, -cx,
      1, 0, -cy,
      1, -cz,
      cx * cx + cy * cy + cz * cz - radius * radius,
    );
    super(Q, aabbFromCenterRadius(center, radius), id);
    this.center = center;
    this.radius = radius;
    this.axis = normalize(axis);
  }

  /** Exact curved direction field (§2.6): latitude parallels + pole-to-pole
   *  meridians (+ parallels about a 45°-tilted axis as the third family for
   *  `triple`). Every curve is an exact circle; the normal is radial. */
  hatchField(cam: Camera, opts: HatchFieldOptions): HatchFamily[] {
    const c = this.center;
    const r = this.radius;
    const radialN = (p: Vec3): Vec3 => sub(p, c);

    // Latitude circles about `axis`, evenly spaced in latitude; count driven by
    // the projected pole-to-pole extent.
    const parallels = (axis: Vec3): HatchFieldCurve[] => {
      const plane = basisFromNormal(c, axis);
      const span = screenDist(cam, addScaled(c, axis, r), addScaled(c, axis, -r));
      const n = curveCount(span, opts.spacingPx, 3, 40);
      const curves: HatchFieldCurve[] = [];
      for (let k = 0; k < n; k++) {
        const phi = -Math.PI / 2 + (Math.PI * (k + 0.5)) / n;
        curves.push(circleCurve(addScaled(c, axis, r * Math.sin(phi)), plane.x, plane.y, r * Math.cos(phi), radialN, 96));
      }
      return curves;
    };

    // Family 0 — parallels about the pole axis.
    const families: HatchFamily[] = [{ curves: parallels(this.axis) }];
    const plane = basisFromNormal(c, this.axis);

    if (opts.maxFamilies >= 2) {
      // Family 1 — meridians: great circles through both poles. Each circle
      // covers the meridians θ and θ+π, so the count runs over half a turn.
      const diam = screenDist(cam, addScaled(c, plane.x, r), addScaled(c, plane.x, -r));
      const nMer = curveCount((Math.PI * diam) / 2, opts.spacingPx, 2, 32);
      const meridians: HatchFieldCurve[] = [];
      for (let j = 0; j < nMer; j++) {
        const th = (Math.PI * j) / nMer;
        const m = add(addScaled([0, 0, 0], plane.x, Math.cos(th)), addScaled([0, 0, 0], plane.y, Math.sin(th)));
        meridians.push(circleCurve(c, m, this.axis, r, radialN, 96));
      }
      families.push({ curves: meridians });
    }

    if (opts.maxFamilies >= 3) {
      // Family 2 — parallels about an axis tilted 45° from the pole toward ê1:
      // the iso-curves of a rotated chart, still exact circles, crossing both
      // parallels and meridians obliquely — the diagonal `triple` band.
      families.push({ curves: parallels(normalize(add(this.axis, plane.x))) });
    }
    return families;
  }
}

/** A sphere: |p - center|² = radius². */
export function sphere(center: Vec3, radius: number, id?: ElementId): Sphere {
  return new Sphere(center, radius, id);
}

/**
 * An axis-aligned ellipsoid configuration; like `Sphere`, the explicit
 * center/radii carry the parametrization the bare quadric matrix cannot
 * express. The (θ, φ) chart's iso-curves are exact ellipses, and the outward
 * normal is the exact gradient ((x−cx)/a², (y−cy)/b², (z−cz)/c²).
 */
export class Ellipsoid extends Quadric {
  readonly center: Vec3;
  readonly radii: Vec3;

  constructor(center: Vec3, radii: Vec3, id?: ElementId) {
    const [cx, cy, cz] = center;
    const [ax, ay, az] = radii;
    const A = 1 / (ax * ax);
    const B = 1 / (ay * ay);
    const C = 1 / (az * az);
    const Q = symmetric4(
      A, 0, 0, -A * cx,
      B, 0, -B * cy,
      C, -C * cz,
      A * cx * cx + B * cy * cy + C * cz * cz - 1,
    );
    const corner = Math.max(ax, ay, az);
    super(Q, { min: [cx - corner, cy - corner, cz - corner], max: [cx + corner, cy + corner, cz + corner] }, id);
    this.center = center;
    this.radii = radii;
  }

  /** Exact curved direction field (§2.6): parallels + meridians of the (θ, φ)
   *  chart (+ its pole-to-pole diagonal spirals as the third family for
   *  `triple`). Every sample carries the exact gradient normal. */
  hatchField(cam: Camera, opts: HatchFieldOptions): HatchFamily[] {
    const [cx, cy, cz] = this.center;
    const [ax, ay, az] = this.radii;
    const at = (th: number, ph: number): { p: Vec3; n: Vec3 } => {
      const p: Vec3 = [cx + ax * Math.cos(ph) * Math.cos(th), cy + ay * Math.cos(ph) * Math.sin(th), cz + az * Math.sin(ph)];
      return { p, n: [(p[0] - cx) / (ax * ax), (p[1] - cy) / (ay * ay), (p[2] - cz) / (az * az)] };
    };

    // Family 0 — parallels (constant φ): ellipses in horizontal planes, evenly
    // spaced in latitude; count driven by the projected pole-to-pole extent.
    const span = screenDist(cam, [cx, cy, cz - az], [cx, cy, cz + az]);
    const nPar = curveCount(span, opts.spacingPx, 3, 40);
    const parallels: HatchFieldCurve[] = [];
    for (let k = 0; k < nPar; k++) {
      const ph = -Math.PI / 2 + (Math.PI * (k + 0.5)) / nPar;
      parallels.push(paramCurve((t) => at(2 * Math.PI * t, ph), 96));
    }
    const families: HatchFamily[] = [{ curves: parallels }];

    const diam = screenDist(cam, [cx - ax, cy, cz], [cx + ax, cy, cz]);
    if (opts.maxFamilies >= 2) {
      // Family 1 — meridians (constant θ): full ellipses through both poles.
      // Each loop covers θ and θ+π, so the count runs over half a turn.
      const nMer = curveCount((Math.PI * diam) / 2, opts.spacingPx, 2, 32);
      const meridians: HatchFieldCurve[] = [];
      for (let j = 0; j < nMer; j++) {
        const th = (Math.PI * j) / nMer;
        meridians.push(paramCurve((t) => at(th, 2 * Math.PI * t), 96));
      }
      families.push({ curves: meridians });
    }

    if (opts.maxFamilies >= 3) {
      // Family 2 — the chart's diagonal: pole-to-pole spirals winding once in θ
      // while φ sweeps −π/2 → π/2, crossing both other families obliquely — the
      // diagonal `triple` band.
      const nD = curveCount((Math.PI * diam) / Math.SQRT2, opts.spacingPx, 4, 48);
      const diagonal: HatchFieldCurve[] = [];
      for (let k = 0; k < nD; k++) {
        const th0 = (2 * Math.PI * k) / nD;
        diagonal.push(paramCurve((t) => at(th0 + 2 * Math.PI * t, -Math.PI / 2 + Math.PI * t), 96));
      }
      families.push({ curves: diagonal });
    }
    return families;
  }
}

/** An axis-aligned ellipsoid with the given semi-axis radii. */
export function ellipsoid(center: Vec3, radii: Vec3, id?: ElementId): Ellipsoid {
  return new Ellipsoid(center, radii, id);
}
