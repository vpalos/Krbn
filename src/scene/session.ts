// Temporal coherence, steps 2–3: the frame session and frame-to-frame
// correspondence (ai/DESIGN.md §3.3.7, §4; ai/ROADMAP.md Phase-2 item 6).
//
// The per-frame pipeline stays a pure function of the camera; *all* cross-frame
// state lives here. A `FrameSession` wraps a `Scene` and, each frame, reconciles
// the freshly extracted features against its tracks:
//
// 1. **Anchor continuity** — a feature whose id matches a live track's anchor is
//    the same stroke. This alone covers everything view-independent (creases,
//    boundaries, analytic `${owner}/${type}:${n}` fallbacks) and every mesh
//    contour whose anchor edge stayed crossed.
// 2. **Geometric matching** — leftover polyline chains (a mesh silhouette whose
//    minimal crossed edge churned) are matched to leftover tracks of the same
//    (owner, type) by centroid proximity, gated by chain extent.
// 3. **Persistent ids** — matched features have their `id` rewritten to the
//    track's session-lifetime persistent id (`${owner}/${type}#${n}`), so every
//    downstream consumer that keys on `Feature.id` is coherent for free.
// 4. **Orientation reconciliation** — a matched chain that runs opposite to last
//    frame's (a topological event or a tiny grazing loop defeating the intrinsic
//    vote in `zeroSetChains`) is reversed in place, *before* visibility — a
//    cheap array reversal instead of interval surgery.
//
// Correspondence is greedy nearest-centroid: frames in a sequence are adjacent,
// so real matches are near and unambiguous; at a split the larger fragment stays
// closer to the parent centroid and keeps the id, the shard is born fresh.

import type { Camera, Vec3 } from "../math/types.js";
import type { Feature, FeatureId, FeatureType } from "../pipeline/types.js";
import type { RenderResult } from "../pipeline/render.js";
import type { Scene } from "./scene.js";

/** A session-lifetime stroke identity (`${owner}/${type}#${n}`). */
export type PersistentId = string;

/** What one frame's reconciliation decided. */
export interface FrameCoherence {
  /** 0-based frame index within the session */
  frame: number;
  /** this frame's extraction id (anchor) → persistent id */
  ids: Map<FeatureId, PersistentId>;
  /** persistent ids first seen this frame */
  born: PersistentId[];
  /** persistent ids alive last frame, gone this frame */
  died: PersistentId[];
  /** persistent ids whose chain was reversed to match last frame's direction */
  reversed: PersistentId[];
}

export type FrameRenderResult = RenderResult & { coherence: FrameCoherence };

/** How far a chain's centroid may drift between adjacent frames and still be the
 *  same stroke, as a fraction of the larger chain extent. Generous — a real match
 *  in an adjacent frame is far inside this; a different loop of the same mesh is
 *  normally far outside it. */
const GATE_EXTENT_FACTOR = 0.75;

/** Track snapshots keep at most this many points (direction probes only need the
 *  sign of a tangent dot, so a coarse polyline is plenty). */
const TRACK_MAX_PTS = 64;

interface Track {
  pid: PersistentId;
  owner: string;
  type: FeatureType;
  /** the feature id (anchor) this track carried last frame */
  anchor: FeatureId;
  centroid: Vec3;
  /** AABB diagonal of the chain — the gate scale */
  extent: number;
  /** decimated polyline snapshot; null for non-polyline (analytic) features */
  pts: Vec3[] | null;
  lastSeen: number;
}

const polylineOf = (f: Feature): Vec3[] | null => (f.curve.kind === "polyline" ? (f.curve.pts as Vec3[]) : null);

function summarize(pts: Vec3[]): { centroid: Vec3; extent: number } {
  const c = [0, 0, 0];
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const p of pts) {
    for (let k = 0; k < 3; k++) {
      c[k]! += p[k]! / pts.length;
      if (p[k]! < min[k]!) min[k] = p[k]!;
      if (p[k]! > max[k]!) max[k] = p[k]!;
    }
  }
  return { centroid: [c[0]!, c[1]!, c[2]!], extent: Math.hypot(max[0]! - min[0]!, max[1]! - min[1]!, max[2]! - min[2]!) };
}

const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

function decimate(pts: Vec3[]): Vec3[] {
  if (pts.length <= TRACK_MAX_PTS) return pts.slice();
  const out: Vec3[] = [];
  const step = (pts.length - 1) / (TRACK_MAX_PTS - 1);
  for (let i = 0; i < TRACK_MAX_PTS; i++) out.push(pts[Math.round(i * step)]!);
  return out;
}

/** Reversal triggers only on *confident* opposition. The per-frame intrinsic
 *  orientation (`zeroSetChains`) is already stable away from topological events,
 *  so an ambiguous comparison (a split's pinch region, a wiggly loop probed near
 *  a fold) must default to "leave it" — a wrong reversal would oscillate. */
const OPPOSED_CONFIDENCE = 0.25;

/** Do `a` and `b` (the same contour in adjacent frames, possibly with different
 *  start points) run in opposite directions? A global vote: many probe points of
 *  `a`, each contributing the dot of *unit* tangents against the nearest point
 *  of `b`, weighted by proximity relative to the chain extent (a probe that
 *  landed on a different fold of the contour counts for little). Start-offset-
 *  proof, so a closed loop whose anchor (and hence start) churned still compares
 *  correctly. */
