# Roadmap

Detail, contracts, and the hard-parts registry live in [`docs/DESIGN.md`](DESIGN.md).
This is the short view.

**Status legend:** ✅ done · 🚧 partial · ⬜ not started. Progress reflects the
tree as of 2026-07-07; see DESIGN.md §"Implementation status" for module-level
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
3. ✅ **Feature gaps** — all done, in build order:

   - ✅ **cross-primitive consolidation** (§2.7, `src/pipeline/consolidate.ts`;
     opt-in via `abstraction.consolidate`).
   - ✅ **cylinder/cone surface hatching** (§2.6, `hatchRegions` return a
     silhouette-hull footprint; the scene's per-sample clip carves + shades the
     surface; `gallery/05`).
   - ✅ **`scene.highlight`** (§2.8, re-extract + draw on top, heavier,
     dashed-where-hidden, optional semi-transparent halo; `gallery/06`).
   - ✅ **`Point` primitive** (§2.3, a camera-facing mark emitted as tiny segments
     so QI decides visibility; `gallery/07`).
   - ✅ **quadric ∩ quadric quartics** (§2.5, `intersectQuadrics`: a radical-plane
     conic where the quadratic parts match, else the quartic traced by
     plane-sweep + conic∩conic and chained to polyline loops; `gallery/08`).
   - ✅ **torus** (§2.3, `src/primitives/torus.ts`: silhouette traced numerically
     from the implicit form as two contour loops; ray-torus via a real quartic
     solver; `gallery/10`).
   - ✅ **curved hatch direction fields** (§2.6, `FeatureSource.hatchField`:
     cylinder = rings + rulings, cone = rings + generators, torus = poloidal +
     toroidal circles, sphere = parallels + meridians (`Sphere` configuration),
     ellipsoid = chart parallels + meridians with exact gradient normals
     (`Ellipsoid` configuration); each surface also emits a *diagonal third
     family* for `triple` — 45° helices / spiral generators / (1,1) torus loops /
     tilted-axis circles / pole-to-pole chart spirals — exact iso-parameter curves
     emitted as world samples with normals; the scene clips each to the
     front-facing, unoccluded, tonally-dark surface via `clipHatchField`;
     `gallery/12` (4 surfaces × single/cross/triple), `gallery/08` (curved-field
     column), and now the default for `gallery/05/10/11`).

   Deferred refinement: a contour Newton-projection so a *sampled* silhouette's
   grazing points can be visibility-tested without the small nudge tolerance
   (matters for Phase-2 meshes).
4. 🚧 **Verification & DX.**

   - ✅ **Authoring surface** — a scene is a standalone `*.krbn.ts` file that
     default-exports a deliverable: a `Drawing` (one SVG, `.toSvg()`) or a `Film`
     (a driven frame sequence), composed with the `src/layout` helpers (`view` /
     `raw` / `grid` / `stack` / `film` / `flipbook` / labels).
   - ✅ **Render CLI** — `render` ships any deliverable to SVG (`render` /
     `render:gallery` / `render:animation`): a still → `<name>.svg`, a film →
     `<name>/frame-###.svg` + a `flipbook.html`.
   - ✅ **Scene-scoped identity** (`src/scene/auto-id.ts`) — `Scene.add` assigns
     deterministic per-scene ids, so a scene's wobble no longer depends on process
     construction order; a file renders identically alone or in a batch.
   - ✅ **Public API** — engine mechanics export from `krbn` (primitives, `Scene`,
     `FrameSession`, `Mesh` + `MeshInput`, the layout deliverables); the mesh
     **shape generators** sit on a separate `krbn/shapes` subpath; usage is
     documented in [`API.md`](../API.md).
   - ⬜ **Golden-SVG regression tests** — raw SVG bytes are **not** stable across
     platforms/runtimes (floating-point differences), so these must assert
     structure/tolerances, not bytes.
   - ⬜ **Further adversarial property tests.**

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
   eye via the `examples/gallery/*.krbn.ts` renders.
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
5. ✅ Visibility — the shared QI decision (`isOccluded`) is now an **exact
   depth-buffer test**: cast the primary ray (eye → the point's pixel), re-condition
   its origin to just before the scene's bounding sphere (so analytic quartics keep
   their roots from a far eye), and occlude iff a surface is hit strictly nearer
   than the point — no ray-nudge heuristic. A source's own hits are "self" up to a
   per-owner depth tolerance: a small floor (`EPS_NUDGE_REL·scale`) for smooth
   surfaces, since a raycast's grazing tangent root at a silhouette is only good to
   ~that precision (a torus is a quartic); widened to the facet scale
   (`selfNudge` ≈ 0.75× edge length) for a mesh, since a silhouette point on one
   triangle can be a chord-sagitta nearer than the next facet. Occlusion by *other*
   sources is compared exactly. Verified: analytic occlusion robust from a far
   viewpoint; analytic + mesh silhouettes intact (`gallery/10–13,15`).
