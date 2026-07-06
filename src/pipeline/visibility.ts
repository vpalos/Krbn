// Stage 2 — exact quantitative invisibility (ai/DESIGN.md §2.4).
//
// For each feature curve we (1) collect every screen crossing with an occluder's
// apparent contour — these are the only parameters at which visibility can
// change — then (2) decide each resulting sub-interval with a single exact depth
// test: shoot a ray from the sampled 3-D point toward the eye; if any surface
// lies strictly in front, the point is hidden. Correctness rests on closed-form
// `raycast`, and self-occlusion needs no special case — the feature's own point
// is excluded by a depth epsilon.
//
// The crossing set only has to be a *superset* of the true change points: extra
// boundaries merge away, and none are missed because each primitive's
// `projectedSilhouettes` contains its full apparent contour.

import type { Camera, Vec3 } from "../math/types.js";
import type { FeatureSource } from "../scene/feature-source.js";
import type { Feature, Stroke, VisibilityInterval } from "./types.js";
import { buildFeatureModel } from "./feature-curve.js";
import { crossScreenCurves } from "../curve/intersect2d.js";
import { cameraFrame, projectionMatrix, projectPoint } from "../math/camera.js";
import { addScaled, distance, normalize, sub } from "../math/vec3.js";
import { EPS_DEPTH_REL, EPS_NUDGE_REL, EPS_PARAM_REL } from "../curve/epsilon.js";

/** Scene diameter, for scaling the depth/parameter tolerances. */
export function sceneScale(sources: readonly FeatureSource[]): number {
  let d = 0;
  for (const s of sources) {
    const b = s.bounds();
    d = Math.max(d, distance(b.min, b.max));
  }
  return d > 0 ? d : 1;
}

/**
 * Is the world point `p` hidden by any surface in the scene? We step `p` a hair
 * *toward the viewer* (off its own surface) and cast toward the eye: an occluder
 * is any surface hit strictly between there and the eye. The nudge is what makes
 * this robust at silhouettes — a contour point is a grazing/tangent point of its
 * own view ray, whose self-hit is a near-tangent double root; nudging off the
 * surface pushes that self-hit *behind* the ray origin (t < 0, ignored) while
 * keeping the origin near `p` so the ray stays well-conditioned.
 */
export function isOccluded(
  p: Vec3,
  cam: Camera,
  sources: readonly FeatureSource[],
  scale: number,
  owner?: FeatureSource,
  ownerNudge?: number,
): boolean {
  const epsSkip = EPS_DEPTH_REL * scale;
  // Step off `p`'s own surface by the owner's self-nudge (mesh: ~edge length) so a
  // grazing faceted silhouette clears its neighbouring triangles; smooth sources
  // fall back to the tiny default. Hits from the owner nearer than this count as
  // "self"; genuine (far) self-occlusion is still caught.
  const meshNudge = ownerNudge !== undefined && ownerNudge > 0;
  const nudge = meshNudge ? ownerNudge : EPS_NUDGE_REL * scale;
  const ownerSkip = meshNudge ? Math.max(epsSkip, ownerNudge) : epsSkip;
  let toEye: Vec3;
  let tMax: number;
  if (cam.projection === "perspective") {
    toEye = normalize(sub(cam.eye, p));
    tMax = distance(cam.eye, p) - nudge;
  } else {
    const f = cameraFrame(cam).forward;
    toEye = [-f[0], -f[1], -f[2]];
    tMax = Infinity;
  }
  const ray = { origin: addScaled(p, toEye, nudge), dir: toEye };
  for (const s of sources) {
    const skip = s === owner ? ownerSkip : epsSkip;
    for (const h of s.raycast(ray)) {
      if (h.t > skip && h.t < tMax) return true;
    }
  }
  return false;
}

// Grazing/cusp scan resolution. The scan seeds tangential visibility changes
// (which produce no transversal image crossing); its spacing is held roughly
// constant in *screen pixels* so the resolution does not degrade on large
// features. A tangential hidden run thinner than ~SCAN_STEP_PX px may be missed
// — that is the documented limit of this safety-net; transversal boundaries stay
// exact via the analytic crossings in step 1a.
const SCAN_STEP_PX = 4;
const SCAN_MIN = 64;
const SCAN_MAX = 4096;
const BISECT_ITERS = 26;

/** Approximate on-screen length of a feature (for scan-resolution scaling). */
function screenLength(model: ReturnType<typeof buildFeatureModel>, cam: Camera): number {
  const P = projectionMatrix(cam);
  const N = 48;
  let len = 0;
  let prev = projectPoint(P, model.point3(model.t0)).point;
  for (let i = 1; i <= N; i++) {
    const t = model.t0 + ((model.t1 - model.t0) * i) / N;
    const cur = projectPoint(P, model.point3(t)).point;
    len += Math.hypot(cur[0] - prev[0], cur[1] - prev[1]);
    prev = cur;
  }
  return len;
}

