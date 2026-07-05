# Numerical robustness — `src/curve/` and the visibility stage

The exact-primitive pipeline stands on a robust conic/line intersection kernel.
This is the highest-risk code in the engine. Treat it accordingly.

## Non-negotiables

- **Exactness first.** Intersections are roots of low-degree polynomials, solved in
  closed form where possible. No sampling-based "close enough" intersection in the
  primitive path.
- **Degenerate cases are the spec, not edge cases.** Every intersector must have
  tests covering, at minimum:
  - line tangent to a conic (double root)
  - near-tangent lines and conics (ill-conditioned, near-double roots)
  - coincident / identical conics
  - concentric or nested conics with no real intersection
  - near-parallel lines
  - empty real intersection (complex roots) returned cleanly, not as NaN
  - points exactly on a curve (t at interval endpoints)
- **Epsilons are explicit and centralized**, never sprinkled as magic numbers.
  Prefer relative/scaled tolerances; document why each threshold exists.
- **Prefer well-conditioned formulations** (e.g. numerically stable quadratic
  solving; avoid catastrophic cancellation). Note the conditioning assumptions in
  comments.

## Testing discipline

- Property-based tests where feasible (round-trip: construct an intersection, then
  recover it; invariance under rigid transforms of the scene).
- A visibility interval's split points must land exactly on projected silhouette
  crossings — assert against analytically known crossings for primitive scenes.
- When a case is genuinely undecidable at a tolerance, fail loudly (typed result /
  explicit "degenerate" outcome), never silently.

See `ai/DESIGN.md` §2.4 (quantitative invisibility) and §5 (the conic kernel as
the critical path).
