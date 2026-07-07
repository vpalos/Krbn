// Mesh import: file formats → the `MeshInput` contract. Pure and dependency-free
// (no fs, no environment coupling) — the caller reads the bytes, this turns them
// into `{ positions, triangles }`, and `new Mesh(input, { weldEps })` does the
// rest. STL and OBJ, both behind the same seam (docs/IDEAS.md "Mesh import").
//
// The two formats differ in exactly one structural way, which shapes each parser:
//
//   STL is unwelded triangle **soup** — every facet carries its own three vertices
//   with no shared indices — so `parseSTL` returns exactly that soup (3·F
//   positions). Reconstructing the shared topology creases and silhouette chaining
//   depend on is `weldEps`'s job at `Mesh` build time, left to the caller so the
//   loader stays a pure decoder. Two robustness touches happen here because they
//   need the raw facet record: **winding repair** (flip any triangle whose
//   geometric normal disagrees with the facet's stored normal — CAD exports are
//   sloppy and the pipeline assumes CCW-outward) and **degenerate drop**.
//
//   OBJ is already **indexed** — a shared vertex table (`v`) plus faces (`f`) that
//   reference it — so `parseOBJ` keeps that table (no soup, topology for free, no
//   weld needed). It has no per-face normal, so there is nothing to repair winding
//   against; OBJ's CCW convention is trusted. Zero-area triangles are still dropped.

import type { Vec3 } from "../math/types.js";
import type { MeshInput, Tri } from "./halfedge.js";
import { cross, dot, length, sub } from "../math/vec3.js";

/** A decoded facet: its stored normal (may be 0,0,0 — many exporters omit it) and
 *  its polygon loop (3 vertices for standard STL; fan-triangulated if more). */
interface Facet {
  normal: Vec3;
  loop: Vec3[];
}

/**
 * Parse an STL (binary or ASCII, auto-detected) into a `MeshInput` triangle soup.
 *
 * Accepts raw bytes (`ArrayBuffer`/`Uint8Array`, e.g. from `readFileSync`) or an
 * ASCII string. The winding of each triangle is repaired against its facet's
 * stored normal and zero-area facets are dropped, so the result is safe to feed
 * straight to `new Mesh(input, { weldEps })` — pick `weldEps` to reconstruct the
 * shared topology (a few thousandths of the model's size is usually right).
 */
export function parseSTL(data: ArrayBuffer | Uint8Array | string): MeshInput {
  if (typeof data === "string") return assemble(parseAsciiSTL(data));
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  return assemble(isBinarySTL(bytes) ? parseBinarySTL(bytes) : parseAsciiSTL(decodeAscii(bytes)));
}

/**
 * Parse a Wavefront OBJ (the geometry subset) into a `MeshInput`.
 *
 * Accepts the text or its raw bytes. Reads `v` (vertices) and `f` (faces),
 * skipping everything else (`vt`/`vn`/`vp`, `g`/`o`/`s`, `usemtl`/`mtllib`,
 * comments). Face vertices may be `v`, `v/vt`, `v/vt/vn`, or `v//vn` — only the
 * vertex index is used; indices are 1-based, and negative indices count back from
 * the vertices seen so far. Faces with more than three vertices (quads, n-gons)
 * are fan-triangulated, and zero-area triangles are dropped.
 *
 * Unlike STL, OBJ ships a shared vertex table, so the topology is already there —
 * `weldEps` is optional (use it only to *decimate*, not to reconstruct adjacency).
 */
export function parseOBJ(data: string | ArrayBuffer | Uint8Array): MeshInput {
  const text = typeof data === "string" ? data : decodeAscii(data instanceof Uint8Array ? data : new Uint8Array(data));
  const positions: Vec3[] = [];
  // Resolve faces after the whole file is read (a face may forward-reference a
  // vertex, and negatives must resolve against the count *at their line*).
  const faces: number[][] = [];
  for (const raw of text.split("\n")) {
    const p = raw.trim().split(/\s+/);
    if (p[0] === "v") {
      positions.push([num(p[1]), num(p[2]), num(p[3])]);
    } else if (p[0] === "f") {
      const face: number[] = [];
      for (let i = 1; i < p.length; i++) {
        const vfield = p[i]!.split("/")[0]!; // "v" from "v", "v/vt", "v/vt/vn", "v//vn"
        const vi = parseInt(vfield, 10);
        if (Number.isNaN(vi)) continue;
        face.push(vi > 0 ? vi - 1 : positions.length + vi); // 1-based, or negative-from-end
      }
      if (face.length >= 3) faces.push(face);
    }
  }
  const triangles: Tri[] = [];
  for (const face of faces) {
    for (let i = 1; i + 1 < face.length; i++) {
      const a = face[0]!, b = face[i]!, c = face[i + 1]!;
      if (a === b || b === c || a === c) continue;
      const pa = positions[a], pb = positions[b], pc = positions[c];
      if (!pa || !pb || !pc) continue; // out-of-range index — skip, don't crash
      if (isDegenerate(cross(sub(pb, pa), sub(pc, pa)), pa, pb, pc)) continue;
      triangles.push([a, b, c]);
    }
  }
  return { positions, triangles };
}

