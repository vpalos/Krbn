// Cross-primitive consolidation (ai/DESIGN.md §2.7): merge near-collinear,
// overlapping *line* strokes — from any primitives — into one representative
// line, so coincident edges are drawn once instead of piled up. A view-dependent
// abstraction: it works in screen space, then reconstructs the merged 3-D segment
// by back-projecting its endpoints onto a representative's 3-D line, so the
// merged line can be re-classified for exact visibility downstream.
//
// Only line-on-line is consolidated (curves are left alone). Clustering is by
// screen angle + perpendicular distance; overlap/near-adjacency is required so
// distinct parallel lines (e.g. a cylinder's two rulings) never merge.

import type { Camera, Vec2, Vec3 } from "../math/types.js";
import type { ElementId, FeatureType, Stroke } from "./types.js";
import { unproject } from "../math/camera.js";
import { rayLineClosestU } from "../math/intersect3d.js";

export interface ConsolidateOptions {
  /** max angle between lines to be considered collinear (degrees) */
  angleToleranceDeg: number;
  /** max perpendicular screen distance between the lines (px) */
  distanceTolerancePx: number;
  /** bridge collinear segments separated by no more than this along the line (px) */
  gapTolerancePx: number;
}

export const DEFAULT_CONSOLIDATE: ConsolidateOptions = {
  angleToleranceDeg: 2,
  distanceTolerancePx: 1.5,
  gapTolerancePx: 2,
};

/** A merged line to be re-classified by the caller (which owns the scene). */
export interface MergedLine {
  /** sorted feature ids of the cluster's members — the minimal one anchors the
   *  merged stroke's identity across frames (temporal coherence): it survives
   *  membership churn at the cluster fringe as long as that member stays in */
  memberIds: string[];
  owner: ElementId;
  type: FeatureType;
  a: Vec3;
  b: Vec3;
}

export interface ConsolidateResult {
  /** strokes passed through unchanged (non-lines + singleton clusters) */
  singles: Stroke[];
  /** clusters of ≥2 collinear lines, reduced to merged 3-D segments */
  merged: MergedLine[];
}

interface LineItem {
  stroke: Stroke;
  a2: Vec2;
  b2: Vec2;
  dir: Vec2; // unit screen direction
  a3: Vec3;
  b3: Vec3;
  lenPx: number;
}

const sub2 = (p: Vec2, q: Vec2): Vec2 => [p[0] - q[0], p[1] - q[1]];
const dot2 = (p: Vec2, q: Vec2) => p[0] * q[0] + p[1] * q[1];
const cross2 = (p: Vec2, q: Vec2) => p[0] * q[1] - p[1] * q[0];

/**
 * Partition strokes into those left alone and clusters of collinear lines merged
 * into 3-D segments. The caller re-classifies the merged segments.
 */
export function consolidateLines(
  strokes: readonly Stroke[],
  cam: Camera,
  opts: ConsolidateOptions = DEFAULT_CONSOLIDATE,
): ConsolidateResult {
  const singles: Stroke[] = [];
  const items: LineItem[] = [];
  for (const s of strokes) {
    if (s.screen.kind === "line" && s.feature.curve.kind === "line") {
      const a2 = s.screen.a;
      const b2 = s.screen.b;
      const d = sub2(b2, a2);
      const len = Math.hypot(d[0], d[1]);
      if (len <= opts.distanceTolerancePx) {
        singles.push(s); // degenerate: too short to orient
        continue;
      }
      items.push({ stroke: s, a2, b2, dir: [d[0] / len, d[1] / len], a3: s.feature.curve.a, b3: s.feature.curve.b, lenPx: len });
    } else {
      singles.push(s);
    }
  }

  const sinTol = Math.sin((opts.angleToleranceDeg * Math.PI) / 180);
  const used = new Array<boolean>(items.length).fill(false);
  const merged: MergedLine[] = [];

  for (let i = 0; i < items.length; i++) {
    if (used[i]) continue;
    const base = items[i]!;
    const cluster: LineItem[] = [base];
    used[i] = true;
    for (let j = i + 1; j < items.length; j++) {
      if (used[j]) continue;
      const other = items[j]!;
      if (collinear(base, other, sinTol, opts.distanceTolerancePx) && overlapsAlong(cluster, other, opts.gapTolerancePx)) {
        cluster.push(other);
        used[j] = true;
      }
    }

    if (cluster.length === 1) {
      singles.push(base.stroke);
      continue;
    }

    // Merge: span the union along the base direction; reconstruct 3-D endpoints
    // by back-projecting the span onto the longest contributor's 3-D line.
    const dir = base.dir;
    const p0 = base.a2;
    let smin = Infinity;
    let smax = -Infinity;
    for (const it of cluster) {
      for (const p of [it.a2, it.b2]) {
        const s = dot2(sub2(p, p0), dir);
        if (s < smin) smin = s;
        if (s > smax) smax = s;
      }
    }
    const A2: Vec2 = [p0[0] + smin * dir[0], p0[1] + smin * dir[1]];
    const B2: Vec2 = [p0[0] + smax * dir[0], p0[1] + smax * dir[1]];
    const rep = cluster.reduce((a, b) => (b.lenPx > a.lenPx ? b : a));
    const A3 = backProject(cam, A2, rep.a3, rep.b3) ?? rep.a3;
    const B3 = backProject(cam, B2, rep.a3, rep.b3) ?? rep.b3;
    merged.push({
      owner: rep.stroke.feature.owner,
      type: rep.stroke.feature.type,
      a: A3,
      b: B3,
      memberIds: cluster.map((it) => it.stroke.feature.id).filter((id): id is string => id !== undefined).sort(),
    });
  }

  return { singles, merged };
}

function collinear(a: LineItem, b: LineItem, sinTol: number, distTol: number): boolean {
  if (Math.abs(cross2(a.dir, b.dir)) > sinTol) return false; // not parallel
  // perpendicular distance from b's start to a's line
  const perp = Math.abs(cross2(a.dir, sub2(b.a2, a.a2)));
  return perp <= distTol;
}

/** True if `other` overlaps (or is within gapTol of) the cluster's span along dir. */
function overlapsAlong(cluster: readonly LineItem[], other: LineItem, gapTol: number): boolean {
  const dir = cluster[0]!.dir;
  const p0 = cluster[0]!.a2;
  let lo = Infinity;
  let hi = -Infinity;
  for (const it of cluster) {
    for (const p of [it.a2, it.b2]) {
      const s = dot2(sub2(p, p0), dir);
      if (s < lo) lo = s;
      if (s > hi) hi = s;
    }
  }
  const s0 = dot2(sub2(other.a2, p0), dir);
  const s1 = dot2(sub2(other.b2, p0), dir);
  const olo = Math.min(s0, s1);
  const ohi = Math.max(s0, s1);
  return ohi >= lo - gapTol && olo <= hi + gapTol;
}

/** Back-project a screen point onto a 3-D line; the world point that projects there. */
function backProject(cam: Camera, pt: Vec2, a: Vec3, b: Vec3): Vec3 | null {
  const hit = rayLineClosestU(unproject(cam, pt), a, b);
  if (!hit) return null;
  const u = hit.u;
  return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
}
