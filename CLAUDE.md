# Krbn — working brief for Claude

Krbn is a web engine for non-photorealistic, **pencil-style** rendering of abstract
and technical scenes (math/physics now; medical/organic later). This file is the
onboarding brief. The authoritative design is **`ai/DESIGN.md`** — read it before
any non-trivial work. `ai/ROADMAP.md` holds the phase/build order (it, not this file,
is where the plan lives).

## The mental model (get this right — it's non-obvious)

- Krbn renders **strokes derived from geometry, not shaded surfaces.** Every visual
  requirement is a _policy over the stroke set_, not a lighting model.
- **Transparency is not alpha.** It comes from cross-hatching being inherently
  see-through (gaps reveal ghosted hidden edges behind). Alpha is deferred and
  optional; it is a pure drawing op, never a backend concern.
- **Phase 1 is analytic primitives, and they are exact.** Quadric silhouettes are
  conics; hidden-line visibility is exact. The mesh/organ regime is **Phase 2**,
  deferred, and lives behind the _same_ `FeatureSource` interface.
- **Author supplies semantics, engine supplies mechanics.** Developers mark what
  matters (importance/focus); the engine allocates level of detail accordingly.

## Architecture at a glance

- **`FeatureSource` (`src/scene/feature-source.ts`) is the seam.** Analytic
  primitives and meshes both implement it; nothing downstream of stage 1 knows
  which produced its input.
- **Five-stage per-frame pass:** feature extraction → visibility classification →
  abstraction filter → styling → emit. (design.md §1.2)
- **Static scaffold vs per-frame probe:** view-independent data is computed once;
  keep it that way.
- **The contract types are the stable spine:** `src/pipeline/types.ts` and
  `src/scene/feature-source.ts`. Changes there ripple through every stage — edit
  them deliberately, not incidentally.

## Where code lives

`src/math` vectors, `Mat3`/`Mat4`, `Basis`, `AABB`, `Camera` + projection ·
`src/curve` `Curve`/`Curve2D` carriers, the exact conic kernel (roots, epsilons,
line/conic + screen intersection) + adaptive sampler · `src/pipeline` inter-stage
contract, stage-2 visibility, stage-4 styling (wobble/hatch), emit, render facade ·
`src/scene` the `FeatureSource` seam + `Scene`/element/importance model ·
`src/primitives` analytic primitives (implemented) · `src/backend` renderers
(SVG implemented) · `src/mesh` Phase-2 mesh regime (half-edge scaffold so far) · `examples/` runnable
demos → SVG (`demo.ts` plain, `styled.ts` wobble + hatch).

## Current status & next target

Past scaffold (as of 2026-07-05). **Done and tested:** the core math kernel
(`src/math`), the exact conic kernel (`src/curve` — line–conic + conic–conic via
the pencil/degenerate-split method, the most heavily tested module), the full
analytic **primitive catalog** (`src/primitives`: `Quadric`→`Sphere`/`Ellipsoid`/
`Cylinder`/`Cone`, `Plane`/`Polygon`, `Line`, `ParametricCurve`, `Point`, `Torus`),
and **stage 2 —
exact quantitative invisibility** (`src/pipeline/visibility.ts`: visible/hidden
intervals via analytic silhouette crossings + closed-form depth `raycast`, with a
bisection safety net for grazing cusps), a **runnable emit → SVG backend**
(`src/pipeline/emit.ts`, `src/backend/svg.ts`, `src/pipeline/render.ts`) drawing
ghosted hidden lines, **stage-4 styling** (`src/pipeline/style.ts`, `wobble.ts`,
`width.ts`, `hatch.ts`: per-element style, seeded wobble — which bends outlines
*and* hatch from the one per-element knob — variable stroke width (filled ribbons:
emphasis × camera-depth × taper × pressure), dash/ghost, visibility-clipped
hatching), the **`Scene`/element/importance model** (`src/scene`),
**intersection-curve features** (`src/primitives/intersection.ts`,
`scene.intersect`: quadric∩plane, sphere∩sphere, plane∩plane), and **stage-3
abstraction** (`src/pipeline/abstract.ts`: importance-scaled screen-size
thresholding + tone quantization). **All nine Phase-1 build-order steps are
done**, and the **Phase-1 polish backlog is complete**: cross-primitive
consolidation, cylinder/cone surface hatching, `scene.highlight` (+halo), `Point`,
quadric∩quadric quartics, `Torus`, and **curved hatch direction fields**
(`FeatureSource.hatchField`: cylinder rings+rulings, cone rings+generators, torus
poloidal+toroidal, sphere parallels+meridians, ellipsoid chart iso-ellipses —
each with a diagonal third family for `triple` (45° helices / spiral generators /
(1,1) loops / tilted circles / chart spirals) — exact iso-parameter curves
clipped to the visible surface by `clipHatchField`). Visual checks: the gallery is
a set of standalone `examples/gallery/*.krbn.ts` scene files (each default-exports a
`Drawing` from `src/layout`); regenerate the `*.svg` with `bun run render:gallery` (or
`bun run render <file.krbn.ts>` for one — each renders in its own process, so a
scene is deterministic regardless of how many render together). **Only deferred items remain** before Phase 2: a contour
Newton-projection for sampled silhouettes (Phase-2-adjacent) and group-highlight
(pushed to post-Phase-2). See `ai/ROADMAP.md` for the annotated build order and
`.claude/rules/numerical-robustness.md` for the kernel's robustness bar.

