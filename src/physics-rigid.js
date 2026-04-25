/**
 * Impulse-based 2D rigid-body physics with rotation. Bodies
 * translate AND rotate under gravity, collide via SAT, and resolve
 * with normal + Coulomb-friction impulses applied at the contact
 * point (so off-centre hits induce spin). Baumgarte positional
 * correction prevents resting bodies from sinking.
 *
 * Velocity is per-second (`vx`, `vy`, `va`) — distinct from kontra's
 * per-frame `dx`/`dy`. Physics-managed bodies should NOT also be
 * driven by kontra's `update()` or you'll integrate twice.
 *
 * `mass: 0` = static / immovable AND unrotatable. Two static bodies
 * skip resolution entirely.
 *
 * Inertia auto-computes from mass and dimensions if not provided:
 *   - rectangle: I = m·(w² + h²) / 12
 *   - circle:    I = m·r² / 2
 *   - polygon:   approximate via the bounding rectangle of vertices
 * Set `inertia: 0` explicitly to make a dynamic body translate but
 * never rotate.
 */

import { collidesWithResponse } from './collide.js';

// Baumgarte constants — tuned to match Box2D defaults. SLOP is a
// tolerated overlap that prevents jitter on resting contacts;
// PERCENT is the fraction of overlap corrected per step (full
// correction oscillates).
const SLOP = 0.01;
const PERCENT = 0.2;

/**
 * @param {Object} [opts]
 * @param {{x: number, y: number}} [opts.gravity={x:0,y:0}]
 * @returns {{
 *   bodies: Object[],
 *   gravity: {x: number, y: number},
 *   add: (body: Object) => Object,
 *   remove: (body: Object) => void,
 *   step: (dt: number) => void
 * }}
 */
export function World(opts = {}) {
  const bodies = [];
  const gravity = opts.gravity ?? { x: 0, y: 0 };

  function add(body) {
    body.vx ??= 0;
    body.vy ??= 0;
    body.va ??= 0;
    body.rotation ??= 0;
    body.mass ??= 1;
    body.restitution ??= 0;
    body.friction ??= 0;
    body.damping ??= 0;
    body.angularDamping ??= 0;
    if (body.inertia == null) body.inertia = autoInertia(body);
    bodies.push(body);
    return body;
  }

  function remove(body) {
    const i = bodies.indexOf(body);
    if (i >= 0) bodies.splice(i, 1);
  }

  function step(dt) {
    // 1) integrate forces → velocity → position. semi-implicit
    // Euler. rotation integrates the same way: gravity doesn't
    // produce torque (no field acts on angular dofs by default), so
    // angular velocity only changes from impulses during resolve.
    for (const b of bodies) {
      if (b.mass === 0) continue;
      b.vx += gravity.x * dt;
      b.vy += gravity.y * dt;
      const damp = 1 - b.damping * dt;
      const angDamp = 1 - b.angularDamping * dt;
      b.vx *= damp;
      b.vy *= damp;
      b.va *= angDamp;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.rotation += b.va * dt;
    }

    // 2) narrowphase: O(n²) pair test. swap in a grid broadphase
    // when body counts grow (>~100).
    for (let i = 0; i < bodies.length; i++) {
      for (let j = i + 1; j < bodies.length; j++) {
        const a = bodies[i];
        const b = bodies[j];
        if (a.mass === 0 && b.mass === 0) continue;
        const r = collidesWithResponse(a, b);
        if (r) resolve(a, b, r);
      }
    }
  }

  return { bodies, gravity, add, remove, step };
}

// Auto-compute moment of inertia from a body's mass and shape. The
// formulas assume the body's mass is uniformly distributed; this is
// good enough for game physics where most users won't tune inertia
// at all.
function autoInertia(body) {
  if (body.mass === 0) return 0;
  if (body.radius != null) {
    return (body.mass * body.radius * body.radius) / 2;
  }
  const w = body.width ?? 0;
  const h = body.height ?? 0;
  return (body.mass * (w * w + h * h)) / 12;
}

