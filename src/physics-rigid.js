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
 * @param {number} [opts.cellSize=64] - broadphase grid cell size
 *   in world units. Pair candidates are bodies sharing at least one
 *   cell. ~2× the typical body size is a good default; very dense
 *   scenes benefit from a tighter value, sparse scenes tolerate any.
 * @param {number} [opts.sleepLinear=1] - bodies whose |v| stays
 *   below this for `sleepTime` seconds get marked sleeping. Sleeping
 *   bodies skip integration and skip pair tests against other
 *   sleeping bodies — the canonical optimization for dense piles.
 * @param {number} [opts.sleepAngular=0.05] - same idea for angular
 *   velocity (rad/s).
 * @param {number} [opts.sleepTime=0.5] - how long the speed must
 *   stay low before the body is put to sleep, in seconds.
 * @param {(a: Object, b: Object, info: {overlap: number, axis: {x: number, y: number}, point: [number, number], impactSpeed: number}) => void} [opts.onCollide]
 *   - called once per resolved collision, AFTER the impulse has
 *   been applied. `info.impactSpeed` is the pre-impulse approach
 *   speed along the contact normal — the most useful "how hard
 *   did it hit" metric for sound effects and particles. Skips
 *   the callback for already-separating contacts (no impulse fired).
 * @returns {{
 *   bodies: Object[],
 *   gravity: {x: number, y: number},
 *   add: (body: Object) => Object,
 *   remove: (body: Object) => void,
 *   step: (dt: number) => void,
 *   wake: (body: Object) => void
 * }}
 */
export function World(opts = {}) {
  const bodies = [];
  const gravity = opts.gravity ?? { x: 0, y: 0 };
  const cellSize = opts.cellSize ?? 64;
  const sleepLinear = opts.sleepLinear ?? 1;
  const sleepAngular = opts.sleepAngular ?? 0.05;
  const sleepTime = opts.sleepTime ?? 0.5;
  const onCollide = opts.onCollide;

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
    body.sleeping ??= false;
    body._sleepT ??= 0; // accumulated time below the wake threshold
    if (body.inertia == null) body.inertia = autoInertia(body);
    bodies.push(body);
    return body;
  }

  function remove(body) {
    const i = bodies.indexOf(body);
    if (i >= 0) bodies.splice(i, 1);
  }

  /** Force a body awake — call after externally mutating its
   *  velocity, otherwise the sleep flag will keep it frozen. */
  function wake(body) {
    body.sleeping = false;
    body._sleepT = 0;
  }

  function step(dt) {
    // 1) integrate forces → velocity → position. sleeping and
    // static bodies skip integration entirely. semi-implicit Euler
    // for the rest.
    for (const b of bodies) {
      if (b.mass === 0 || b.sleeping) continue;
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

    // 2) broadphase + narrowphase. skip pairs where neither body
    // is "active" — a sleeping body resting on a static floor, or
    // two sleeping bodies, can't begin to collide on their own.
    // when a moving body strikes a sleeper, the narrowphase still
    // runs and the resolver wakes both.
    const pairs = broadphasePairs(bodies, cellSize);
    for (let i = 0; i < pairs.length; i += 2) {
      const a = pairs[i];
      const b = pairs[i + 1];
      const aInactive = a.sleeping || a.mass === 0;
      const bInactive = b.sleeping || b.mass === 0;
      if (aInactive && bInactive) continue;
      const r = collidesWithResponse(a, b);
      if (r) {
        if (a.sleeping) wake(a);
        if (b.sleeping) wake(b);
        resolve(a, b, r, onCollide);
      }
    }

    // 3) sleep-candidate scan. a body that's been below the speed
    // threshold for `sleepTime` gets put to sleep — its velocity
    // is zeroed (no residual jitter) and future integration / pair
    // tests skip it until something wakes it up.
    for (const b of bodies) {
      if (b.mass === 0 || b.sleeping) continue;
      const speed = Math.hypot(b.vx, b.vy);
      if (speed < sleepLinear && Math.abs(b.va) < sleepAngular) {
        b._sleepT += dt;
        if (b._sleepT >= sleepTime) {
          b.sleeping = true;
          b.vx = b.vy = b.va = 0;
        }
      } else {
        b._sleepT = 0;
      }
    }
  }

  return { bodies, gravity, add, remove, step, wake };
}

/**
 * Uniform-grid broadphase. Bucket each body's AABB into every grid
 * cell it touches; any pair sharing a cell becomes a candidate.
 * The narrowphase filters false positives. Pairs are deduped by a
 * numeric key (i*N + j, smaller index first) since a body with a
 * large AABB sits in many cells.
 *
 * Returns a flat array of [a, b, a, b, …] alternating pairs to
 * avoid allocating sub-arrays in the hot path. Caller iterates by
 * stepping i += 2.
 */
function broadphasePairs(bodies, cellSize) {
  const N = bodies.length;
  const grid = new Map();
  // bucket bodies into cells they overlap
  for (let i = 0; i < N; i++) {
    const b = bodies[i];
    const anchor = b.anchor ?? ZERO_ANCHOR;
    let w, h;
    if (b.radius != null) {
      w = h = b.radius * 2;
    } else {
      w = b.width ?? 0;
      h = b.height ?? 0;
    }
    const minX = b.x - w * anchor.x;
    const minY = b.y - h * anchor.y;
    const c0 = Math.floor(minX / cellSize);
    const c1 = Math.floor((minX + w) / cellSize);
    const r0 = Math.floor(minY / cellSize);
    const r1 = Math.floor((minY + h) / cellSize);
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        // pack the cell coordinates into a single signed integer
        // key — Map lookups on numbers are faster than on strings,
        // and game worlds rarely span more than ±32k cells in
        // either axis (the bit-shift assumes that range)
        const key = (c << 16) ^ (r & 0xffff);
        let bucket = grid.get(key);
        if (!bucket) grid.set(key, (bucket = []));
        bucket.push(i);
      }
    }
  }

  // emit unique pairs from each bucket
  const seen = new Set();
  const out = [];
  for (const bucket of grid.values()) {
    const len = bucket.length;
    for (let i = 0; i < len; i++) {
      for (let j = i + 1; j < len; j++) {
        const a = bucket[i];
        const b = bucket[j];
        const lo = a < b ? a : b;
        const hi = a < b ? b : a;
        const pairKey = lo * N + hi;
        if (seen.has(pairKey)) continue;
        seen.add(pairKey);
        out.push(bodies[a], bodies[b]);
      }
    }
  }
  return out;
}

const ZERO_ANCHOR = { x: 0, y: 0 };

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

function resolve(a, b, response, onCollide) {
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

  // notify the user. velN is negative when bodies are approaching;
  // |velN| is the most useful "how hard did this hit" metric for
  // sound and particle reactions, so we expose it as impactSpeed.
  if (onCollide) {
    onCollide(a, b, {
      overlap,
      axis: n,
      point,
      impactSpeed: -velN
    });
  }
}
