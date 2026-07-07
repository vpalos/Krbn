// Stage 2 — exact quantitative invisibility (docs/DESIGN.md §2.4, §3.3.6).
//
// For each feature curve we (1) collect every screen crossing with an occluder's
// apparent contour — these are the only parameters at which visibility can
// change — then (2) decide each resulting sub-interval with an exact depth-buffer
// test (`isOccluded`): cast the primary ray from the eye through the sampled
// point's pixel and check whether any surface is hit strictly nearer than the
// point. Correctness rests on closed-form `raycast`; self-occlusion needs no
// special case — the point's own surface registers at its own depth. (Faceted
// meshes keep one small depth tolerance, declared per source; see `isOccluded`.)
//
// The crossing set only has to be a *superset* of the true change points: extra
// boundaries merge away, and none are missed because each primitive's
// `projectedSilhouettes` contains its full apparent contour.

import type { Camera, Vec3 } from "../math/types.js";
import type { FeatureSource } from "../scene/feature-source.js";
import type { Feature, Stroke, VisibilityInterval } from "./types.js";
import { buildFeatureModel } from "./feature-curve.js";
import { assignDefaultFeatureIds } from "./identity.js";
import { crossScreenCurves } from "../curve/intersect2d.js";
import { projectionMatrix, projectPoint, unproject } from "../math/camera.js";
import { distance } from "../math/vec3.js";
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
 * Is the world point `p` hidden by any surface in the scene? An exact depth-buffer
 * test (docs/DESIGN.md §3.3.6): cast the *primary* ray — from the eye through `p`'s
 * pixel — and ask whether any surface is hit strictly nearer than `p`. `p`'s own
 * surface registers at its own depth (`t ≈ dp`) and so never self-occludes; a
 * genuinely nearer surface — the front of a fold, or another object — is caught by
 * an exact `t < dp` comparison. No ray-nudge heuristic.
 *
 * A source's own hits near the point are "self" and don't occlude it: excluded up
 * to a per-owner depth tolerance. Smooth analytic surfaces still need a small floor
 * (`EPS_NUDGE_REL·scale`) because a raycast's grazing tangent root at a silhouette
 * is only good to ~that precision (a torus is a quartic); a *faceted* mesh declares
 * a larger one (`selfNudge`, ≈ its edge length) since a silhouette point on one
 * triangle can be a chord-sagitta nearer than the next facet. Occlusion by *other*
 * sources is compared exactly.
 */
export function isOccluded(
  p: Vec3,
  cam: Camera,
  sources: readonly FeatureSource[],
  scale: number,
  owner?: FeatureSource,
  ownerTol?: number,
): boolean {
  const sp = projectPoint(projectionMatrix(cam), p).point;
  const eyeRay = unproject(cam, sp); // eye → p's pixel (unit dir, so t is world distance)
  const dir = eyeRay.dir;
  const dpEye = (p[0] - eyeRay.origin[0]) * dir[0] + (p[1] - eyeRay.origin[1]) * dir[1] + (p[2] - eyeRay.origin[2]) * dir[2];

  // Advance the ray origin to just before the scene's bounding sphere so the
  // per-source raycasts stay well-conditioned (analytic quartics lose roots from a
  // far origin). Depths are compared in this shifted frame.
  const { center, radius } = sceneSphere(sources);
  const toC = (center[0] - eyeRay.origin[0]) * dir[0] + (center[1] - eyeRay.origin[1]) * dir[1] + (center[2] - eyeRay.origin[2]) * dir[2];
  const advance = Math.max(0, toC - radius);
  const origin: Vec3 = [eyeRay.origin[0] + dir[0] * advance, eyeRay.origin[1] + dir[1] * advance, eyeRay.origin[2] + dir[2] * advance];
  const ray = { origin, dir };
  const dp = dpEye - advance;

  const baseTol = EPS_DEPTH_REL * scale;
  // the owner's own hits are "self" up to a floor that absorbs its raycast's
  // grazing-tangent precision, widened to the mesh facet scale when it declares one
  const selfTol = Math.max(EPS_NUDGE_REL * scale, ownerTol ?? 0);
  for (const s of sources) {
    const dFront = dp - (s === owner ? selfTol : baseTol);
    for (const h of s.raycast(ray)) {
      if (h.t > baseTol && h.t < dFront) return true; // a surface strictly in front of `p`
    }
  }
  return false;
}

/** Bounding sphere of the scene (from the sources' AABBs), for conditioning the
 *  occlusion ray. */
function sceneSphere(sources: readonly FeatureSource[]): { center: Vec3; radius: number } {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const s of sources) {
    const b = s.bounds();
    minX = Math.min(minX, b.min[0]);
    minY = Math.min(minY, b.min[1]);
    minZ = Math.min(minZ, b.min[2]);
    maxX = Math.max(maxX, b.max[0]);
    maxY = Math.max(maxY, b.max[1]);
    maxZ = Math.max(maxZ, b.max[2]);
  }
  if (!(maxX >= minX)) return { center: [0, 0, 0], radius: 1 };
  const center: Vec3 = [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2];
  const radius = 0.5 * Math.hypot(maxX - minX, maxY - minY, maxZ - minZ);
  return { center, radius };
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
  const ownerTol = owner?.selfNudge?.();
  const occ = (t: number): boolean => isOccluded(model.point3(t), cam, sources, scale, owner, ownerTol);

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
    const visible = !isOccluded(model.point3(0.5 * (ta + tb)), cam, sources, scale, owner, ownerTol);
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
    const visible = !isOccluded(model.point3(0.5 * (model.t0 + model.t1)), cam, sources, scale, owner, ownerTol);
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

/**
 * Run stage 2 over a whole scene: every source's features, classified against all.
 *
 * `reconcile` is the temporal-coherence seam (docs/DESIGN.md §3.3.7): it sees the
 * complete feature list for this frame *after* id assignment and *before*
 * classification, and may mutate features in place — remap `id`s to persistent
 * identities, reverse a chain's polyline to match last frame's direction. It runs
 * here (not on strokes) because a direction fix is a cheap array reversal before
 * visibility, but an interval-flipping surgery after.
 */
export function classifyScene(
  sources: readonly FeatureSource[],
  cam: Camera,
  reconcile?: (features: Feature[]) => void,
): Stroke[] {
  const scale = sceneScale(sources);
  const perSource = sources.map((s) => assignDefaultFeatureIds(s.extractFeatures(cam)));
  reconcile?.(perSource.flat());
  const strokes: Stroke[] = [];
  sources.forEach((s, i) => {
    for (const feature of perSource[i]!) strokes.push(classifyFeature(feature, cam, sources, scale, s));
  });
  return strokes;
}
