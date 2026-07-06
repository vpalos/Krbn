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
2. ✅ **Visual fidelity.** Wobble is now a seeded 3-D noise field keyed on the
   object-space point (per element), so strokes sharing a vertex — a ruling and
   its rim, a cone's generators at the apex — receive the same offset and join
   exactly. Hatching shades curved surfaces light→dark via tonal layering (each
   angle set clipped to the surface region dark enough for it; flat faces stay
   uniform). Hatch weight/opacity are style-driven. `wobble`/`hatch` remain
   pluggable strategies.
3. **Feature gaps**, in order: ✅ cross-primitive consolidation (§2.7,
   `src/pipeline/consolidate.ts`; opt-in via `abstraction.consolidate`) →
   ✅ cylinder/cone surface hatching (§2.6, `hatchRegions` return a silhouette-hull
   footprint; the scene's per-sample clip carves + shades the surface;
   `gallery/05`) → ✅ `scene.highlight` (§2.8, re-extract + draw on top, heavier,
   dashed-where-hidden, optional semi-transparent halo; `gallery/06`) →
   ✅ `Point` primitive (§2.3, a
   camera-facing mark emitted as tiny segments so QI decides visibility;
   `gallery/07`) → ✅ quadric ∩ quadric quartics (§2.5, `intersectQuadrics`: a
   radical-plane conic where the quadratic parts match, else the quartic traced by
   plane-sweep + conic∩conic and chained to polyline loops; `gallery/08`) →
   ✅ torus (§2.3, `src/primitives/torus.ts`: silhouette traced numerically from
   the implicit form as two contour loops; ray-torus via a real quartic solver;
   `gallery/10`) → ✅ **curved hatch direction fields** (§2.6,
   `FeatureSource.hatchField`: cylinder = rings + rulings, cone = rings +
   generators, torus = poloidal + toroidal circles, sphere = parallels +
   meridians (`Sphere` configuration), ellipsoid = chart parallels + meridians
   with exact gradient normals (`Ellipsoid` configuration); each surface also
   emits a *diagonal third family* for `triple` — 45° helices / spiral
   generators / (1,1) torus loops / tilted-axis circles / pole-to-pole chart
   spirals — exact iso-parameter curves emitted as world samples with normals;
   the scene clips each to the front-facing, unoccluded, tonally-dark surface
   via `clipHatchField`; `gallery/12` (4 surfaces × single/cross/triple),
   `gallery/08` (curved-field column), and now the default for
   `gallery/05/10/11`). **All feature gaps done.** Deferred refinement: a contour Newton-projection so a *sampled*
   silhouette's grazing points can be visibility-tested without the small nudge
   tolerance (matters for Phase-2 meshes).
4. ⬜ **Verification & DX**: golden-SVG snapshot regression tests → more
   adversarial property tests → a real-`bun` test/CI note → an API-ergonomics pass.

### Deferred strategies (captured for later)

- **Group highlight** — highlight two or more elements as *one* contour. Needs the
  **union of the group's projected silhouettes**: reuse the per-solid convex-hull
  footprints we already build for hatching, boolean-union those hull polygons into
  one outer boundary, then draw the halo + crisp outline around that single
  contour. Path A (vector, crisp) needs a small polygon-union routine
  (Greiner–Hormann / Martinez); Path B (screen coverage mask + marching-squares)
  gives a softer halo more cheaply. Recommend A on the hull footprints as a good
  approximation. **Deferred until after Phase 2** (per direction call 2026-07-06).

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

## Phase 2 — Mesh / organ regime (underway)

