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

## Temporal *de*coherence as a style

The coherence machinery exists so lines **don't** boil. Which means boiling is
now *opt-in* rather than a bug — and deliberate re-seeding is a legitimate
aesthetic (the rotoscoped jitter of a-ha's "Take on Me"). Plausibly one knob:
a re-seed interval (jitter every N frames, N=1 for full boil), per element,
riding the same seeded-wobble infrastructure. The cheap kind of feature: the
hard work is done, the style is a policy on top.