/** Classify one feature curve into visible/hidden intervals against the scene. */
export function classifyFeature(
  feature: Feature,
  cam: Camera,
  sources: readonly FeatureSource[],
  scale = sceneScale(sources),
  owner?: FeatureSource,
): Stroke {
  const model = buildFeatureModel(feature.curve, cam);
  const span = model.t1 - model.t0;
  const epsT = EPS_PARAM_REL * (span || 1);
  const ownerNudge = owner?.selfNudge?.();
  const occ = (t: number): boolean => isOccluded(model.point3(t), cam, sources, scale, owner, ownerNudge);

  // 1a) exact analytic crossings — transversal visibility changes land here
  // precisely (a superset; extra boundaries merge away harmlessly).
  const events: number[] = [];
  for (const s of sources) {
    for (const sil of s.projectedSilhouettes(cam)) {
      for (const pt of crossScreenCurves(model.screen, sil)) {
        const t = model.paramOf(pt);
        if (t === null) continue;
        if (t > model.t0 + epsT && t < model.t1 - epsT) events.push(t);
      }
    }
  }

  // 1b) grazing/cusp safety net: a tangential contact changes visibility without
  // a transversal image crossing (hard-parts registry). Scan the occlusion
  // predicate for sign flips and bisect each to a precise boundary. Flips that
  // coincide with an analytic crossing are absorbed, keeping the exact value.
  const scanN = Math.min(SCAN_MAX, Math.max(SCAN_MIN, Math.ceil(screenLength(model, cam) / SCAN_STEP_PX)));
  const scanTol = (2 * span) / scanN;
  let prevT = model.t0;
  let prevOcc = occ(model.t0);
  for (let i = 1; i <= scanN; i++) {
    const t = model.t0 + (span * i) / scanN;
    const curOcc = occ(t);
    if (curOcc !== prevOcc) {
      const b = bisectFlip(occ, prevT, prevOcc, t);
      if (!events.some((e) => Math.abs(e - b) <= scanTol)) events.push(b);
    }
    prevT = t;
    prevOcc = curOcc;
  }

  events.sort((a, b) => a - b);

  // dedup
  const bounds: number[] = [model.t0];
  for (const e of events) if (e - bounds[bounds.length - 1]! > epsT) bounds.push(e);
  bounds.push(model.t1);

  // 2) decide each sub-interval by an exact depth test at its midpoint
  const raw: VisibilityInterval[] = [];
  for (let i = 0; i + 1 < bounds.length; i++) {
    const ta = bounds[i]!;
    const tb = bounds[i + 1]!;
    if (tb - ta <= epsT) continue;
    const visible = !isOccluded(model.point3(0.5 * (ta + tb)), cam, sources, scale, owner, ownerNudge);
    raw.push({ t0: ta, t1: tb, visible });
  }

  // merge neighbouring intervals with the same state
  const intervals: VisibilityInterval[] = [];
  for (const iv of raw) {
    const last = intervals[intervals.length - 1];
    if (last && last.visible === iv.visible) last.t1 = iv.t1;
    else intervals.push({ ...iv });
  }
  if (intervals.length === 0) {
    // No crossings and no midpoint (degenerate span): treat as a single sample.
    const visible = !isOccluded(model.point3(0.5 * (model.t0 + model.t1)), cam, sources, scale, owner, ownerNudge);
    intervals.push({ t0: model.t0, t1: model.t1, visible });
  }

  return { feature, screen: model.screen, intervals };
}

/** Bisect a bracketed occlusion flip [ta (occ=occA) .. tb] to a precise boundary. */
function bisectFlip(occ: (t: number) => boolean, ta: number, occA: boolean, tb: number): number {
  let lo = ta;
  let hi = tb;
  for (let i = 0; i < BISECT_ITERS; i++) {
    const mid = 0.5 * (lo + hi);
    if (occ(mid) === occA) lo = mid;
    else hi = mid;
  }
  return 0.5 * (lo + hi);
}

/** Run stage 2 over a whole scene: every source's features, classified against all. */
export function classifyScene(sources: readonly FeatureSource[], cam: Camera): Stroke[] {
  const scale = sceneScale(sources);
  const strokes: Stroke[] = [];
  for (const s of sources) {
    for (const feature of s.extractFeatures(cam)) {
      strokes.push(classifyFeature(feature, cam, sources, scale, s));
    }
  }
  return strokes;
}
