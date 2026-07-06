// Phase-2 step 3: the mesh silhouette as an interpolated zero-set, chained into
// ordered polylines (ai/DESIGN.md §3.3.3–4).
//
// Define g(v) = n(v) · (direction toward the eye) at each vertex, using the
// *interpolated* vertex normal. The silhouette is the zero set of g. Interpolating
// g linearly inside each triangle and taking the zero crossing that passes
// *through* the face (Hertzmann–Zorin) gives a contour that moves continuously as
// the camera moves — unlike the per-edge "staircase" sign test.
//
// A crossed triangle contributes exactly one segment (a triangle's three vertex
// signs change an even number of times around its boundary → 0 or 2 crossed
// edges). The crossing point on a shared mesh edge is identical from both incident
// faces, so we key nodes by the undirected edge and chain the per-face segments
// through those shared nodes — the mandatory ordered-chain step consolidation and
// visibility need.

import type { Camera, Vec3 } from "../math/types.js";
import { addScaled, dot, normalize, sub } from "../math/vec3.js";
import { cameraFrame } from "../math/camera.js";
import type { HalfEdgeMesh } from "./halfedge.js";

/** g(v) = n(v) · toEye(v); the silhouette is its zero set. Positive = front-facing. */
function viewSignal(mesh: HalfEdgeMesh, cam: Camera): Float64Array {
  const g = new Float64Array(mesh.vertexCount);
  const persp = cam.projection === "perspective";
  const fwd = cameraFrame(cam).forward;
  const toEyeOrtho: Vec3 = [-fwd[0], -fwd[1], -fwd[2]];
  for (let v = 0; v < mesh.vertexCount; v++) {
    const p = mesh.positions[v]!;
    const toEye = persp ? normalize(sub(cam.eye, p)) : toEyeOrtho;
    g[v] = dot(mesh.vertexNormals[v]!, toEye);
  }
  return g;
}

/** Undirected edge key with the lower vertex index first (so both incident faces
 *  agree on the node identity and its crossing point). */
function edgeKey(a: number, b: number): string {
  return a < b ? `${a}_${b}` : `${b}_${a}`;
}

/**
 * Extract the mesh silhouette for `cam` as ordered world-space polylines. Closed
 * contours come back as loops (first point repeated at the end); contours that run
 * into a mesh boundary come back as open paths.
 */
export function silhouetteLoops(mesh: HalfEdgeMesh, cam: Camera): Vec3[][] {
  return zeroSetLoops(mesh, viewSignal(mesh, cam));
}

/**
 * The silhouette of a *faceted* mesh (a polyhedron with hard edges). Here the
 * interpolated zero-set is the wrong tool — averaged corner normals make it wander
 * across the flat faces instead of landing on the edges. The exact contour of a
 * polyhedron is simply the set of edges whose two faces disagree on facing (one
 * front, one back); a silhouette edge is therefore always a real mesh edge (a
 * crease). Returned as ordered world-space polylines (loops for a closed solid).
 */
export function facetedSilhouetteLoops(mesh: HalfEdgeMesh, cam: Camera): Vec3[][] {
  const P = mesh.positions;
  const persp = cam.projection === "perspective";
  const fwd = cameraFrame(cam).forward;
  const toEyeOrtho: Vec3 = [-fwd[0], -fwd[1], -fwd[2]];

  // per-face facing sign, from the flat face normal at the face centroid
  const front = new Int8Array(mesh.faceCount);
  for (let f = 0; f < mesh.faceCount; f++) {
    const t = mesh.triangles[f]!;
    const a = P[t[0]!]!, b = P[t[1]!]!, c = P[t[2]!]!;
    const centroid: Vec3 = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
    const toEye = persp ? normalize(sub(cam.eye, centroid)) : toEyeOrtho;
    front[f] = dot(mesh.faceNormals[f]!, toEye) >= 0 ? 1 : -1;
  }

  // interior edges whose two faces flip facing are the silhouette edges
  const edges: Array<[number, number]> = [];
  for (const e of mesh.edges) {
    if (e.boundary || e.halfEdges.length < 2) continue;
    const f0 = mesh.heFace[e.halfEdges[0]!]!;
    const f1 = mesh.heFace[e.halfEdges[1]!]!;
    if (front[f0] !== front[f1]) edges.push([e.v0, e.v1]);
  }
  return chainVertexEdges(edges).map((chain) => chain.map((v) => P[v]!));
}

/** Chain undirected vertex-index edges into ordered vertex sequences, breaking at
 *  endpoints/junctions (degree ≠ 2) so each chain is a simple arc or loop. */