function opposed(a: Vec3[], b: Vec3[], extent: number): boolean {
  if (a.length < 3 || b.length < 3) return false;
  const reach = Math.max(extent, 1e-12) * 0.05; // proximity scale for the weights
  let score = 0;
  let weight = 0;
  const nProbes = Math.min(32, a.length - 2);
  for (let s = 1; s <= nProbes; s++) {
    const i = Math.min(Math.max(Math.round((s * (a.length - 1)) / (nProbes + 1)), 1), a.length - 2);
    let j = 0;
    let best = Infinity;
    for (let k = 0; k < b.length; k++) {
      const dd = dist(b[k]!, a[i]!);
      if (dd < best) {
        best = dd;
        j = k;
      }
    }
    const jn = Math.min(j + 1, b.length - 1);
    const jp = Math.max(j - 1, 0);
    let dp = 0;
    let la = 0;
    let lb = 0;
    for (let k = 0; k < 3; k++) {
      const ta = a[i + 1]![k]! - a[i - 1]![k]!;
      const tb = b[jn]![k]! - b[jp]![k]!;
      dp += ta * tb;
      la += ta * ta;
      lb += tb * tb;
    }
    if (la === 0 || lb === 0) continue;
    const w = 1 / (1 + best / reach);
    score += (w * dp) / Math.sqrt(la * lb);
    weight += w;
  }
  return weight > 0 && score / weight < -OPPOSED_CONFIDENCE;
}

export class FrameSession {
  private frame = 0;
  private tracks = new Map<PersistentId, Track>();
  private byAnchor = new Map<FeatureId, Track>();
  private counters = new Map<string, number>();

  constructor(readonly scene: Scene) {}

  /** Render one frame of the sequence; identical to `scene.render` plus the
   *  coherence report, with every stroke's `feature.id` rewritten to its
   *  persistent id. */
  render(cam: Camera): FrameRenderResult {
    let coherence: FrameCoherence | undefined;
    const res = this.scene.render(cam, { reconcileFeatures: (features) => (coherence = this.reconcile(features)) });
    // a scene with no sources never calls the hook
    coherence ??= this.reconcile([]);
    return { ...res, coherence };
  }

  /** The correspondence pass (exported for the pipeline via `Scene.render`'s
   *  `reconcileFeatures`; public so tests can drive it with synthetic frames). */
  reconcile(features: Feature[]): FrameCoherence {
    const frame = this.frame++;
    const ids = new Map<FeatureId, PersistentId>();
    const born: PersistentId[] = [];
    const reversed: PersistentId[] = [];
    const matched = new Map<Feature, Track>();
    const claimed = new Set<PersistentId>();

    // pass 1: anchor continuity
    for (const f of features) {
      const t = this.byAnchor.get(f.id!);
      if (t && !claimed.has(t.pid) && t.owner === f.owner && t.type === f.type) {
        matched.set(f, t);
        claimed.add(t.pid);
      }
    }

    // pass 2: geometric matching for leftover polyline chains, greedy by distance
    const leftoverFeatures = features.filter((f) => !matched.has(f) && polylineOf(f));
    const leftoverTracks = [...this.tracks.values()].filter((t) => !claimed.has(t.pid) && t.pts);
    const candidates: Array<{ f: Feature; t: Track; d: number }> = [];
    for (const f of leftoverFeatures) {
      const { centroid, extent } = summarize(polylineOf(f)!);
      for (const t of leftoverTracks) {
        if (t.owner !== f.owner || t.type !== f.type) continue;
        const d = dist(centroid, t.centroid);
        if (d <= GATE_EXTENT_FACTOR * Math.max(extent, t.extent)) candidates.push({ f, t, d });
      }
    }
    candidates.sort((a, b) => a.d - b.d);
    for (const c of candidates) {
      if (matched.has(c.f) || claimed.has(c.t.pid)) continue;
      matched.set(c.f, c.t);
      claimed.add(c.t.pid);
    }

    // resolve: rewrite ids, reconcile orientation, refresh tracks
    const next = new Map<PersistentId, Track>();
    const nextByAnchor = new Map<FeatureId, Track>();
    for (const f of features) {
      const anchor = f.id!;
      let t = matched.get(f);
      if (!t) {
        const base = `${f.owner}/${f.type}`;
        const n = this.counters.get(base) ?? 0;
        this.counters.set(base, n + 1);
        t = { pid: `${base}#${n}`, owner: f.owner, type: f.type, anchor, centroid: [0, 0, 0], extent: 0, pts: null, lastSeen: frame };
        born.push(t.pid);
      }
      const pts = polylineOf(f);
      if (pts && t.pts && opposed(pts, t.pts, Math.max(t.extent, summarize(pts).extent))) {
        pts.reverse(); // in place, before visibility — see module header
        reversed.push(t.pid);
      }
      if (pts) {
        const s = summarize(pts);
        t.centroid = s.centroid;
        t.extent = s.extent;
        t.pts = decimate(pts);
      }
      t.anchor = anchor;
      t.lastSeen = frame;
      f.id = t.pid;
      ids.set(anchor, t.pid);
      next.set(t.pid, t);
      nextByAnchor.set(anchor, t);
    }

    const died = [...this.tracks.keys()].filter((pid) => !next.has(pid));
    this.tracks = next;
    this.byAnchor = nextByAnchor;
    return { frame, ids, born, died, reversed };
  }
}
