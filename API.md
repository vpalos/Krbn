# Krbn API — building scenes & animations

A short guide to the public API. Krbn turns **3-D geometry into pencil-style SVG
strokes**: you describe a scene (primitives + a camera + a little semantics), and
the engine derives, hides, styles, and emits the strokes.

## The deliverable model

A scene lives in a `*.krbn.ts` file that **default-exports a deliverable**:

- a **`Drawing`** — one still frame → one `.svg`, or
- a **`Film`** — a sequence of frames → a folder of `frame-###.svg` + a `flipbook.html`.

Render it with the CLI (writes the output beside the source):

```bash
bun run render path/to/scene.krbn.ts     # → scene.svg, or scene/ for a film
bun run render:gallery                    # every examples/gallery/*.krbn.ts
bun run render:animation                  # examples/animation.krbn.ts
```

A `Drawing` is just `{ toSvg(): string }`, so you can also call it directly
(`scene.toSVG(cam)`), embed the string, or ship it however you like.

## A still, end to end

```ts
// hello.krbn.ts   →   bun run render hello.krbn.ts   →   hello.svg
import { Scene, sphere, Cylinder, view, type Camera } from "krbn";

const cam: Camera = {
  eye: [4, 3, 2], target: [0, 0, 0], up: [0, 0, 1],
  projection: "perspective", scale: Math.PI / 4,
  viewport: { width: 640, height: 480 },
};

const scene = new Scene({
  svg: { background: "#faf9f5" },
  light: { direction: [-0.4, -0.5, -0.7] },
});

scene.add(sphere([0, 0, 0], 1))
  .style({ wobble: 0.3, hatch: { mode: "cross", angle: 20 } });

scene.add(new Cylinder([1.6, 0, -1], [0, 0, 2], 0.5))
  .setImportance(0.3, { role: "context" });     // quieter, ghosted

export default view(scene, cam);                 // a Drawing
```

## Building a scene

**Camera** — `{ eye, target, up, projection: "perspective" | "orthographic",
scale, viewport: { width, height } }`. `scale` is the half-FOV (radians) for
perspective, world-units-per-pixel for orthographic. Points are `[x, y, z]`.

**`new Scene(opts?)`** options: `light: { direction }`, `svg: { background }`,
`style` (scene-wide default style), `abstraction: { toneLevels?, minFeaturePx?,
consolidate? }`.

**Primitives** (each returns a source you pass to `scene.add`):

