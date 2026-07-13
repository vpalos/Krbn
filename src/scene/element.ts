// A scene element: a `FeatureSource` plus authoring semantics (docs/DESIGN.md §2.8).
//
// `importance`/`role` express what matters; the engine allocates detail from
// them. Importance's primary lever is the abstraction stage (not built yet), so
// for now it is carried and `role` supplies styling defaults. `style()` sets
// per-element overrides that win over scene defaults.

import type { ElementId } from "../pipeline/types.js";
import type { FeatureSource } from "./feature-source.js";
import type { Role, StyleOverride } from "../pipeline/style.js";

let autoId = 0;

/** Every primitive exposes a stable `id`; features carry it as `owner`. */
interface Identified {
  id?: ElementId;
}

export interface ElementOptions {
  importance?: number;
  role?: Role;
  style?: StyleOverride;
  /** When `false`, the element still participates fully in the pipeline —
   *  it occludes other elements and is occluded by them (hidden-line, hatch
   *  clipping) — but emits *no strokes of its own* to the final output. Useful
   *  for splitting one scene into per-colour SVG layers for multi-pen plotting:
   *  render once per colour, muting the other colours, and every layer keeps
   *  correct visibility against the whole scene. Default `true`. */
  output?: boolean;
}

export class Element {
  readonly source: FeatureSource;
  readonly id: ElementId;
  importance: number;
  role: Role;
  styleOverride: StyleOverride;
  /** Emit this element's own strokes to the output? (It always still occludes.) */
  output: boolean;

  constructor(source: FeatureSource, opts: ElementOptions = {}) {
    this.source = source;
    this.id = (source as Identified).id ?? `element-${autoId++}`;
    this.importance = opts.importance ?? 0.5;
    this.role = opts.role ?? "default";
    this.styleOverride = { ...opts.style };
    this.output = opts.output ?? true;
  }

  /** Set importance (0..1); optionally the semantic role. Chainable. */
  setImportance(value: number, opts: { role?: Role } = {}): this {
    this.importance = value;
    if (opts.role) this.role = opts.role;
    return this;
  }

  setRole(role: Role): this {
    this.role = role;
    return this;
  }

  /** Toggle whether this element emits its own strokes (it still occludes).
   *  Chainable. See {@link ElementOptions.output}. */
  setOutput(value: boolean): this {
    this.output = value;
    return this;
  }

  /** Merge per-element style overrides. Chainable. */
  style(override: StyleOverride): this {
    this.styleOverride = { ...this.styleOverride, ...override };
    return this;
  }
}