One more `FeatureSource` implementation + the numerical machinery behind it;
everything from the stage-2 contract onward is reused. The **`Mesh` `FeatureSource`**
(`src/mesh/mesh-source.ts`) now wraps steps 1–3 — `extractFeatures` (silhouette +
chained creases + boundaries), `projectedSilhouettes`, and Möller–Trumbore
`raycast` with interpolated normals — so a mesh renders **end to end through the
existing pipeline with hidden-line visibility, wobble, variable width, and
shading** (`gallery/13`), no fork. A **curvature-driven hatch field**
(`src/mesh/mesh-hatch.ts`: evenly-spaced streamlines of the principal-direction
field via `Mesh.hatchField`) lets mesh surfaces shade with curvature-following
hatch, empty (→ straight-hatch fallback) where isotropic.

1. ✅ **Static scaffold** (`src/mesh/halfedge.ts`, `shapes.ts`) — half-edge
   topology from indexed triangles (twin/next/face, boundary detection,
   non-manifold flagging, optional vertex weld at load), face normals + areas,
   angle-weighted vertex normals, per-edge dihedral + convex/concave sign, and
   crease (dihedral > θ) / boundary tagging. Verified on tetra / cube / open grid
   (Euler χ, mutual twins, outward normals, 90°/109.47° dihedrals, weld, non-manifold).
2. ✅ **Curvature precompute** (`src/mesh/curvature.ts`) — Rusinkiewicz per-face
   least-squares fit of the second (and third) fundamental form from vertex-normal
   variation, rotated into each vertex's tangent frame and mixed-Voronoi-area
   averaged; diagonalized to principal curvatures κ1/κ2 + directions, plus the
   derivative tensor `dcurv` (for suggestive contours). Verified against plane
   (0), sphere (κ=1/R, K>0, dcurv≈0), and cylinder (κ_max=1/R, κ_min=0 along axis,
   K≈0).
3. ✅ **Silhouette as interpolated zero-set + chaining** (`src/mesh/silhouette.ts`)
   — g(v) = n(v)·toEye with interpolated vertex normals; per-face zero crossings
   *through* the triangle (Hertzmann–Zorin, continuous under camera motion), linked
   through shared crossed-edge nodes into ordered polyline loops (closed) / paths
   (open at boundaries). Verified on sphere (one equatorial loop; oblique view stays
   on the sphere in the plane ⟂ view) and open tube (two profile paths).
4. ✅ **Suggestive contours** (`src/mesh/suggestive.ts`, DeCarlo et al.) — the
   zero-set of radial curvature κ_r = κ1·u² + κ2·w² on the front-facing surface,
   kept where D_w κ_r (from the `dcurv` tensor) exceeds a threshold, chained via the
   shared `zeroSetLoops`. Opt-in on the `Mesh` source (`{ suggestive }`), drawn as
   lighter form lines dropped where hidden. Verified: none on a convex sphere,
   present + front-facing on a torus (`gallery/14`).
5. 🚧 Visibility — the shared QI now renders meshes correctly: a `FeatureSource`
   may declare a **self-nudge** (`Mesh.selfNudge` ≈ 1.5× mean edge length) so a
   grazing faceted silhouette clears its neighbouring triangles (owner self-hits
   nearer than the nudge are skipped) while genuine self-occlusion is still caught
   — fixing the stipple on `gallery/13`. The analytic path is byte-identical.
   Fully-analytic mesh QI (vs this hybrid tolerance) is still future.
6. ⬜ Temporal coherence for animation.

## Cross-cutting

Seeded/deterministic wobble ✅ (`src/pipeline/wobble.ts`; anchored to object-space
arclength; bends outlines **and** hatch from one knob), variable stroke width ✅
(`src/pipeline/width.ts`; filled ribbons = emphasis × camera-depth × taper ×
pressure), temporal-coherence discipline 🚧 (wobble is deterministic per
identity; fully coherent chains/silhouettes across frames are future),
SVG-first backend ✅ (`src/backend/svg.ts`), optional alpha as a pure drawing op
⬜, and a declarative authoring language that later deserializes into the same
`Scene` model ⬜. The adaptive analytic-curve sampler this all leans on is ✅
(`curve/sample.ts`).