6. ✅ **Temporal coherence for animation** (target: offline frame sequences; the
   per-frame pipeline stays pure, all cross-frame state lives in the
   `FrameSession` wrapper). Completed sub-steps:
   1. ✅ **Identity spine** — `Feature.id` (`FeatureId`) in the stage-1 contract;
      mesh chains are canonically oriented from geometry/topology, never from
      face-iteration order (`ZeroSetChain`/`VertexChain` in
      `src/mesh/silhouette.ts`): direction is an intrinsic vote (positive-g side
      kept on a fixed hand — no flips under camera motion except at topological
      events and on tiny grazing loops, measured over a 200-frame sweep), start +
      key anchor on the minimal crossed mesh edge (churns only when that edge
      leaves the zero-set). Creases/boundaries key on their first canonical edge
      (fully view-independent). Analytic sources get deterministic
      `${owner}/${type}:${n}` fallback ids (`src/pipeline/identity.ts`, applied in
      `classifyScene`). Verified: `test/temporal-identity.test.ts`.
   2. ✅ **Frame session wrapper** — `FrameSession` (`src/scene/session.ts`)
      wraps a `Scene`; the per-frame pipeline stays a pure function of the
      camera, all cross-frame state lives in the session. Injected via the
      `reconcileFeatures` seam (`Scene.render` opts → `classifyScene`): the hook
      sees the frame's full feature list after id assignment and *before*
      visibility, where a direction fix is still a cheap polyline reversal.
      `session.render(cam)` = `RenderResult` + a `FrameCoherence` report
      (frame index, anchor→persistent-id map, born/died/reversed).
   3. ✅ **Frame-to-frame correspondence** (`FrameSession.reconcile`) — pass 1:
      anchor continuity (covers all view-independent ids + unchurned anchors);
      pass 2: greedy nearest-centroid matching for leftover polyline chains,
      gated by chain extent. Matched features get session-lifetime
      `${owner}/${type}#${n}` persistent ids written into `Feature.id`, so
      everything downstream keying on the id is coherent for free. Orientation
      reconciliation: a matched chain running opposite to its track is reversed
      in place — decided by a *global* proximity-weighted unit-tangent vote with
      a confidence deadband (an ambiguous vote defaults to keeping the intrinsic
      orientation; naive per-probe votes oscillated). Measured on the 200-frame
      sweep (torus/blob/tube/sphere): torus/tube/sphere born=died=0 (all anchor
      churn absorbed); blob reports only its genuine topological events; global
      alignment score stays positive everywhere — no whole-stroke flips remain
      (weak scores only on ≤9-pt dying loops). Verified:
      `test/frame-session.test.ts`. Still open (folded into steps 4–5): keying
      dash phase on the persistent id, and consolidation-merged strokes
      currently lack ids.
   4. ✅ **Hatch coherence** — three fixes:
      (a) **Streamline atlas** (`StreamlineAtlas`, `src/mesh/mesh-hatch.ts`): a
      static object-space multi-resolution streamline set — level k adds lines
      at `baseSpacing/2^k` seeded *around* everything coarser (J–L with an
      `occupied` set), so refining never moves an existing line. Cached lazily
      on the `Mesh` (intrinsic geometry, like curvature; base = bounds diag/4).
      The camera now only picks the level in `Mesh.hatchField` — no per-frame
      re-seed; a level switch purely adds/removes the finest level. Fixed en
      route: the tracer's `relocate` 2-ring overshoot on anisotropic meshes at
      coarse spacing (adaptive step halving).
      (b) **Object-anchored straight-hatch phase**: `HatchRegion.anchorPx`
      (scene fills it with the projected bounds centre) — line offsets run
      through the anchor, so hatch pans *with* the object instead of being
      pinned to screen-origin spacing multiples. `generateHatchLines` returns
      keyed lines (`angleSet:offsetIndex`); `HatchStrategy.generateLines` is the
      optional keyed variant (plain `generate` still works).
      (c) **Stable per-line wobble seeds**: the scene seeds each hatch line from
      its stable key (atlas streamline id / offset index), never from emission
      order — a run-count change (visibility clip, region growth) can no longer
      re-deal every line's wobble. Verified: `test/hatch-coherence.test.ts`;
      gallery regenerated and visually checked. **Deferred within this item:**
      the *analytic* iso-curve fields (cylinder/cone/torus/sphere/ellipsoid
      `hatchField`) still respace with camera-derived counts — the same LOD-
      ladder treatment (quantize iso-spacing to a power-of-2 ladder of a
      view-independent base + iso-parameter keys) is mechanical but touches five
      primitives; do it with (or before) step 5's hysteresis. Level-switch and
      curved↔straight-fallback popping is step 5's hysteresis.
   5. ✅ **Fades for the hard thresholds** — all *stateless*, derived from the
      continuous quantity that crosses the threshold (no cross-frame state, so
      the pipeline stays pure):
      · abstraction screen-size cull: strokes in the band `[cutoff,
        1.6·cutoff)` get `Stroke.fade` (opacity ramp) instead of a pop
        (`FADE_RATIO`, `src/pipeline/abstract.ts`);
      · suggestive contours: an optional `fade` band above the `D_w κ_r`
        threshold maps a chain's mean margin to `Feature.attrs.strength`
        (`SuggestiveChain`, `src/mesh/suggestive.ts`); styling multiplies
        opacity by `fade × strength` (`emitStyledStroke`);
      · hatch LOD: **complete levels only, snapped to the nearest** (atlas
        `levelFor` rounds; `dyadicLadder` likewise) — and the **analytic hatch
        fields now sit on dyadic iso-parameter ladders**
        (`dyadicLadder`/`tagCurve`, `src/primitives/hatch-field.ts`; wired into
        cylinder/cone/torus/sphere/ellipsoid): iso-values live on a fixed
        dyadic grid so a density change adds/removes complete levels but
        *never moves or renames* existing curves — this kills the per-frame
        respacing of all five analytic fields, with per-curve fraction keys
        for wobble seeding. **Fractional LOD fades were tried and rejected**:
        a partially-arrived interleaving level reads as a periodic artifact in
        any channel — opacity fades banded gray/black, weight fades banded
        thick/thin, staggered line-by-line arrival made pair/gap spacing (all
        three observed on gallery 12/15). Sparse, individually visible hatch
        lines must come in complete levels; smoothing a *zoom-driven level
        switch* is future session-side work (a short temporal crossfade), not
        a per-frame concern. The mesh's px→world spacing probe now measures
        along the camera right axis at the bounds centre, so an orbit at
        constant distance cannot jitter the demand across a level boundary;
      · consolidation: merged strokes now carry an identity anchored on their
        minimal member id (`MergedLine.memberIds`) — a persistent id when a
        `FrameSession` drives.
      Not done (deliberately): tone-quantization hysteresis — region tone is
      light-driven and static under camera animation; revisit when lights or
      geometry animate. Verified: `test/threshold-fades.test.ts`,
      `test/hatch-coherence.test.ts` (ladder suites); gallery regenerated +
      visually checked.
   6. ✅ **Animation verification harness** — `examples/animation.krbn.ts`: a
      60-frame, 120° camera orbit of a mixed analytic + mesh scene (wobble,
      hatch, abstraction, suggestive contours all on) rendered through a
      `FrameSession`. It default-exports a `film(...)` — a sequence of frames,
      each an ordinary `Drawing` — so the render CLI writes
      `examples/animation/frame-###.svg` + a `flipbook.html` viewer that
      references them (scrub/play). Output directory is gitignored — regenerate
      with `bun run render examples/animation.krbn.ts`. Property
      tests (`test/animation-coherence.test.ts`): zero id churn between
      adjacent frames, identical persistent-id sets across the orbit, small
      camera step ⇒ bounded stroke displacement (<5 px), steady hatch volume
      (no re-deal), and two fresh sessions over the same path emit
      byte-identical SVG.

   **Phase 2 item 6 is complete.** Remaining before "Phase 2 done": nothing in
   this item — see the deferred list (contour Newton-projection, group
   highlight) and the cross-cutting ⬜ items (alpha).

