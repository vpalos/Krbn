# Ideas — food for thought

Not a roadmap and not commitments: a corner for ideas worth keeping, sparked by
early feedback from colleagues and the community (first entries: 2026-07). If
one graduates, it moves to [`ROADMAP.md`](ROADMAP.md). Add yours via GitHub
Discussions.

## Sombrero surface (example)

A sinc / "sombrero" surface as a gallery mesh. Interesting beyond nostalgia
(every plotting package's hello-world): the ripples' inflection zones should
light up **suggestive contours** nicely — and *how* the mesh is built (grid
density, triangulation direction) will visibly change what the curvature
machinery finds. A good showcase and a good stress test in one.

## More shading vocabularies

Today tone = hatch density (single/cross/triple). Other pencil idioms are, in
concept, pure stage-4/2D work — the geometry, visibility, and direction fields
they'd ride on already exist:

- **Stippling / point shading** — tone as dot density instead of line density.
  Natural fit as an alternate `HatchStrategy` (the strategies are already
  pluggable); could reuse the direction field for dot *placement* flow.
- **Tonal gradients** — continuous density modulation along a stroke or across
  a region, instead of quantized tone steps.

## Variable width without filled ribbons (stroke bands)

Variable stroke width renders today as a filled *ribbon* — the centreline offset by
±w/2 into a closed `<path fill>` ([`src/backend/svg.ts`](../src/backend/svg.js)
`ribbon()`). That offset can self-intersect where the half-width exceeds the local
radius of curvature — suspected in the denser mesh-import figures, and now
A/B-testable since `variableWidth: false` toggles ribbons off (DESIGN §4): if the
artifacts vanish with plain lines, they were ribbon self-intersection.

An alternative *screen* renderer for the same width channel: **piecewise-constant
stroke bands** — quantize the per-vertex width into a few levels, split the polyline
at level boundaries, and emit one round-capped `<polyline stroke-width=…>` per band.
Never self-intersects (round caps, no offset geometry), and stays light if width is
quantized to ~3–4 levels. It lives entirely behind the emit contract as a backend
option (`SvgOptions.widthMode: "ribbon" | "bands"`); `RenderStroke.width` is
unchanged, so nothing upstream moves.

Two things to get right, both already solved elsewhere in the codebase:

- **Semi-transparent seams.** Overlapping round caps would double-darken a ghost
  run — except we already flatten per-stroke opacity with a `<g opacity>` group (the
  highlight halo, `SvgGroup`): draw a stroke's bands opaque inside one group and the
  ghost opacity applies once over their union, reproducing ribbon compositing exactly
  (no self-compound within a stroke, normal alpha across strokes).
- **True taper.** A ribbon tapers to a fine point; bands floor at the round-cap
  radius. Cosmetic — shrink the end bands to approximate.

Explicitly **not** a plotter feature: a single-pen plotter ignores `stroke-width`
outright (that path is the shipped constant-line mode, `variableWidth: false`). This
is a screen/print convenience — build it only once a ribbon artifact is confirmed.

## Colored pencils

Per-object ink color is the easy half (a style property flowing to emit — the
backend already draws; it just always draws in one ink). The interesting half
is **data-driven color**: height maps, curvature maps, per-feature semantic
color (the importance model already carries the semantics). Constraint to
respect: color must stay a *stroke* property — tinted ink, colored pencils —
never a fill/shading model through the back door. Transparency-without-alpha
and strokes-not-surfaces remain the ethos.

## Mesh import — STL + OBJ loaders (shipped ✅)

**Both have landed** — `parseSTL` and `parseOBJ` in
[`src/mesh/loaders.ts`](../src/mesh/loaders.js), pure `bytes → MeshInput` decoders
behind the existing seam (`Mesh` eats a `MeshInput`; nothing downstream changed).
`parseSTL` auto-detects binary + ASCII (exact size formula, not the header),
repairs winding against each facet's stored normal, and returns unwelded soup
(welded via `weldEps`). `parseOBJ` reads the geometry subset (`v`/`f`, all index
forms, 1-based/negative indices, fan-triangulated quads/n-gons) and keeps OBJ's
shared vertex table, so topology comes for free. Both drop degenerate faces;
welding tolerance (`BuildOptions.weldEps`) doubles as the decimation knob (coarse
welding now drops faces it collapses). See
[`examples/importers/`](../examples/importers) (`bun run render:importers` — STL:
cube + heart; OBJ: mushroom + Hanoi + fist) and [`API.md`](../API.md).

Documented caveat, not solved: real CAD/scan meshes are often non-manifold;
`weldEps` fixes most of it, "your mesh may need cleanup" covers the rest. Room to
grow if wanted: an `.mtl`-driven per-object ink color (ties into the "colored
pencils" idea below), or a structure-preserving decimation (quadric error metrics)
as an alternative to weld-based coarsening.

Original champion use case, proposed by
[u/ShelfordPrefect](https://www.reddit.com/user/ShelfordPrefect/) in the launch
thread: a plotter owner drawing a **self-portrait of the plotter from its own CAD
model**.

## BVH for mesh visibility raycasts (**shipped ✅**)

The mesh regime's performance wall was reported from outside the project by
[@HowdyKeith](https://github.com/HowdyKeith)
([discussion #1](https://github.com/vpalos/Krbn/discussions/1)): render time
**quadratic in triangle count** (904 tri → 4s, 1,732 → 14s, 2,608 → 34s,
10,520 → timed out past 800s), with a **shape-dependent constant** (~1.4× for
curvature-heavy surfaces vs limb-like ones at equal count — silhouette density
is where the work concentrates). Cause: visibility rays walked every triangle,
and silhouette length grows with density too.

**Fixed** by a bounding-volume hierarchy under the mesh raycasts
([`src/mesh/bvh.ts`](../src/mesh/bvh.ts), consumed by `Mesh.raycast`). Measured
before/after with [`bun run bench:bvh`](../scripts/bench-bvh.ts):

| model | tris | before | after | |
|---|---|---|---|---|
| fist.obj | 18,576 | 67.2 s | **3.2 s** | 20.8× |
| heart.stl | 13,060 | 26.7 s | **1.3 s** | 20.0× |
| torus 104×52 | 10,816 | 4.9 s | **0.29 s** | 17.1× |
| sphere 64×44 | 5,504 | 1.9 s | **0.09 s** | 21.7× |

Two corrections to the original write-up, both worth keeping:

- **The exponent is scene-dependent, not a constant of the engine.** A
  *shape-controlled* sweep (one model, decimated to rising densities, so triangle
  count is the only variable) measures **k = 1.1–1.4 pre-BVH**, not 2.0 — and
  ~1.0 lower after. Fitting across *different* models, as is tempting, conflates
  shape with count and measures nothing in particular. The external k≈2.0 came
  from a heavier scene config than this harness uses; both are real, which is the
  point.
- **The BVH does not remove the residual.** It collapses the per-ray factor to
  log N; feature count, hatch samples, and silhouette density all still grow with
  density. Post-BVH exponents land at k = 0.5–0.95, not 0 — expected, and inherent.

The acceptance test was the one this file specified: render the gallery before
and after, byte-compare every SVG. **Zero diffs** across 22 gallery + 4 importer
SVGs and 121 animation frames — plus a `setBvhMode("verify")` sweep that runs
both the accelerated and brute-force paths on *every* raycast in every shipped
scene and throws on divergence. It is pure culling in front of an unchanged
Möller–Trumbore, so exactness and determinism are untouched.

Two subtleties that were not obvious going in, both documented at length in
`bvh.ts` (they will bite anyone who touches it):

- **A tight triangle box is not a safe filter.** When the true line misses the
  box by an ulp, MT's *computed* barycentrics can still round into range and
  accept — so the box must be padded (`EPS_BVH_PAD_REL`), uniformly and
  absolutely, since a *relative* pad is exactly zero on an axis-aligned triangle.
- **The textbook `1/dir` slab test has a NaN false-miss bug**, and the well-known
  operand-ordering fix repairs only one side of it. Branching on a per-ray
  `d[k] === 0` flag makes NaN unreachable by construction.

Natural next steps, neither of which touches the residual above: a **scene-level
BVH** over source AABBs (skip whole sources in `isOccluded`), and memoizing
`sceneSphere` in `visibility.ts`, which currently re-unions every source's AABB on
every single occlusion test.

## Temporal *de*coherence as a style

The coherence machinery exists so lines **don't** boil. Which means boiling is
now *opt-in* rather than a bug — and deliberate re-seeding is a legitimate
aesthetic (the rotoscoped jitter of a-ha's "Take on Me"). Plausibly one knob:
a re-seed interval (jitter every N frames, N=1 for full boil), per element,
riding the same seeded-wobble infrastructure. The cheap kind of feature: the
hard work is done, the style is a policy on top.
