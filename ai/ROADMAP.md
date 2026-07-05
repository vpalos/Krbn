# Roadmap

Detail, contracts, and the hard-parts registry live in [`ai/DESIGN.md`](ai/DESIGN.md).
This is the short view.

**Status legend:** ✅ done · 🚧 partial · ⬜ not started. Progress reflects the
tree as of 2026-07-05; see DESIGN.md §"Implementation status" for module-level
detail. Everything below is verified by `bun test` (unit + property + degeneracy
suites) and `bun run build`.

## Phase 1 — Analytic primitives (current)

Real-world value for technical figures, and the regime where the hardest module
(hidden-line visibility) is exact.

**All nine build-order steps are implemented** end to end (extract → visibility →
abstraction → styling → emit → SVG), verified by tests and the `examples/`
renders. Before Phase 2 we are hardening Phase 1 — the ordered backlog:

### Phase 1 polish backlog (ordered)

1. ✅ **Numerical hygiene.** All per-site epsilons are centralized in
   `curve/epsilon.ts` as named, documented, role-based tolerances (`EPS_DENOM`,
   `EPS_PARAM`, `EPS_PARAM_REL`, `EPS_ONCURVE`, `EPS_ANGLE`, `EPS_DEPTH_REL`, …);
   no magic numbers remain outside that module. The QI grazing/cusp safety-net now
   scans at a screen-relative resolution (~`SCAN_STEP_PX` px), with its miss bound
   documented; transversal boundaries stay exact via analytic crossings.
2. ⬜ **Visual fidelity.** Coherent wobble that joins strokes at shared vertices
   (no gaps where a ruling meets a rim); per-patch hatch tone so curved surfaces
   shade light→dark instead of a flat single tone; hatch spacing and line-weight
   refinement.
3. ⬜ **Feature gaps**, in order: cylinder/cone surface hatching (§2.6) →
   `scene.highlight` (§2.8) → `Point` primitive (§2.3) → cross-primitive
   consolidation (§2.7) → quadric ∩ quadric quartics (§2.5) → torus (§2.3).
4. ⬜ **Verification & DX**: golden-SVG snapshot regression tests → more
   adversarial property tests → a real-`bun` test/CI note → an API-ergonomics pass.

1. ✅ **Core math kernel** — `Vec3`/`Vec2`, `Basis`, `AABB`, `Camera` (ortho +
   perspective projection), `Ray`, and the `Curve`/`Curve2D` carriers, plus the
   **exact conic intersector** (line–conic; conic–conic via the pencil /
   degenerate-line-pair split) and robust real root solvers. The critical path,
   and the most heavily tested part of the engine. _(design.md §2.9.1)_
2. ✅ **`FeatureSource` seam + `Scene` / element + importance model.** `Scene`
   holds elements (source + `importance`/`role`/style overrides), resolves a
   per-element style, and renders the whole pipeline (`src/scene/scene.ts`,
   `element.ts`). Importance is carried and `role` drives styling defaults; its
   abstraction-threshold lever waits on stage 3. `scene.intersect`/`highlight`
   from the §2.8 sketch are deferred (need intersection curves).
3. ✅ **Primitive catalog.** `Quadric` with exact silhouette conic (screen-space
   dual-quadric outline + object-space polar-plane contour), configured as
   `Sphere` / `Ellipsoid` / `Cylinder` / `Cone`; plus `Plane` / `Polygon`
   (occluder + hatch region), `Line`, and `ParametricCurve` (`Bézier`, `helix`,
   `functionPlot`). All expose closed-form `raycast` and `projectedSilhouettes`.
4. ✅ Stage 1 / emit / render: a runnable pass wires extract → visibility → emit
   → SVG (`renderScene` / `renderSceneSVG` in `src/pipeline/render.ts`). Verify by
   eye via `examples/demo.ts` → `examples/demo.svg`.
5. ✅ Stage 2: exact quantitative-invisibility → visible/hidden intervals.
   Analytic crossings (`projectedSilhouettes` × the feature's screen curve) place
   transversal boundaries exactly; each interval's state is an exact depth
   `raycast` toward the eye; grazing/cusp boundaries (tangencies) are caught by a
   sampled occlusion scan + bisection. `classifyScene` / `classifyFeature` in
   `src/pipeline/visibility.ts`.
6. ✅ Intersection-curve features (`src/primitives/intersection.ts`,
   `scene.intersect`): quadric ∩ plane = conic, sphere ∩ sphere = circle (radical
   plane), plane ∩ plane = line — first-class `intersection` features that flow
   through visibility + styling. quadric ∩ quadric (quartic) is a clear not-yet
   (no exact quartic carrier).
7. ✅ Stage 4: styling — per-element style resolution, seeded deterministic
   wobble, dash/ghost, and hatch generation clipped to the visible surface
   (`src/pipeline/style.ts`, `wobble.ts`, `hatch.ts`). Surface hatching covers
   sphere/ellipsoid + polygons today; cylinder/cone surface hatching and stage-3
   tone quantization are still to come.
8. ✅ Stage 3: abstraction (`src/pipeline/abstract.ts`) — importance-scaled
   screen-size thresholding + tone quantization, wired into `Scene.render`.
   Cross-primitive consolidation (§2.7) is still to come.
9. ✅ Stage 5: SVG backend (`src/backend/svg.ts`) with adaptive sampling of
   analytic curves at emit (`src/pipeline/emit.ts`, `curve/sample.ts`).

## Phase 2 — Mesh / organ regime (deferred, not lost)

One more `FeatureSource` implementation + the numerical machinery behind it;
everything from the stage-2 contract onward is reused. All ⬜.

1. Static scaffold — half-edge, normals, dihedral, crease/boundary tagging.
2. Curvature precompute (principal curvatures + derivative).
3. Silhouette as interpolated zero-set + chaining.
4. Suggestive contours.
5. Visibility — hybrid (depth-buffer-seeded) → fully analytic QI.
6. Temporal coherence for animation.

## Cross-cutting

Seeded/deterministic wobble ✅ (`src/pipeline/wobble.ts`; anchored to object-space
arclength), temporal-coherence discipline 🚧 (wobble is deterministic per
identity; fully coherent chains/silhouettes across frames are future),
SVG-first backend ✅ (`src/backend/svg.ts`), optional alpha as a pure drawing op
⬜, and a declarative authoring language that later deserializes into the same
`Scene` model ⬜. The adaptive analytic-curve sampler this all leans on is ✅
(`curve/sample.ts`).
