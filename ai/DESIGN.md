# NPR Sketch Engine — Design & Roadmap

A web engine for non-photorealistic, pencil-style rendering of abstract and
technical scenes (math/physics constructions, later medical/organic illustration).
Output is a set of **styled vector strokes** that reads as if drawn by a technical
artist: ghosted hidden lines, cross-hatched surfaces, emphasized/dashed contours,
and deliberate reduction of detail.

This document specifies **Phase 1 (analytic primitives)** in detail and keeps the
**mesh/organ regime** fully roadmapped so it is deferred, not lost.

---

## Implementation status (as of 2026-07-05)

The engine is past scaffold: the math kernel and the full analytic-primitive
catalog are implemented and tested. What exists, by area (✅ done · 🚧 partial ·
⬜ not started):

- ✅ **Core math** (`src/math`): `Vec3`/`Vec2` algebra, `Mat3`/`Mat4`
  (determinant, adjugate, skew, dual quadric), `Basis`, `AABB`, and `Camera` with
  a 3×4 projection for both orthographic and perspective.
- ✅ **Exact conic kernel** (`src/curve`): centralized/scaled epsilons, robust
  real quadratic + cubic solvers, and exact **line–conic** and **conic–conic**
  intersection. Conic–conic uses the pencil `det(C1 + λC2) = 0` to find a
  degenerate member, splits it into a line pair via the `adj(A) = −p pᵀ`
  identity, then reuses line–conic — nothing exceeds degree 3 (see §2.4, §5).
  This is the most heavily tested module; it covers the full degeneracy spec in
  `.claude/rules/numerical-robustness.md` plus rigid-transform invariance.
- ✅ **Primitive catalog** (`src/primitives`): `Quadric` with an exact silhouette
  conic — object-space via the eye's polar plane, screen-space via the dual
  quadric `P·adj(Q)·Pᵀ` — configured as `Sphere`/`Ellipsoid`/`Cylinder`/`Cone`
  (§2.2, §2.3); `Plane`/`Polygon` as an occluder + hatch region; `Line`; and
  `ParametricCurve` (`Bézier`, `helix`, `functionPlot`) with an adaptive
  screen-flatness sampler (`src/curve/sample.ts`). All implement `FeatureSource`
  with closed-form `raycast` and `projectedSilhouettes`.
- ✅ **Stage 2 — exact quantitative invisibility** (`src/pipeline/visibility.ts`,
  §2.4): each feature is split into visible/hidden intervals. Transversal
  boundaries come from exact analytic crossings of the feature's screen curve with
  occluders' `projectedSilhouettes`; each interval's state is decided by a
  closed-form depth `raycast` toward the eye (self-occlusion falls out via a depth
  epsilon). Grazing/cusp boundaries — where visibility changes at a *tangency*
  with no transversal image crossing — are caught by a sampled occlusion scan with
  bisection refinement (the hard-parts-registry cusp case; the transversal path
  stays exact). Feature-parameter recovery is exact via back-projection
  (`src/pipeline/feature-curve.ts`).
- ✅ **Emit + SVG backend** (`src/pipeline/emit.ts`, `src/backend/svg.ts`,
  `src/pipeline/render.ts`): the whole Phase-1 chain (extract → visibility → emit
  → SVG) runs end to end. Each visibility interval is adaptively sampled to a
  screen polyline and drawn — solid for visible runs, faint-dashed "ghost" for
  hidden (a minimal stand-in until stage 4). See `examples/demo.ts` →
  `examples/demo.svg` for a visual check.
- ✅ **Stage 4 — styling** (`src/pipeline/style.ts`, `wobble.ts`, `hatch.ts`):
  per-element style resolution, seeded deterministic wobble (anchored to
  object-space arclength, continuous across visibility intervals), dash/ghost, and
  hatch generation clipped exactly to the outline and to the *visible* surface
  (gaps reveal what is behind — the alpha-free transparency of §0.3). Surface
  hatching currently covers sphere/ellipsoid + polygons. The wobble and hatch
  algorithms are **pluggable strategies** (`WobbleStrategy` / `HatchStrategy`,
  injectable via `Scene` options) so each layer can be swapped or tuned in
  isolation without rewiring the rest.
- ✅ **`Scene` / element / importance model** (`src/scene`, §2.8): elements wrap a
  `FeatureSource` with `importance`/`role`/style overrides; `Scene.render` runs
  the whole styled pipeline. `role` supplies styling defaults now; importance's
  abstraction-threshold effect waits on stage 3. `scene.intersect`/`highlight`
  are deferred (need intersection curves).
