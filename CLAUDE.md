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
(SVG implemented) · `src/mesh` deferred Phase-2 regime · `examples/` runnable
demos → SVG (`demo.ts` plain, `styled.ts` wobble + hatch).

## Current status & next target

Past scaffold (as of 2026-07-05). **Done and tested:** the core math kernel
(`src/math`), the exact conic kernel (`src/curve` — line–conic + conic–conic via
the pencil/degenerate-split method, the most heavily tested module), the full
analytic **primitive catalog** (`src/primitives`: `Quadric`→`Sphere`/`Ellipsoid`/
`Cylinder`/`Cone`, `Plane`/`Polygon`, `Line`, `ParametricCurve`), and **stage 2 —
exact quantitative invisibility** (`src/pipeline/visibility.ts`: visible/hidden
intervals via analytic silhouette crossings + closed-form depth `raycast`, with a
bisection safety net for grazing cusps), a **runnable emit → SVG backend**
(`src/pipeline/emit.ts`, `src/backend/svg.ts`, `src/pipeline/render.ts`) drawing
ghosted hidden lines, **stage-4 styling** (`src/pipeline/style.ts`, `wobble.ts`,
`hatch.ts`: per-element style, seeded wobble, dash/ghost, visibility-clipped
hatching), the **`Scene`/element/importance model** (`src/scene`),
**intersection-curve features** (`src/primitives/intersection.ts`,
`scene.intersect`: quadric∩plane, sphere∩sphere, plane∩plane), and **stage-3
abstraction** (`src/pipeline/abstract.ts`: importance-scaled screen-size
thresholding + tone quantization). **All nine Phase-1 build-order steps are
done.** Visual checks: `examples/demo.ts` (plain), `styled.ts` (wobble + hatch),
`waterline.ts` (intersection + abstraction). **Phase-1 polish remaining:**
cross-primitive consolidation, cylinder/cone surface hatching, quadric∩quadric
quartics, `scene.highlight`, torus — then **Phase 2** (mesh regime). See
`ai/ROADMAP.md` for the annotated build order and
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

## Deferred — don't build unless asked

Mesh/organ regime (Phase 2), the declarative authoring language, alpha
compositing, paper grain. All are roadmapped in `ai/DESIGN.md`.
