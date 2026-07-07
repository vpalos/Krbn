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

## Colored pencils

Per-object ink color is the easy half (a style property flowing to emit — the
backend already draws; it just always draws in one ink). The interesting half
is **data-driven color**: height maps, curvature maps, per-feature semantic
color (the importance model already carries the semantics). Constraint to
respect: color must stay a *stroke* property — tinted ink, colored pencils —
never a fill/shading model through the back door. Transparency-without-alpha
and strokes-not-surfaces remain the ethos.

## Mesh import — STL/OBJ loaders

Making a mesh out of an import file: the highest benefit-to-effort item on
this list. The seam is already shaped for it — `Mesh` eats a `MeshInput`
(`positions` + `triangles`), and `BuildOptions.weldEps` already handles the
one thing STL needs most (STL is unwelded triangle soup; welding reconstructs
the shared topology that creases and silhouette chaining depend on).

Sketch: a new `src/mesh/loaders.ts` with pure `parseSTL(buffer): MeshInput`
(binary ~40 lines: 80-byte header, uint32 count, 50 bytes/facet; ASCII
detection +30) and, later, `parseOBJ(text): MeshInput` (the useful subset:
`v`/`f`, negative indices, fan-triangulated quads; ~70 lines). One robustness
touch: STL stores each facet's normal — flip any triangle whose winding
disagrees, since CAD exports are sloppy and the pipeline assumes CCW-outward.
Zero dependencies, zero downstream changes. Caveat to document, not solve:
real CAD STLs are often non-manifold; `weldEps` fixes most of it, "your mesh
may need cleanup" covers the rest.

Afternoon-sized, tests included (binary/ASCII detection, empty input,
degenerate triangles, a winding-flip case). First champion use case, proposed
by [u/ShelfordPrefect](https://www.reddit.com/user/ShelfordPrefect/) in the
launch thread: a plotter owner drawing a **self-portrait of the plotter from
its own CAD model**.

## Temporal *de*coherence as a style

The coherence machinery exists so lines **don't** boil. Which means boiling is
now *opt-in* rather than a bug — and deliberate re-seeding is a legitimate
aesthetic (the rotoscoped jitter of a-ha's "Take on Me"). Plausibly one knob:
a re-seed interval (jitter every N frames, N=1 for full boil), per element,
riding the same seeded-wobble infrastructure. The cheap kind of feature: the
hard work is done, the style is a policy on top.
