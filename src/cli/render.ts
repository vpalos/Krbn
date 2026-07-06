// render.ts — ship one or more `*.krbn.ts` scene files to SVG.
//
//   bun run render examples/gallery/16-gravity-well.krbn.ts
//   bun run render <file.krbn.ts> [out.svg]     # single file, optional output path
//   bun run render:all                          # every gallery scene
//
// A `*.krbn.ts` default-exports a `Drawing` (see src/layout). This is the whole
// "scene file → deliverable" pipeline: import the module, call the one method the
// contract guarantees (`.toSvg()`), write the bytes beside the source.
//
// Rendering several files in one process is safe: element identity is scene-scoped
// (Scene.add assigns deterministic per-scene ids — see src/scene/auto-id.ts), so a
// scene's wobble never depends on what else was built in the process. No isolation
// needed; a scene renders the same alone or beside any number of siblings.
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Drawing } from "../layout/index.js";

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("usage: render <file.krbn.ts> [out.svg] | render <file...>");
  process.exit(1);
}

// "<file> <out.svg>" is a single render with an explicit output path; otherwise
// every argument is a scene file rendered beside itself.
const explicitOut = args.length === 2 && args[1]!.endsWith(".svg") ? args[1] : undefined;
const inputs = explicitOut ? [args[0]!] : args;

for (const input of inputs) {
  const mod = (await import(pathToFileURL(resolve(input)).href)) as { default: Drawing };
  const out = explicitOut ?? input.replace(/\.krbn\.ts$/, ".svg");
  writeFileSync(out, mod.default.toSvg());
  console.log(`wrote ${out}`);
}