function chainVertexEdges(edges: ReadonlyArray<readonly [number, number]>): number[][] {
  const incident = new Map<number, number[]>();
  const push = (v: number, e: number) => {
    const l = incident.get(v);
    if (l) l.push(e);
    else incident.set(v, [e]);
  };
  edges.forEach((e, i) => {
    push(e[0], i);
    push(e[1], i);
  });
  const degree = (v: number) => (incident.get(v) ?? []).length;
  const used = new Array<boolean>(edges.length).fill(false);
  const other = (e: number, v: number) => (edges[e]![0] === v ? edges[e]![1] : edges[e]![0]);

  const walk = (startV: number, startE: number): number[] => {
    const chain = [startV];
    let v = startV;
    let e = startE;
    for (;;) {
      used[e] = true;
      v = other(e, v);
      chain.push(v);
      if (degree(v) !== 2) break;
      const next = (incident.get(v) ?? []).find((s) => !used[s]);
      if (next === undefined) break;
      e = next;
    }
    return chain;
  };

  const chains: number[][] = [];
  for (const [v, segs] of incident) {
    if (degree(v) === 2) continue;
    for (const e of segs) if (!used[e]) chains.push(walk(v, e));
  }
  for (let e = 0; e < edges.length; e++) if (!used[e]) chains.push(walk(edges[e]![0], e));
  return chains;
}

/**
 * The chained zero-set of a per-vertex scalar field `g` on the mesh — the shared
 * machinery behind both the silhouette (g = n·toEye) and suggestive contours
 * (g = radial curvature). `accept(lo, hi, s)` optionally filters a crossing on
 * edge lo→hi at parameter s (e.g. suggestive contours keep only crossings that are
 * front-facing and have increasing radial curvature); rejected crossings are
 * dropped, so contours are trimmed to the accepted region.
 */
export function zeroSetLoops(
  mesh: HalfEdgeMesh,
  g: Float64Array,
  accept: (lo: number, hi: number, s: number) => boolean = () => true,
): Vec3[][] {
  const P = mesh.positions;
  const positive = (x: number) => x >= 0; // ties (g == 0) count as positive, keeping crossings even

  // crossing point per crossed edge, and the segments (node pairs) per crossed face
  const nodePoint = new Map<string, Vec3>();
  const segA: string[] = [];
  const segB: string[] = [];

  for (let f = 0; f < mesh.faceCount; f++) {
    const t = mesh.triangles[f]!;
    const crossed: string[] = [];
    for (let k = 0; k < 3; k++) {
      const a = t[k]!;
      const b = t[(k + 1) % 3]!;
      if (positive(g[a]!) === positive(g[b]!)) continue; // no sign change on this edge
      const lo = a < b ? a : b;
      const hi = a < b ? b : a;
      const ga = g[lo]!;
      const gb = g[hi]!;
      const s = ga / (ga - gb); // g == 0 crossing along lo→hi
      if (!accept(lo, hi, s)) continue; // filtered out (e.g. wrong side / below threshold)
      const key = edgeKey(a, b);
      if (!nodePoint.has(key)) nodePoint.set(key, addScaled(P[lo]!, sub(P[hi]!, P[lo]!), s));
      crossed.push(key);
    }
    if (crossed.length === 2) {
      segA.push(crossed[0]!);
      segB.push(crossed[1]!);
    }
    // 0 accepted crossings ⇒ nothing here; 1 ⇒ the contour exits the accepted region (dropped)
  }

  // chain segments through shared nodes: build node → incident segment indices
  const incident = new Map<string, number[]>();
  const push = (key: string, seg: number) => {
    const l = incident.get(key);
    if (l) l.push(seg);
    else incident.set(key, [seg]);
  };
  for (let s = 0; s < segA.length; s++) {
    push(segA[s]!, s);
    push(segB[s]!, s);
  }

  const used = new Array<boolean>(segA.length).fill(false);
  const other = (seg: number, node: string) => (segA[seg] === node ? segB[seg]! : segA[seg]!);

  const walk = (startNode: string, startSeg: number): Vec3[] => {
    const keys: string[] = [startNode];
    let node = startNode;
    let seg = startSeg;
    for (;;) {
      used[seg] = true;
      node = other(seg, node);
      keys.push(node);
      const next = (incident.get(node) ?? []).find((s) => !used[s]);
      if (next === undefined) break;
      seg = next;
    }
    return keys.map((k) => nodePoint.get(k)!);
  };

  const chains: Vec3[][] = [];
  // open paths first: start at degree-1 nodes (silhouette meeting a boundary)
  for (const [node, segs] of incident) {
    if (segs.length !== 1) continue;
    const seg = segs[0]!;
    if (!used[seg]) chains.push(walk(node, seg));
  }
  // remaining closed loops
  for (let s = 0; s < segA.length; s++) {
    if (!used[s]) chains.push(walk(segA[s]!, s));
  }
  return chains;
}