## Rules

- TypeScript **strict**, ESM. Relative imports use the `.js` extension
  (`verbatimModuleSyntax` is on).
- **IMPORTANT: do not cut corners on the hard modules** (feature extraction,
  visibility, abstraction). Do not substitute an approximate/raster shortcut for
  the exact analytic path without raising it first. Exactness is a project value.
- **Keep analytic curves analytic until the emit stage.** Do not sample to
  polylines early — it throws away the exactness the primitive regime exists for.
- **Wobble is a seeded, deterministic style parameter** (seed tied to primitive
  identity). Never re-randomize per frame — that breaks temporal coherence.
- **Wobble and hatch are pluggable strategies** (`WobbleStrategy` / `HatchStrategy`,
  injected via `Scene` options; defaults in `wobble.ts` / `hatch.ts`). Improve or
  swap a layer by editing/replacing its strategy — don't reach across layers.
- Keep the backend behind the emit stage; SVG is the first target.
- Verify changes with `bun run typecheck`, `bun test`, `bun run build`.
- Propose a short plan before non-trivial or multi-file work.

## Sandbox setup (ephemeral AI/CI Linux shells) — READ FIRST if using bun

The isolated sandbox has Node+npm but **not `bun`**, and this project runs
everything through bun. Before running any `bun …` command in a fresh sandbox,
bootstrap it once:

```bash
bash scripts/setup-sandbox.sh
```

This repoints npm's global prefix to `$HOME/.npm-global` (the default `/usr`
prefix is not writable → `EACCES`) and installs bun there. It's idempotent, so
running it at the start of a session is safe and near-instant if bun is present.

**Every shell call is independent and does NOT source `~/.bashrc`**, so bun won't
be on `PATH` automatically. Prefix bun commands (or export once per call):

```bash
export PATH="$HOME/.npm-global/bin:$PATH"
bun test   # etc.
```

npm itself is not blocked — it reaches the registry fine; the only issues were the
unwritable global prefix and bun not being preinstalled.

## Phase 2 — mesh/organ regime (underway)