## Cross-cutting

- ✅ **Seeded/deterministic wobble** (`src/pipeline/wobble.ts`; anchored to
  object-space arclength; bends outlines **and** hatch from one knob).
- ✅ **Variable stroke width** (`src/pipeline/width.ts`; filled ribbons =
  emphasis × camera-depth × taper × pressure).
- ✅ **Temporal-coherence discipline** — stable identity end to end: canonical
  chains + persistent ids via `FrameSession`, identity-keyed wobble seeds, static
  hatch atlases/ladders, stateless threshold fades; verified by the animation
  harness.
- ✅ **SVG-first backend** (`src/backend/svg.ts`).
- ✅ **Adaptive analytic-curve sampler** (`curve/sample.ts`) — the shared sampling
  everything above leans on.
- ✅ **Authoring & output** — a scene is a `*.krbn.ts` file that default-exports a
  `Drawing`/`Film` deliverable (`.toSvg()`), composed with the `src/layout` helpers
  (`view`/`grid`/`stack`/`film`/`flipbook`) and shipped to SVG by the `render` CLI;
  element identity is scene-scoped (`src/scene/auto-id.ts`) so output is
  order-independent; the public API splits into core mechanics (`krbn`) and mesh
  shape generators (`krbn/shapes`), documented in [`API.md`](../API.md).
- ⬜ **Optional alpha** — a pure drawing op, not yet built.
