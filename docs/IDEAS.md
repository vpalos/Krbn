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

## Temporal *de*coherence as a style

The coherence machinery exists so lines **don't** boil. Which means boiling is
now *opt-in* rather than a bug — and deliberate re-seeding is a legitimate
aesthetic (the rotoscoped jitter of a-ha's "Take on Me"). Plausibly one knob:
a re-seed interval (jitter every N frames, N=1 for full boil), per element,
riding the same seeded-wobble infrastructure. The cheap kind of feature: the
hard work is done, the style is a policy on top.
