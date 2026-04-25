/**
 * Pooled particle system. One ring buffer of fixed-size particles
 * is shared across every emit() call — no allocations per spark
 * after warmup, so the cost of throwing 50 sparks at every press
 * slam is just integer indexing.
 *
 * Each particle has position, velocity, time-to-live, size, colour,
 * drag, and gravity. tick(dt) ages and integrates; render() draws
 * onto a 2D context with alpha fading and size-shrinkage by age.
 *
 * Four presets cover most "industrial juice" needs:
 *   spark()    — radial burst, hot colour, gravity, fast
 *   smoke()    — slow upward puff, large soft particles
 *   exhaust()  — directional jet, useful for steam vents
 *   flash()    — single short-lived bright disc, hit-flashes
 *
 * For anything else, call emit() with a custom config — every
 * preset is just a thin wrapper.
 */

/**
 * @typedef {Object} EmitOptions
 * @property {number} [x=0]
 * @property {number} [y=0]
 * @property {number} [count=1] - particles to emit this call
 * @property {number} [angle=0] - direction in radians (0 = +x)
 * @property {number} [spread=0] - random angular spread (radians)
 * @property {number} [speed=0] - initial speed; randomised within [50%..100%]
 * @property {number} [ttl=0.5] - lifetime in seconds
 * @property {number} [size=2] - radius in pixels at birth
 * @property {string} [color='#fff']
 * @property {number} [drag=1] - fraction of velocity remaining per second (1 = no drag, 0.1 = strong drag)
 * @property {number} [gravity=0] - additional y-acceleration in px/s² (negative = rises)
 */

/**
 * @typedef {Object} ParticlesOptions
 * @property {CanvasRenderingContext2D} [context]
 * @property {number} [max=256] - pool capacity. once full, oldest particle is reused.
 */