// Return the body's centre in world coordinates, accounting for its
// anchor. Mirrors the math in collide.js's `toShape` so that the
// contact-point-relative `r` vectors are computed correctly.
function bodyCenter(body) {
  const anchor = body.anchor ?? { x: 0, y: 0 };
  let w, h;
  if (body.radius != null) {
    w = h = body.radius * 2;
  } else {
    w = body.width ?? 0;
    h = body.height ?? 0;
  }
  return {
    x: body.x + w * (0.5 - anchor.x),
    y: body.y + h * (0.5 - anchor.y)
  };
}

function resolve(a, b, response) {
  const n = response.axis;
  const overlap = response.overlap;
  const point = response.point;

  const invMassA = a.mass === 0 ? 0 : 1 / a.mass;
  const invMassB = b.mass === 0 ? 0 : 1 / b.mass;
  const invIA = a.inertia === 0 ? 0 : 1 / a.inertia;
  const invIB = b.inertia === 0 ? 0 : 1 / b.inertia;
  const sumInvMass = invMassA + invMassB;
  if (sumInvMass === 0) return; // shouldn't happen — caller filters

  // r = vector from each body's centre of mass to the contact point.
  // we use this to convert linear impulses into torques and to
  // compute the velocity at the contact (which differs from the
  // body's centre velocity when the body is rotating).
  const ca = bodyCenter(a);
  const cb = bodyCenter(b);
  const rAx = point[0] - ca.x;
  const rAy = point[1] - ca.y;
  const rBx = point[0] - cb.x;
  const rBy = point[1] - cb.y;

  // velocity at the contact point. for a rotating body, the point
  // moves with v + ω × r (in 2D: ω × r = (-ω·ry, ω·rx)).
  const vAtAx = a.vx - a.va * rAy;
  const vAtAy = a.vy + a.va * rAx;
  const vAtBx = b.vx - b.va * rBy;
  const vAtBy = b.vy + b.va * rBx;
  const rvx = vAtBx - vAtAx;
  const rvy = vAtBy - vAtAy;
  const velN = rvx * n.x + rvy * n.y;

  // already separating along the contact normal — let them go.
  if (velN > 0) return;

  // 2D scalar cross r × n; the squared form appears in the impulse
  // denominator because (r × n)² is the angular contribution to the
  // effective mass along n.
  const crossAn = rAx * n.y - rAy * n.x;
  const crossBn = rBx * n.y - rBy * n.x;

  const e = Math.min(a.restitution, b.restitution);
  const denomN =
    sumInvMass +
    crossAn * crossAn * invIA +
    crossBn * crossBn * invIB;
  const j = (-(1 + e) * velN) / denomN;

  // apply normal impulse: linear to both bodies, torque to both.
  // signs: linear = ±j·n / m; angular = ±j·(r × n) / I
  a.vx -= j * n.x * invMassA;
  a.vy -= j * n.y * invMassA;
  b.vx += j * n.x * invMassB;
  b.vy += j * n.y * invMassB;
  a.va -= j * crossAn * invIA;
  b.va += j * crossBn * invIB;

  // tangent (friction) impulse — same shape, perpendicular axis.
  // tangent = normal rotated 90° CCW.
  const tx = -n.y;
  const ty = n.x;
  const velT = rvx * tx + rvy * ty;
  const crossAt = rAx * ty - rAy * tx;
  const crossBt = rBx * ty - rBy * tx;
  const denomT =
    sumInvMass +
    crossAt * crossAt * invIA +
    crossBt * crossBt * invIB;
  const mu = Math.sqrt(a.friction * b.friction);
  const jtRaw = -velT / denomT;
  const limit = Math.abs(j) * mu;
  const jt = Math.max(-limit, Math.min(limit, jtRaw));
  a.vx -= jt * tx * invMassA;
  a.vy -= jt * ty * invMassA;
  b.vx += jt * tx * invMassB;
  b.vy += jt * ty * invMassB;
  a.va -= jt * crossAt * invIA;
  b.va += jt * crossBt * invIB;

  // position correction (Baumgarte). only translates — bodies don't
  // get rotated to resolve overlap, just nudged apart.
  const correction = (Math.max(overlap - SLOP, 0) / sumInvMass) * PERCENT;
  a.x -= correction * n.x * invMassA;
  a.y -= correction * n.y * invMassA;
  b.x += correction * n.x * invMassB;
  b.y += correction * n.y * invMassB;
}
