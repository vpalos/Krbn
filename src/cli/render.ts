// render.ts — ship one or more `*.krbn.ts` scene files to SVG.
//
//   bun run render examples/gallery/16-gravity-well.krbn.ts
//   bun run render <file.krbn.ts> [out.svg]     # single still, optional output path
//   bun run render:all                          # every gallery still
//
// A `*.krbn.ts` default-exports a deliverable: a `Drawing` (one SVG) or a `Film`
// (a frame sequence). This is the whole "scene file → deliverable" pipeline:
// import the module and write what it produced beside the source — a still writes
// `<name>.svg`; a film writes `<name>/frame-###.svg` + a `flipbook.html` viewer.
//
// Rendering several files in one process is safe: element identity is scene-scoped
// (Scene.add assigns deterministic per-scene ids — see src/scene/auto-id.ts), so a
// scene's wobble never depends on what else was built in the process.
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { flipbook, type Drawing, type Film } from "../layout/index.js";

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("usage: render <file.krbn.ts> [out.svg] | render <file...>");
  process.exit(1);
}

// "<file> <out.svg>" is a single still with an explicit output path; otherwise
// every argument is a scene file rendered beside itself.
const explicitOut = args.length === 2 && args[1]!.endsWith(".svg") ? args[1] : undefined;
const inputs = explicitOut ? [args[0]!] : args;

const isFilm = (d: Drawing | Film): d is Film => Array.isArray((d as Film).frames);

for (const input of inputs) {
  const mod = (await import(pathToFileURL(resolve(input)).href)) as { default: Drawing | Film };
  const d = mod.default;
  if (isFilm(d)) {
    // a sibling folder of frames + a flipbook viewer over them
    const dir = input.replace(/\.krbn\.ts$/, "");
    mkdirSync(dir, { recursive: true });
    for (const f of d.frames) writeFileSync(join(dir, f.name), f.svg);
    writeFileSync(join(dir, "flipbook.html"), flipbook(d));
    console.log(`wrote ${d.frames.length} frames + flipbook.html to ${dir}/`);
  } else {
    const out = explicitOut ?? input.replace(/\.krbn\.ts$/, ".svg");
    writeFileSync(out, d.toSvg());
    console.log(`wrote ${out}`);
  }
}