/** @param {ParticlesOptions} [opts] */
export function Particles(opts = {}) {
  const max = opts.max ?? 256;
  let context = opts.context ?? null;

  // pre-allocate the entire pool. `alive` flag flips between dead
  // and live; integration and render skip dead slots in O(max).
  const pool = new Array(max);
  for (let i = 0; i < max; i++) {
    pool[i] = {
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      ttl: 0,
      age: 0,
      size: 0,
      color: '#fff',
      drag: 1,
      gravityY: 0,
      alive: false
    };
  }
  // ring cursor — newest emit overwrites the oldest slot once the
  // pool is full. simple and avoids a free-list.
  let cursor = 0;

  /** Emit a burst of particles. @param {EmitOptions} options */
  function emit(options = {}) {
    const count = options.count ?? 1;
    const angle = options.angle ?? 0;
    const spread = options.spread ?? 0;
    const speedBase = options.speed ?? 0;
    for (let i = 0; i < count; i++) {
      const p = pool[cursor];
      cursor = (cursor + 1) % max;
      const a = angle + (Math.random() - 0.5) * spread;
      // randomise speed within [50%..100%] of base — pure-base looks
      // mechanical, full-random looks chaotic, half-to-full looks
      // organic which is what most effects want
      const s = speedBase * (0.5 + Math.random() * 0.5);
      p.x = options.x ?? 0;
      p.y = options.y ?? 0;
      p.vx = Math.cos(a) * s;
      p.vy = Math.sin(a) * s;
      p.ttl = options.ttl ?? 0.5;
      p.age = 0;
      p.size = options.size ?? 2;
      p.color = options.color ?? '#fff';
      p.drag = options.drag ?? 1;
      p.gravityY = options.gravity ?? 0;
      p.alive = true;
    }
  }

  /** Advance every alive particle by dt seconds. @param {number} dt */
  function tick(dt) {
    // exponential drag — `drag` is fraction-remaining-per-second, so
    // `drag^dt` is fraction-remaining-this-step. drag=1 → no decay,
    // drag=0.5 → 50% of speed gone per second
    for (let i = 0; i < max; i++) {
      const p = pool[i];
      if (!p.alive) continue;
      p.age += dt;
      if (p.age >= p.ttl) {
        p.alive = false;
        continue;
      }
      p.vy += p.gravityY * dt;
      const damp = p.drag === 1 ? 1 : Math.pow(p.drag, dt);
      p.vx *= damp;
      p.vy *= damp;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
  }

  /** Draw alive particles. No-ops without a context. */
  function render() {
    if (!context) return;
    for (let i = 0; i < max; i++) {
      const p = pool[i];
      if (!p.alive) continue;
      const t = p.age / p.ttl; // 0..1 progress
      // alpha fades to 0; size shrinks slightly so particles look
      // like they're dissipating rather than just disappearing
      const alpha = 1 - t;
      const size = p.size * (1 - t * 0.5);
      context.globalAlpha = alpha;
      context.fillStyle = p.color;
      context.beginPath();
      context.arc(p.x, p.y, size, 0, Math.PI * 2);
      context.fill();
    }
    context.globalAlpha = 1;
  }

  /** Mark every particle dead — useful on level reset. */
  function clear() {
    for (let i = 0; i < max; i++) pool[i].alive = false;
  }

  /** Late-attach a context. @param {CanvasRenderingContext2D} ctx */
  function setContext(ctx) {
    context = ctx;
  }

  /** Count of currently-alive particles (for debug overlays). */
  function aliveCount() {
    let n = 0;
    for (let i = 0; i < max; i++) if (pool[i].alive) n++;
    return n;
  }

  // ---- presets -----------------------------------------------

  /**
   * Hot radial burst — saw blade striking metal, electrical zap.
   * Override colour for different metals.
   */
  function spark(x, y, opts = {}) {
    emit({
      x,
      y,
      count: opts.count ?? 12,
      angle: opts.angle ?? 0,
      spread: opts.spread ?? Math.PI * 2,
      speed: opts.speed ?? 220,
      ttl: opts.ttl ?? 0.4,
      size: opts.size ?? 2,
      color: opts.color ?? '#ffaa00',
      drag: opts.drag ?? 0.1,
      gravity: opts.gravity ?? 200
    });
  }

  /** Slow rising puff — boiler vent, debris cloud. */
  function smoke(x, y, opts = {}) {
    emit({
      x,
      y,
      count: opts.count ?? 8,
      angle: opts.angle ?? -Math.PI / 2,
      spread: opts.spread ?? Math.PI / 4,
      speed: opts.speed ?? 50,
      ttl: opts.ttl ?? 1.2,
      size: opts.size ?? 6,
      color: opts.color ?? '#888',
      drag: opts.drag ?? 0.3,
      gravity: opts.gravity ?? -30
    });
  }

  /**
   * Directional jet — steam pipe, exhaust port. `dirX`, `dirY` is
   * the direction the jet shoots; the function picks the angle from
   * those components.
   */
  function exhaust(x, y, dirX, dirY, opts = {}) {
    emit({
      x,
      y,
      count: opts.count ?? 5,
      angle: Math.atan2(dirY, dirX),
      spread: opts.spread ?? Math.PI / 8,
      speed: opts.speed ?? 150,
      ttl: opts.ttl ?? 0.3,
      size: opts.size ?? 4,
      color: opts.color ?? '#ddd',
      drag: opts.drag ?? 0.5
    });
  }

  /**
   * Single short-lived bright disc — hit flashes, muzzle flash.
   * Stationary; just appears and fades.
   */
  function flash(x, y, opts = {}) {
    emit({
      x,
      y,
      count: 1,
      angle: 0,
      spread: 0,
      speed: 0,
      ttl: opts.ttl ?? 0.15,
      size: opts.size ?? 18,
      color: opts.color ?? '#ffffaa'
    });
  }

  return {
    emit,
    tick,
    render,
    clear,
    setContext,
    aliveCount,
    spark,
    smoke,
    exhaust,
    flash,
    pool,
    get max() {
      return max;
    }
  };
}
