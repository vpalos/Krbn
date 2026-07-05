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
line/conic intersection) + adaptive sampler · `src/pipeline` inter-stage contract ·
`src/scene` the `FeatureSource` seam (+ Scene model, still to come) ·
`src/primitives` analytic primitives (implemented) · `src/backend` renderers
(SVG first, empty) · `src/mesh` deferred Phase-2 regime.

## Current status & next target

Past scaffold (as of 2026-07-05). **Done and tested:** the core math kernel
(`src/math`), the exact conic kernel (`src/curve` — line–conic + conic–conic via
the pencil/degenerate-split method, the most heavily tested module), and the full
analytic **primitive catalog** (`src/primitives`: `Quadric`→`Sphere`/`Ellipsoid`/
`Cylinder`/`Cone`, `Plane`/`Polygon`, `Line`, `ParametricCurve`), each
implementing `FeatureSource` with closed-form `raycast` + `projectedSilhouettes`.
**Not built yet:** the `Scene`/element/**importance** model, and the runnable
five-stage pass + backend. The next build target is **stage 2 — exact
quantitative invisibility** (visible/hidden intervals); its inputs are already in
place. See `ai/ROADMAP.md` for the annotated build order and
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
- Keep the backend behind the emit stage; SVG is the first target.
- Verify changes with `bun run typecheck`, `bun test`, `bun run build`.
- Propose a short plan before non-trivial or multi-file work.

## Deferred — don't build unless asked

Mesh/organ regime (Phase 2), the declarative authoring language, alpha
compositing, paper grain. All are roadmapped in `ai/DESIGN.md`.