- ✅ **Intersection-curve features** (`src/primitives/intersection.ts`,
  `scene.intersect`, §2.5): quadric ∩ plane = conic, sphere ∩ sphere = circle
  (radical plane), plane ∩ plane = line — first-class `intersection` features
  routed through the same visibility + styling pipeline (see the waterline demo).
  quadric ∩ quadric is also supported: a radical-plane conic where the quadratic
  parts match, else the quartic space curve traced by plane-sweep + conic∩conic,
  chained into polyline loops, then adaptively refined with a 2-surface Newton
  projection so the samples are dense and lie exactly on both quadrics
  (`gallery/08`).
- ✅ **Stage 3 — abstraction** (`src/pipeline/abstract.ts`, §2.7):
  importance-scaled screen-size thresholding + tone quantization, wired into
  `Scene.render`. Cross-primitive consolidation is future.
- ✅ **Numerical hygiene** (Phase-1 polish 1): every tolerance is centralized and
  documented in `curve/epsilon.ts`; the QI grazing/cusp scan is screen-relative
  with a documented miss bound.
- ✅ **Visual fidelity** (Phase-1 polish 2): coherence-preserving wobble (seeded
  3-D field keyed on the object-space point, per element) so strokes join at
  shared vertices; per-patch hatch tone via tonal layering so curved surfaces
  shade light→dark while flat faces stay uniform; style-driven hatch weight/opacity.
- ✅ **Phase-1 polish complete:** consolidation, cylinder/cone surface hatching,
  `scene.highlight` (+ halo), `Point`, quadric ∩ quadric quartics, and the
  **torus** (`src/primitives/torus.ts`: numerical silhouette as two contour loops
  from the implicit form; ray-torus via a real quartic solver, `curve/roots.ts`).
  Deferred refinements: curved hatch direction fields, torus surface hatching, and
  a contour Newton-projection for sampled silhouettes (Phase-2 meshes).

All nine Phase-1 build-order steps (§2.9) are implemented end to end.

Verification: `bun test` (unit, property, and degeneracy suites), plus
`bun run typecheck` and `bun run build`.

---

## 0. Guiding principles

1. **Strokes are the core object.** The engine does not "render surfaces"; it
   derives, classifies, and styles strokes and hatch regions from geometry.
   Every visual requirement is a *policy over the stroke set*.
2. **No corner-cutting on the hard problems.** We solve feature extraction,
   visibility, and abstraction first, because they are the engine.
3. **Transparency without alpha.** Cross-hatching is inherently see-through: gaps
   between hatch strokes reveal the ghosted hidden edges behind. Alpha is an
   optional later addition and is a pure drawing operation — the geometry backend
   never needs to know about it.
4. **Static scaffold, per-frame probe.** Split every datum into view-independent
   (compute once) and view-dependent (recompute per frame). Almost everything
   expensive is static.
5. **Author supplies semantics, engine supplies mechanics.** True artistic
   abstraction is partly semantic ("this part matters, that is context"). The
   engine cannot infer this reliably; the developer declares importance, and the
   engine allocates detail accordingly.

---

## 1. Core architecture (regime-independent)

### 1.1 The seam: `FeatureSource`

The load-bearing abstraction is **not** the mesh. It is a single interface whose
job is: *given a camera, produce classified feature curves and hatch regions.*
Analytic primitives and triangle meshes are two implementations; nothing
downstream knows which produced its input.

```ts
interface FeatureSource {
  bounds(): AABB;                                   // static
  extractFeatures(cam: Camera): Feature[];          // per-frame
  hatchRegions(cam: Camera, light: Light): HatchRegion[]; // per-frame
  raycast(ray: Ray): Hit[];                         // exact where possible; for visibility
  projectedSilhouettes(cam: Camera): Curve2D[];     // for QI crossing events
}
```

### 1.2 The five-stage stylization pass

The heart of the engine. Each stage is independent and communicates only via the
contract types in §1.4 — no stage reaches back into raw geometry.

| # | Stage | Does | Serves requirement |
|---|-------|------|--------------------|
| 1 | Feature extraction | Produce classified feature curves (silhouette, crease, boundary, suggestive, intersection) + hatch regions | Contours, form |
| 2 | Visibility classification | Split each curve into visible / hidden **intervals** | Ghosted hidden lines |
| 3 | Abstraction filter | Drop sub-threshold features; simplify/consolidate; apply importance | Drop-in-detail |
| 4 | Styling | Assign weight, wobble (seeded), dash, ghost, color; generate hatch strokes | Wobble, hatching, emphasis |
| 5 | Emit | Sample analytic curves to polylines; hand to backend | SVG/canvas output |