/**
 * Binary detection by the exact size formula: an 80-byte header, a uint32 facet
 * count, then 50 bytes per facet ⇒ `84 + 50·count` bytes total. This is the
 * reliable discriminator — a naïve "starts with `solid` ⇒ ASCII" is the classic
 * trap, since binary exporters routinely write "solid …" into the 80-byte header.
 */
function isBinarySTL(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 84) return false;
  const count = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(80, true);
  return bytes.byteLength === 84 + 50 * count;
}

function parseBinarySTL(bytes: Uint8Array): Facet[] {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = dv.getUint32(80, true);
  const facets: Facet[] = [];
  let o = 84; // skip the 80-byte header + uint32 count
  const v = (): Vec3 => {
    const p: Vec3 = [dv.getFloat32(o, true), dv.getFloat32(o + 4, true), dv.getFloat32(o + 8, true)];
    o += 12;
    return p;
  };
  for (let f = 0; f < count; f++) {
    const normal = v();
    const loop = [v(), v(), v()];
    o += 2; // uint16 attribute byte count (unused)
    facets.push({ normal, loop });
  }
  return facets;
}

function parseAsciiSTL(text: string): Facet[] {
  const facets: Facet[] = [];
  let normal: Vec3 = [0, 0, 0];
  let loop: Vec3[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("facet")) {
      // "facet normal nx ny nz"
      const p = line.split(/\s+/);
      normal = p.length >= 5 ? [num(p[2]), num(p[3]), num(p[4])] : [0, 0, 0];
      loop = [];
    } else if (line.startsWith("vertex")) {
      const p = line.split(/\s+/);
      loop.push([num(p[1]), num(p[2]), num(p[3])]);
    } else if (line.startsWith("endfacet")) {
      if (loop.length >= 3) facets.push({ normal, loop });
    }
  }
  return facets;
}

const num = (s: string | undefined): number => (s === undefined ? 0 : Number(s));

/** Decode header/keyword bytes as Latin-1 (STL ASCII is 7-bit; TextDecoder keeps
 *  it dependency-free and never throws on stray high bytes). */
function decodeAscii(bytes: Uint8Array): string {
  return new TextDecoder("latin1").decode(bytes);
}

/** Turn decoded facets into a `MeshInput` soup: fan-triangulate, drop zero-area
 *  triangles, and flip any triangle whose winding disagrees with its stored
 *  normal so every face is CCW-outward. */
function assemble(facets: Facet[]): MeshInput {
  const positions: Vec3[] = [];
  const triangles: Tri[] = [];
  for (const { normal, loop } of facets) {
    // Fan-triangulate n-gon facets (standard STL is already triangles).
    for (let i = 1; i + 1 < loop.length; i++) {
      const a = loop[0]!;
      const b = loop[i]!;
      const c = loop[i + 1]!;
      const gn = cross(sub(b, a), sub(c, a)); // geometric normal (length = 2·area)
      if (isDegenerate(gn, a, b, c)) continue; // zero-area facet — no orientation
      const base = positions.length;
      positions.push(a, b, c);
      // CCW-outward: keep the winding if the geometric normal agrees with the
      // stored one (or none was stored); otherwise swap two vertices to flip it.
      triangles.push(length(normal) > 0 && dot(gn, normal) < 0 ? [base, base + 2, base + 1] : [base, base + 1, base + 2]);
    }
  }
  return { positions, triangles };
}

/** A triangle is degenerate when its area is negligible relative to its own size —
 *  a scale-free test, so it holds for millimetre CAD parts and metre-scale scans
 *  alike. `length(gn)` is twice the area; the longest edge² sets the scale. */
function isDegenerate(gn: Vec3, a: Vec3, b: Vec3, c: Vec3): boolean {
  const e = Math.max(dist2(a, b), dist2(b, c), dist2(c, a));
  return length(gn) <= 1e-12 * e;
}

const dist2 = (p: Vec3, q: Vec3): number => (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2;
