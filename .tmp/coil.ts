import { HalfEdgeMesh } from "/sessions/fervent-compassionate-archimedes/mnt/Krbn/src/mesh/halfedge.js";
import { computeCurvature } from "/sessions/fervent-compassionate-archimedes/mnt/Krbn/src/mesh/curvature.js";
import { StreamlineAtlas } from "/sessions/fervent-compassionate-archimedes/mnt/Krbn/src/mesh/mesh-hatch.js";
import { torusMesh } from "/sessions/fervent-compassionate-archimedes/mnt/Krbn/src/mesh/shapes.js";
const he = HalfEdgeMesh.build(torusMesh(1.1, 0.45, 40, 20));
const curv = computeCurvature(he);
const b = 0.25 * Math.hypot(3.1, 3.1, 0.9); // atlasBaseSpacing
console.log("baseSpacing", b.toFixed(3), "| tube diameter", 0.9, "| poloidal circumference", (2*Math.PI*0.45).toFixed(2));
const atlas = new StreamlineAtlas(he, curv, b, 0);
for (const level of [0, 1, 2, 3]) {
  const curves = atlas.curvesFor(b / 2 ** level);
  const newest = curves.filter(c => c.key!.startsWith(`m0:${level}:`));
  const arc = (s: {p:[number,number,number]}[]) => { let a=0; for (let i=1;i<s.length;i++) a+=Math.hypot(s[i]!.p[0]-s[i-1]!.p[0], s[i]!.p[1]-s[i-1]!.p[1], s[i]!.p[2]-s[i-1]!.p[2]); return a; };
  console.log("level", level, "sep", (b/2**level).toFixed(3), "2*dTest", (2*0.85*b/2**level).toFixed(2),
    "curves", newest.length, "arcs", newest.map(c => arc(c.samples as any).toFixed(1)).join(" "));
}