### 1.3 Shared vs regime-specific

The reason the organ path is "deferred, not lost": most of the engine is shared.

| Component | Analytic primitives | Triangle mesh | Shared |
|-----------|:---:|:---:|:---:|
| Feature extraction (stage 1) | exact/closed-form | numerical | — |
| Visibility (stage 2) | exact QI | hybrid → analytic QI | interval model & contract |
| Abstraction (stage 3) | | | ✔ (screen-space) |
| Styling (stage 4) | | | ✔ |
| Emit + backend (stage 5) | | | ✔ |
| Importance / semantic API | | | ✔ |
| Temporal-coherence discipline | | | ✔ |

Adding organs later ≈ **implementing one interface** (`FeatureSource`) plus the
numerical machinery behind it. Everything from stage 2's contract onward is reused.

### 1.4 Inter-stage contract

Note the **`Curve` carrier** (refinement over an earlier polyline-only design):
analytic features stay analytic until emit, preserving exactness and exact
crossings. Meshes supply `Curve` as a sampled polyline; primitives supply conics,
arcs, and lines.

```ts
type Curve =
  | { kind: 'line'; a: Vec3; b: Vec3 }
  | { kind: 'arc'; center: Vec3; radius: number; plane: Basis; a0: number; a1: number }
  | { kind: 'conic'; /* projective conic params */ }
  | { kind: 'bezier'; pts: Vec3[] }
  | { kind: 'polyline'; pts: Vec3[] };             // mesh path, or late-sampled

// stage 1 → 2
interface Feature {
  type: 'silhouette' | 'crease' | 'boundary' | 'suggestive' | 'intersection';
  owner: ElementId;          // for importance & styling lookup — carried end-to-end
  curve: Curve;              // object space, already chained
  attrs: { dihedral?: number; convex?: boolean };
}

// stage 2 → 3 (projected + visibility-classified)
interface Stroke {
  feature: Feature;
  screen: Curve2D;
  intervals: { t0: number; t1: number; visible: boolean }[];
}

// stage 4 → 5
interface RenderStroke {
  path: Vec2[];              // sampled, simplified, optionally wobbled
  style: { weight: number; dash?: number[]; color: string; opacity: number };
}
```

---

## 2. Phase 1 — Analytic primitives (current focus)

### 2.1 Why primitives first

- **Immediate real-world value** for math/physics figures.
- **The hardest module becomes easy.** Quantitative-invisibility crossings reduce
  to analytic curve intersections; in/out tests to closed-form ray–surface hits.
  No depth-buffer crutch needed.
- **Learning surface.** Exact features make it possible to reason about and verify
  every stage before facing numerical noise.
- **Exactness is a feature, not a nicety.** Resolution-independent SVG that stays
  crisp at any zoom is exactly what a printed manual wants.

### 2.2 The quadric unification

The silhouette of **any quadric** from a point is a **conic** (a plane section of
the quadric). Implement `Quadric` once and sphere, ellipsoid, cylinder, cone all
inherit exact silhouettes as circles, ellipses, or line pairs. This is the
organizing fact of the primitive layer.

### 2.3 Primitive catalog

| Primitive | Silhouette | Creases / boundaries | Hatch direction field | Notes |
|-----------|-----------|----------------------|-----------------------|-------|
| Point | — | — | — | Renders as mark (dot/cross); single depth test for visibility |
| Line segment / ray | — | — | — | Occludable along length → needs QI |
| Parametric curve (Bézier, helix, function plot) | — | — | — | Adaptive screen-flatness sampling; QI along length |
| Polygon / bounded plane | boundary only | polygon outline (exact) | flat: fixed angle or edge-aligned | Interior is a hatch region |
| Sphere | exact circle/ellipse | — | any orthogonal pair, or view/light-aligned | No suggestive contours (constant curvature) |
| Cylinder (finite) | 2 tangent lines + cap arcs | rim ellipses | axial + circumferential | Back half self-occluded |
| Cone | 2 lines through apex + base arc | base ellipse | radial + circumferential | Apex is singular |
| General quadric (ellipsoid, paraboloid, hyperboloid) | conic | — | exact principal directions | See §2.2 |
| Torus | quartic curve | — | toroidal + poloidal | Harder: numerical silhouette from implicit form |
| Intersection curve (surface ∩ surface) | — (is itself a feature) | — | — | Sphere∩plane = circle; quadric∩quadric = quartic. See §2.5 |

### 2.4 Exact visibility (the de-risking win)