| Primitive | Constructor |
|---|---|
| Sphere | `sphere(center, radius)` |
| Ellipsoid | `ellipsoid(center, [rx, ry, rz])` |
| Cylinder | `new Cylinder(base, axis, radius)` |
| Cone | `new Cone(apex, axis, radius)` |
| Torus | `new Torus(center, axis, majorR, minorR)` |
| Line | `new Line(a, b)` |
| Polygon | `new Polygon([v0, v1, …])` |
| Point | `new Point(pos, { mark: "cross" \| "dot", sizePx })` |
| Bézier | `new BezierCurve([p0, p1, p2, p3])` |
| Helix | `helix(center, radius, pitch, turns)` |
| Function plot | `functionPlot(x => y, x0, x1)` |
| Mesh | `new Mesh(input, opts?)` — see [Meshes](#meshes) |

**Add & configure.** `scene.add(source, opts?)` returns an `Element` you can chain:

```ts
scene.add(sphere([0, 0, 0], 1))
  .setImportance(1, { role: "subject" })         // subject | context | default
  .style({
    wobble: 0.4,                                 // 0 = ruler, ~1 = hand-drawn
    weight: 1.6,                                 // stroke width
    hidden: "ghost",                             // "ghost" (x-ray) | "drop" (opaque)
    hatch: { mode: "cross", angle: 20, spacingPx: 8, field: true },
  });
```

Hatch `mode` is `"single" | "cross" | "triple"` (1/2/3 tonal layers); `field: true`
(default) uses the surface's exact curved iso-parameter field, `false` forces
straight parallels. `importance`/`role` drive the abstraction stage (how much
detail to keep) and supply styling defaults.

**Relations.**

```ts
const a = scene.add(sphere([0, 0, 0.5], 1));
const b = scene.add(new Polygon([[-2,-2,0],[2,-2,0],[2,2,0],[-2,2,0]]));
scene.intersect(a, b, { emphasis: "bold" });     // exact waterline curve

scene.highlight(a, { weight: 1.8, dashWhenHidden: true,
                     halo: { weight: 12, opacity: 0.28 } });
```

## Composing figures

Panels are just SVG strings (`scene.toSVG(cam)`); the layout helpers stitch them
into one labelled `Drawing`:

```ts
import { grid, stack, raw, textAt, withLabels } from "krbn";

grid(cam.viewport, rows /* string[][] */, { rowLabels, colLabels });
stack(topSvg, bottomSvg, cam.viewport, { top: "before", bottom: "after" });
raw(withLabels(scene.toSVG(cam), [textAt(cam, [0,-1.2,0], "label")]));
```

## Meshes

A triangle mesh is just another source, rendered through the same pipeline.

```ts
import { Mesh } from "krbn";
import { torusMesh, gravitySheet } from "krbn/shapes";

scene.add(new Mesh(torusMesh(1.3, 0.5), { suggestive: { threshold: 0.02 } }));
scene.add(new Mesh(gravitySheet(3, 72, 1.7, 0.95)));
```

`MeshInput` is `{ positions: Vec3[], triangles: [number, number, number][] }` —
bring your own geometry, or use the starter generators in **`krbn/shapes`**
(`cube`, `tetrahedron`, `uvSphere`, `tube`, `torusMesh`, `gravitySheet`,
`bumpyBlob`, `knotTube`, plus `translate` / `rotate`). These are convenience
content, kept off the core API.

## Animations

An animation is a `Film`: a driven sequence of frames, **each an ordinary
`Drawing`** — so everything above composes a frame exactly as it does a still. A
`FrameSession` carries stroke identity across frames (temporal coherence), and
`film(...)` steps the sequence.

```ts
// orbit.krbn.ts   →   bun run render orbit.krbn.ts   →   orbit/frame-###.svg + flipbook.html
import { Scene, sphere, FrameSession, film, raw, type Camera } from "krbn";

const W = 640, H = 480, FRAMES = 60;
const cam = (a: number): Camera => ({
  eye: [9 * Math.sin(a), -9 * Math.cos(a), 3.5], target: [0, 0, 0], up: [0, 0, 1],
  projection: "orthographic", scale: 0.02, viewport: { width: W, height: H },
});

const scene = new Scene({ style: { wobble: 0.6 } });
scene.add(sphere([0, 0, 0], 1.2), { style: { hatch: { mode: "cross", angle: 20 } } });

const session = new FrameSession(scene);
export default film(
  FRAMES,
  (k) => raw(session.render(cam((Math.PI / 1.5) * k / (FRAMES - 1))).svg),
  { viewport: { width: W, height: H }, fps: 12 },
);
```

`film(count, k => Drawing, { viewport?, fps?, onFrame? })` — the optional
`onFrame(k)` hook runs after each frame (progress, coherence reports, …). The CLI
writes the frames + a `flipbook.html` that references them (scrub/play in a
browser). `session.render(cam)` returns `{ svg, strokes, renderStrokes, coherence }`.

## Exports at a glance

**`krbn`** — `Scene`, `FrameSession`; primitives (`sphere`, `ellipsoid`,
`Cylinder`, `Cone`, `Torus`, `Line`, `Polygon`, `Point`, `BezierCurve`, `helix`,
`functionPlot`); `Mesh` + the `MeshInput`/`Tri` types; deliverables & layout
(`view`, `raw`, `grid`, `stack`, `film`, `flipbook`, `textAt`, `withLabels`, and
the `Drawing`/`Film` types); core math types (`Camera`, `Vec3`, …).

**`krbn/shapes`** — mesh generators (`cube`, `uvSphere`, `torusMesh`,
`gravitySheet`, `knotTube`, …) and `translate` / `rotate`.

See [`ai/DESIGN.md`](ai/DESIGN.md) for how the engine works and
[`examples/`](examples) for the full gallery and animation.
