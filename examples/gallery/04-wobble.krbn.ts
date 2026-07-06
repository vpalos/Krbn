import type { Camera } from "../../src/math/types.js";
import { Scene } from "../../src/scene/scene.js";
import { Cone } from "../../src/primitives/cone.js";
import { view } from "../../src/layout/index.js";

const BG = "#faf9f5";

// ---------------------------------------------------------------------------
// 4. Wobble — the same cone at increasing wobble (0 → 1), showing ruler →
//    hand-drawn. Coherent joins hold at every amount (clean apex, rulings meet
//    rims), because the offset is a seeded field keyed on the 3-D point.
// ---------------------------------------------------------------------------
const cam: Camera = {
  eye: [0, -8, 2.6],
  target: [0, 0, -0.1],
  up: [0, 0, 1],
  projection: "perspective",
  scale: Math.PI / 5,
  viewport: { width: 900, height: 300 },
};
const scene = new Scene({ svg: { background: BG } });
const amounts = [0, 0.35, 0.7, 1.0];
amounts.forEach((w, i) => {
  const x = -3.9 + i * 2.6;
  scene.add(new Cone([x, 0, 1.1], [0, 0, -2.2], 0.8)).style({ wobble: w });
});

export default view(scene, cam);