Appel's **quantitative invisibility**: assign each point on a curve an integer
count of occluding front-facing surfaces; the count changes by ±1 only at
projected silhouette crossings. Determine visibility at one reference point, then
walk the curve flipping at each crossing; count 0 ⇒ visible. For primitives:

- **Crossing events** = intersections of analytic projected curves
  (line–conic, conic–conic) → exact roots of low-degree polynomials.
- **Reference in/out test** = closed-form ray–quadric / ray–plane hit.

Result: exact visible/hidden **intervals**, which is exactly what dashed-ghost
styling needs. No numerical fragility, no depth buffer.

### 2.5 Intersection-curve features

When two analytic surfaces intersect, the intersection is a feature an artist
draws (the "waterline"). Many are exact: sphere∩plane = circle, cylinder∩plane =
ellipse, quadric∩quadric = quartic. Emit these as first-class `Feature`s of type
`intersection`. This is something the mesh regime can only approximate, and it is
essential for compound figures (a plane cutting a solid).

### 2.6 Hatching

Direction fields are **exact** for primitives (no curvature estimation). Tone
(density; single vs cross vs triple hatch) comes from `N·L`, ambient occlusion, or
the author's quantized importance. Hatch strokes are generated by clipping parallel
lines in the direction field to the region's **projected, visible** outline —
routed through the same visibility machinery, so hatching stops at occlusion
boundaries and its gaps reveal what is behind (alpha-free transparency).

### 2.7 Abstraction is lighter here

An analytic arc is already one confident stroke, so simplify/consolidate is largely
a no-op. What still runs:

- **Screen-size thresholding** — drop a silhouette whose projected extent < N px
  (recomputed per frame; detail thins as you zoom out).
- **Cross-primitive consolidation** — merge near-parallel neighboring strokes from
  *different* primitives into one representative line.
- **Tone quantization** — snap shading to k discrete hatch levels before hatching.

### 2.8 Developer-facing semantic API (no declarative language yet)

Declarative markup is deferred. For now, importance and grouping are a plain API.
`importance` does **not** set style directly — it *modulates abstraction
thresholds*: high importance lowers the feature-size cutoff and simplification
tolerance (keep detail); low importance raises them (reduce to bare silhouette);
`role: 'context'` forces ghost styling and drops suggestive contours.

```ts
const scene = new Scene();

const s = scene.add(new Sphere({ center: [0,0,0], radius: 1 }));
const p = scene.add(new Plane({ point: [0,0,0], normal: [0,1,0] }));

// exact intersection feature (a circle), drawn as an emphasized waterline
scene.intersect(s, p, { emphasis: 'bold' });

// semantic importance drives the abstraction stage
s.setImportance(1.0, { role: 'subject' });
p.setImportance(0.2, { role: 'context' });

// per-element style overrides (wobble 0 → hero, dashing, ghost)
s.style({ wobble: 0.6, hatch: { mode: 'cross', angle: 30 } });
p.style({ wobble: 0.0, hatch: { mode: 'single', angle: 45 } });

// highlight: re-extract a subset's silhouette, force on top, dash where hidden
scene.highlight(s, { weight: 2.5, dashWhenHidden: true });
```

### 2.9 Suggested build order (Phase 1)

Status marks reflect the tree as of 2026-07-05 (see "Implementation status" above).

1. ✅ Core math: `Vec3`, `Basis`, `Camera` (ortho + perspective), `Ray`, `Curve`,
   `Curve2D` (conic/arc/line with exact intersection).
2. ✅ `FeatureSource` interface + `Scene` + element/importance model
   (`src/scene`; intersect/highlight deferred).
3. ✅ `Quadric` primitive with exact silhouette conic; `Sphere`/`Ellipsoid`/
   `Cylinder`/`Cone` as configurations. `Plane`/`Polygon`, `Line`,
   `ParametricCurve`.
4. ✅ Stage 1 emit of raw features — via the render facade (`renderScene`),
   verify by eye (`examples/demo.svg`).
5. ✅ Stage 2: exact QI (crossing events + reference test) → visible/hidden
   intervals (`src/pipeline/visibility.ts`).
6. ✅ Intersection curves (`src/primitives/intersection.ts`).
7. ✅ Stage 4 styling (weight/dash/ghost/seeded-wobble) + hatch generation
   (`src/pipeline/style.ts`, `wobble.ts`, `hatch.ts`).
8. ✅ Stage 3 abstraction (screen-size threshold, tone quantization, importance)
   (`src/pipeline/abstract.ts`).
9. ✅ SVG backend (stage 5) + adaptive sampling of analytic curves
   (`src/backend/svg.ts`, `src/pipeline/emit.ts`, `src/curve/sample.ts`).

---

