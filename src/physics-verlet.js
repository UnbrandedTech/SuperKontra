/**
 * Positional Verlet — particles + distance constraints. Useful for
 * ropes, cloth, soft bodies, hair, chains. Each particle stores its
 * current and previous position; "velocity" is implicit (x - px).
 *
 * Solver loop:
 *   1) integrate gravity into each non-pinned particle (x → 2x - px + a·dt²)
 *   2) iterate `iterations` times over every link, snapping each
 *      pair to its rest length. more iterations = stiffer cloth.
 *
 * Distinct from `physics-rigid` — Verlet doesn't model mass,
 * friction, or restitution. Particles aren't bodies; they're points
 * connected by springs (with infinite stiffness, basically). Use
 * for visual effects, not collision response.
 */

/**
 * @param {Object} [opts]
 * @param {{x: number, y: number}} [opts.gravity={x:0,y:0}]
 * @param {number} [opts.iterations=8] - constraint solver iterations
 *   per step. higher = stiffer / more accurate but more CPU.
 */
export function Verlet(opts = {}) {
  const points = [];
  const links = [];
  const gravity = opts.gravity ?? { x: 0, y: 0 };
  const iterations = opts.iterations ?? 8;

  /**
   * Add a particle at (x, y).
   * @param {number} x
   * @param {number} y
   * @param {{pinned?: boolean}} [attrs]
   */
  function point(x, y, attrs = {}) {
    const p = {
      x,
      y,
      // px/py = previous position; equal to current = zero initial
      // velocity. set them apart to give a particle some starting v.
      px: x,
      py: y,
      pinned: !!attrs.pinned,
      ...attrs
    };
    points.push(p);
    return p;
  }

  /**
   * Connect two particles with a distance constraint. If
   * `restLength` is omitted, the current distance is used.
   */
  function link(a, b, restLength) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = restLength ?? Math.hypot(dx, dy);
    const l = { a, b, length };
    links.push(l);
    return l;
  }

  function step(dt) {
    const ax = gravity.x * dt * dt;
    const ay = gravity.y * dt * dt;

    // 1) integrate
    for (const p of points) {
      if (p.pinned) {
        // pinned particles get their previous position locked to
        // the current — otherwise residual implicit velocity from
        // a pre-pin update would carry into the next step
        p.px = p.x;
        p.py = p.y;
        continue;
      }
      const tx = p.x;
      const ty = p.y;
      // standard Verlet: x' = x + (x - px) + a·dt²
      p.x += p.x - p.px + ax;
      p.y += p.y - p.py + ay;
      p.px = tx;
      p.py = ty;
    }

    // 2) iterate constraints. order is independent (Gauss-Seidel
    // style — each correction sees the latest positions).
    for (let i = 0; i < iterations; i++) {
      for (const l of links) {
        const dx = l.b.x - l.a.x;
        const dy = l.b.y - l.a.y;
        const dist = Math.hypot(dx, dy);
        if (dist === 0) continue;
        // fraction of the correction each end gets — pinned ends
        // contribute 0, free ends contribute 1; normalize so they
        // sum to 1
        const aFree = l.a.pinned ? 0 : 1;
        const bFree = l.b.pinned ? 0 : 1;
        const sum = aFree + bFree;
        if (sum === 0) continue; // both pinned — can't satisfy
        const diff = (dist - l.length) / dist;
        const aShare = aFree / sum;
        const bShare = bFree / sum;
        l.a.x += dx * diff * aShare;
        l.a.y += dy * diff * aShare;
        l.b.x -= dx * diff * bShare;
        l.b.y -= dy * diff * bShare;
      }
    }
  }

  return { points, links, gravity, point, link, step };
}
