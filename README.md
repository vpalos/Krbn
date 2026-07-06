# Krbn

**Carbon, with the vowels sketched out.** A web engine for non-photorealistic,
pencil-style rendering of abstract and technical scenes — math and physics
constructions today, medical/organic illustration on the roadmap.

Krbn does not "render surfaces." It derives, classifies, and styles **strokes**
and **hatch regions** from geometry, so a scene reads as if drawn by a technical
artist: ghosted hidden lines, cross-hatched surfaces, emphasized/dashed contours,
and deliberate reduction of detail.

![a ball half-submerged through a hatched plane](examples/gallery/03-depth-hatching.svg)

_More in the [example gallery](examples/README.md)._

> **Status & roadmap** live in one place, not here: **[`ai/ROADMAP.md`](ai/ROADMAP.md)**
> holds the annotated build status and polish backlog, and
> **[`ai/DESIGN.md`](ai/DESIGN.md)** holds the design, the implementation-status
> breakdown, and the hard-parts registry. This README stays high-level.

## Features

Each links to a demo in the [gallery](examples/README.md).

- **Analytic primitives** — sphere, ellipsoid, cylinder, cone, plane, polygon,
  line, points, and a torus, each with an *exact* silhouette (conics; the torus a
  quartic). ([solids](examples/gallery/05-solid-shading.svg),
  [torus](examples/gallery/10-torus.svg))
- **Free-form curves** — helices, Bézier curves (carried exactly as control
  points), and function plots, sampled adaptively and occludable like anything else.
  ([curves](examples/gallery/17-parametric-curves.svg))
- **Triangle meshes** — arbitrary organic geometry renders through the *same*
  pipeline as the primitives, no fork: silhouette, shading, hidden-line, all shared.
  Sharp **creases** on faceted solids are permanent view-independent edges.
  ([knots](examples/gallery/15-mesh-showcase.svg),
  [creases](examples/gallery/18-creases.svg))
- **Exact hidden lines** — every contour is split into visible and hidden runs, the
  hidden parts either ghosted (x-ray) or dropped (opaque) so depth reads at a glance.
  Even points are occludable. ([hidden lines](examples/gallery/01-hidden-lines.svg),
  [ghost vs drop](examples/gallery/19-hidden-modes.svg))
- **Intersection curves** — where two surfaces meet (a ball through a plane, two
  quadrics), the seam is drawn as its own contour.
  ([waterline](examples/gallery/03-depth-hatching.svg),
  [quartic](examples/gallery/08-quartic.svg))
- **Suggestive contours** — the extra "form lines" an artist adds where a surface
  *almost* turns away, read from mesh curvature (DeCarlo et al.).
  ([suggestive](examples/gallery/14-suggestive.svg))
- **Hatching & tone** — single / cross / triple cross-hatch, shaded **light→dark**
  on curved surfaces and left flat on flat faces.
  ([hatching](examples/gallery/02-hatching.svg))
- **Curvature-following hatch** — hatch that flows along a surface's own direction
  field: exact iso-curves on primitives, traced streamlines on meshes.
  ([fields](examples/gallery/12-direction-fields.svg),
  [gravity well](examples/gallery/16-gravity-well.svg))
- **Hand-drawn wobble** — one per-object knob turns ruler-clean lines sketchy; it
  bends outlines and hatch together and stays deterministic.
  ([wobble](examples/gallery/04-wobble.svg))
- **Variable stroke width** — solid lines are pencil-like ribbons: bolder when near
  or important, tapering and swelling with pressure toward the ends.
  ([torus](examples/gallery/10-torus.svg))
- **Abstraction** — detail too small to matter is dropped, tone is quantized, and
  coincident lines merge into one clean stroke.
  ([consolidation](examples/gallery/09-consolidation.svg))
- **Highlight** — x-ray emphasis: a bold outline inside a soft halo, dashed where
  something hides it. ([highlight](examples/gallery/06-highlight.svg))
- **Deterministic SVG** — pure, seeded vector output; the same scene always yields
  the same, diffable file.

## Why it works this way

- **Strokes are the core object.** Every visual requirement is a policy over the
  stroke set, not a shading model.
- **Transparency without alpha.** Cross-hatching is inherently see-through: the
  gaps reveal the ghosted hidden edges behind. Alpha is an optional later add.
- **Analytic primitives first.** For quadrics, silhouettes are exact conics and
  hidden-line visibility is exact — the hardest module is _easier_ here, not
  skipped. Triangle meshes then plug in behind the very same interface.
- **Author supplies semantics, engine supplies mechanics.** The developer marks
  what matters (importance/focus); the engine draws at the right level of detail.

## Architecture at a glance

A scene is a set of `FeatureSource`s. Each frame runs a five-stage pass:

1. **Feature extraction** — silhouettes, creases, boundaries, suggestive &
   intersection curves, plus hatch regions.
2. **Visibility classification** — split each curve into visible/hidden intervals.
3. **Abstraction filter** — drop sub-threshold detail, consolidate, apply importance.
4. **Styling** — weight, seeded wobble (lines + hatch), variable stroke width,
   dash, ghost, hatch density.
5. **Emit** — sample analytic curves and hand to the backend (SVG first).

Full detail, contracts, and the mesh/organ roadmap live in
[`ai/DESIGN.md`](ai/DESIGN.md). A short phase view is in [`ai/ROADMAP.md`](ai/ROADMAP.md).

## Project layout

```
src/
  math/        vectors, Mat3/Mat4, Basis, AABB, Camera + projection/unproject
  curve/       Curve / Curve2D carriers + exact conic kernel, root solvers, sampler
  pipeline/    contract types, visibility, styling (wobble/width/hatch), emit, render
  scene/       the FeatureSource seam + Scene / element / importance model
  primitives/  analytic primitives (Quadric→Sphere/Ellipsoid/Cylinder/Cone, Plane,
               Polygon, Line, ParametricCurve, Point, Torus)
  backend/     renderers — SVG (implemented)
  mesh/        deferred organ/mesh regime — see ai/DESIGN.md §3
examples/    runnable demos → *.svg (demo, styled, waterline)
ai/DESIGN.md the full design & roadmap
```

## Development

```bash
bun install
bun run typecheck
bun run build
bun test
```

## License

MIT — see [`LICENSE`](LICENSE). Update the copyright holder to your name/org.