## 3. Roadmap — Mesh / organ regime (deferred, not forgotten)

### 3.1 The payoff

Because everything from §1.4 onward is shared, the organ regime is **one
`FeatureSource` implementation** plus the numerical machinery behind it. The engine
does not fork; it gains a second feature source.

### 3.2 What is already shared / done once

Visibility interval model, abstraction, styling, importance API, temporal-coherence
discipline, backend. The mesh path must only produce `Feature`s (as chained
polyline `Curve`s) and support `raycast` / `projectedSilhouettes`.

### 3.3 Phased plan

1. **Static scaffold.** Half-edge structure (oriented, manifold; cleanup at load).
   Face normals, area; angle-weighted vertex normals; per-edge dihedral; pre-tag
   creases (dihedral > θ) and boundaries (no twin).
2. **Curvature precompute.** Principal curvatures + directions and their
   derivative (Rusinkiewicz per-face fitting → averaged to vertices). Static;
   noise-sensitive. Feeds both hatch fields and suggestive contours.
3. **Silhouette as zero-set.** Define `g(v) = n(v)·viewDir(v)`; extract the
   silhouette as the interpolated zero set crossing *through* faces (Hertzmann–
   Zorin), not the staircase per-edge test. Continuous under camera motion.
4. **Chaining.** Link the per-triangle segment soup into ordered polylines via
   half-edge adjacency. **Mandatory** — consolidation needs ordered chains.
5. **Suggestive contours.** Zero crossings of radial curvature increasing away
   from the eye (DeCarlo et al.). Essential for organic form; off for most
   technical figures.
6. **Visibility.** Start hybrid (analytic crossing events place interval
   boundaries; depth-buffer sample seeds the reference point), graduate to fully
   analytic QI. Same `Stroke.intervals` output as Phase 1.
7. **Temporal coherence.** Stabilize chains, silhouette zero-sets, and wobble
   seeds frame-to-frame so nothing "boils." Research-adjacent for fluid animation.

### 3.4 Hard-parts registry (risks)

| Risk | Where | Mitigation |
|------|-------|-----------|
| Curvature/derivative noise | §3.3.2 | Static (paid once); standard method; smoothing |
| QI bookkeeping fragility | §2.4 / §3.3.6 | Exact for primitives; hybrid for meshes; isolated module |
| Cusps / near-tangent crossings | visibility | Analytic events for primitives; careful epsilon handling |
| Temporal boiling in animation | §3.3.7 | Seeded wobble; stable chain identity; coherent silhouettes |
| Non-manifold / dirty meshes | §3.3.1 | Load-time cleanup pass |

---

## 4. Cross-cutting concerns

- **Temporal coherence.** Wobble is seeded and deterministic per stroke identity;
  never re-randomized per frame. Chains and silhouettes must keep stable identity
  across frames. This discipline starts in Phase 1 (with wobble) so it is not
  retrofitted.
- **Backend.** SVG first — exact, resolution-independent vector output matches the
  analytic pipeline and the printed-manual use case. Canvas/WebGL later for high
  stroke counts or effects; the emit stage abstracts the backend.
- **Wobble.** A style parameter (amount + bowing/overshoot), 0 = ruler, hero =
  very sketchy; per-element, per-scene-default, overridable; applied to the
  late-sampled polyline.
- **Alpha (optional, later).** A faint fill composited under hatching; a pure
  drawing op, decoupled from geometry.

---

## 5. Open decisions / next steps

- **Projection default:** _resolved._ Both are implemented (`Camera.projection`);
  orthographic is the default for technical figures (sphere silhouette is a true
  circle), perspective supported (silhouette becomes an ellipse).
- **Curve2D exact-intersection kernel:** _resolved._ The robust conic–conic /
  line–conic intersector (the numerical core of exact QI) is implemented and is
  the most-tested module (`src/curve/conic.ts`; see the Implementation status
  section and §2.4).
- **Torus and non-quadric primitives:** numerical silhouette from implicit form;
  still deferred, scope for later in Phase 1.
- **Declarative language:** deferred. When added, it deserializes into the same
  `Scene`/element model the API already populates (JSX renderer or custom elements
  over the same graph).

The full Phase-1 pipeline is now in place (extract → visibility → abstraction →
styling → emit → SVG), including intersection curves (§2.5). Next is **Phase-1
polish** — cross-primitive consolidation (§2.7), cylinder/cone surface hatching
(§2.6), quadric ∩ quadric quartics and torus (§2.3), `scene.highlight` (§2.8) —
and then **Phase 2**, the mesh/organ regime (§3), which is one more `FeatureSource`
behind the same seam.