The mesh `FeatureSource` is one more implementation of the same seam. **Steps 1–2
done:** the static half-edge scaffold (`src/mesh/halfedge.ts`, `shapes.ts`) —
topology + normals + dihedral + crease/boundary tags — and **curvature precompute**
(`src/mesh/curvature.ts`: Rusinkiewicz principal curvatures + directions + the
`dcurv` derivative tensor, validated on plane/sphere/cylinder), and the
**silhouette zero-set + chaining** (`src/mesh/silhouette.ts`: g=n·toEye with
interpolated normals, Hertzmann–Zorin crossings through faces, chained into ordered
loops/paths), and the **`Mesh` `FeatureSource`** (`src/mesh/mesh-source.ts`:
extractFeatures = silhouette + chained creases + boundaries; projectedSilhouettes;
Möller–Trumbore raycast) — so a **mesh now renders end-to-end through the existing
pipeline with hidden-line visibility, wobble, variable width, and shading**
(`gallery/13`), no fork. **Visibility is an exact depth-buffer test** (`isOccluded`
casts eye→pixel with the origin re-conditioned near the scene bounding sphere so
analytic quartics keep their roots, and occludes iff a surface is hit strictly
nearer than the point — no ray-nudge). A source's own hits are "self" up to a
per-owner depth tolerance: a small floor (`EPS_NUDGE_REL·scale`) for smooth
surfaces (a raycast's grazing tangent root is only good to ~that — a torus is a
quartic), widened to `selfNudge()` (≈0.75× edge length) for a faceted mesh.
Occlusion by other sources is exact.
**Suggestive contours** are in
(`src/mesh/suggestive.ts`, DeCarlo et al.: front-facing zero-set of radial
curvature with D_w κ_r > threshold, opt-in via `new Mesh(input, { suggestive })`,
drawn as lighter form lines; `gallery/14`), and a **curvature-driven mesh hatch
field** (`src/mesh/mesh-hatch.ts`: evenly-spaced Jobard–Lefebvre streamlines of the
principal-direction field, returned via `Mesh.hatchField`; empty on isotropic
surfaces so the scene falls back to straight hatch). **Temporal coherence is
complete** (Phase-2 item 6, all six sub-steps ✅ — full record in
`ai/ROADMAP.md`). The pieces: the **identity spine** — `Feature.id` in the
stage-1 contract; mesh chains canonically oriented (an intrinsic
positive-g-side vote, so camera motion cannot flip a stroke's parameterization
outside topological events) and anchor-keyed on their minimal crossed edge
(`ZeroSetChain`/`VertexChain`, `src/mesh/silhouette.ts`); deterministic
`${owner}/${type}:${n}` fallback ids for analytic sources
(`src/pipeline/identity.ts`). The **frame session + correspondence** —
`FrameSession` (`src/scene/session.ts`) wraps a `Scene` via the
`reconcileFeatures` seam (per-frame pipeline stays pure; all cross-frame state
lives in the session), matches features frame-to-frame (anchor continuity,
then gated nearest-centroid), rewrites `Feature.id` to session-lifetime
persistent ids, reverses event-flipped chains in place (confidence-gated
global tangent vote), and reports born/died/reversed. **Hatch coherence** — a
static object-space `StreamlineAtlas` (`src/mesh/mesh-hatch.ts`; the camera
only picks a density level, never re-seeds), object-anchored straight-hatch
phase (`HatchRegion.anchorPx`), per-line wobble seeds keyed on stable line
identity, and dyadic iso-parameter ladders for all five analytic `hatchField`
primitives (`dyadicLadder`, `src/primitives/hatch-field.ts`: density changes
add/fade curves, never move them). **Stateless threshold fades** —
`Stroke.fade` (abstraction cull band), `Feature.attrs.strength` (suggestive
`D_w κ_r` margin), and consolidation-merged strokes anchored on their minimal
member id; hatch LOD deliberately does **not** fade — it snaps to complete
levels (a partial interleaving level reads as a periodic artifact in any fade
channel; see ROADMAP item 6.5). **The
animation harness** — `examples/animation.krbn.ts` (a `film(...)` of frames, each
an ordinary `Drawing`, driven by a `FrameSession`; `bun run render` it →
`examples/animation/` frame SVGs + a flipbook.html, gitignored; zero churn end
to end) and `test/animation-coherence.test.ts` (no id churn, bounded per-step
displacement, byte-identical replays). For animated output, drive rendering
through a `FrameSession`; keep new sources behind the *same* `FeatureSource`
interface; do not fork the pipeline.

## Deferred — don't build unless asked

Alpha compositing, paper grain. Both are roadmapped in `ai/DESIGN.md`.
