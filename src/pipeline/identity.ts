// Feature identity — the spine of temporal coherence (docs/DESIGN.md §3.3.7, §4).
//
// Every stroke the pipeline draws should be nameable across frames, so that
// per-stroke state (dash phase, taper direction, wobble anchoring, frame-to-frame
// correspondence, hysteresis) keys on *what the stroke is*, never on the order it
// happened to be extracted in this frame.
//
// Sources that can anchor a view-dependent chain to view-independent data assign
// ids themselves (the mesh source keys a silhouette loop on its minimal crossed
// mesh edge). For everything else this fallback names features
// `${owner}/${type}:${n}`, counting per (owner, type) in extraction order — exact
// for analytic primitives, whose feature list is deterministic and does not
// reorder under camera motion (a quadric emits one silhouette conic, a polygon
// its boundary, etc.).

import type { Feature } from "./types.js";

/** Fill in missing `Feature.id`s deterministically (in place; returns the same
 *  array for chaining). Counters reset per call — call it once per source per
 *  frame, immediately after `extractFeatures`. */
export function assignDefaultFeatureIds(features: Feature[]): Feature[] {
  const counters = new Map<string, number>();
  for (const f of features) {
    const base = `${f.owner}/${f.type}`;
    if (f.id === undefined) {
      const n = counters.get(base) ?? 0;
      f.id = `${base}:${n}`;
      counters.set(base, n + 1);
    }
  }
  return features;
}
