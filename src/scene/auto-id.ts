// Fallback identity for a `FeatureSource` constructed without an explicit id.
//
// Identity should be *scene-scoped*: the Nth source of a given kind in a Scene is
// `${kind}-${N}`, assigned by `Scene.add` (see scene.ts). That makes a scene's
// wobble — which is seeded on element id — independent of how many other sources
// exist elsewhere in the process, so a `*.krbn.ts` renders the same alone or beside
// any number of siblings.
//
// This module only supplies a *provisional* id for a source used outside any Scene
// (e.g. a unit test calling `classifyScene` directly). It keeps the `id` field a
// defined string so `owner: this.id` stays well-typed; the value is replaced the
// moment the source is added to a Scene. A source flags `autoNamed` so the Scene
// knows it may relabel it.
import type { ElementId } from "../pipeline/types.js";

const counts = new Map<string, number>();

/** A provisional, per-kind id for a source built outside a Scene. */
export function autoName(kind: string): ElementId {
  const n = counts.get(kind) ?? 0;
  counts.set(kind, n + 1);
  return `${kind}-${n}`;
}
