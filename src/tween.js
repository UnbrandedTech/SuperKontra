/**
 * Easing functions and a tween manager. Easings are pure functions
 * exported individually so tree-shaking pulls only what your game
 * actually uses; pass them as the `ease` argument to `Tweens.add()`
 * or use them directly with `t ∈ [0, 1]` for hand-rolled
 * interpolation.
 *
 * The `Tweens` factory is a centralized manager — `add()` registers
 * a tween, `tick(dt)` advances every active tween by `dt` seconds.
 * Each tween captures the target's starting values when added, so
 * `add(player, { x: 200 }, 1.5)` reads `player.x` once and
 * interpolates from that snapshot to 200 over 1.5 seconds.
 *
 * Tween handles expose `done`, `cancel()`, and `then(cb)` for
 * chaining or one-shot completion callbacks.
 */

// ----------------------------------------------------------------
// Easing functions. All map t ∈ [0, 1] → [0, 1] with f(0) = 0 and
// f(1) = 1. Derived from Robert Penner's standard library.
// ----------------------------------------------------------------

/** Linear (no easing). */
export const linear = t => t;

// quadratic
export const easeInQuad = t => t * t;
export const easeOutQuad = t => t * (2 - t);
export const easeInOutQuad = t =>
  t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;

// cubic
export const easeInCubic = t => t * t * t;
export const easeOutCubic = t => {
  const u = t - 1;
  return u * u * u + 1;
};
export const easeInOutCubic = t =>
  t < 0.5
    ? 4 * t * t * t
    : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1;

// sine
export const easeInSine = t => 1 - Math.cos((t * Math.PI) / 2);
export const easeOutSine = t => Math.sin((t * Math.PI) / 2);
export const easeInOutSine = t => -(Math.cos(Math.PI * t) - 1) / 2;

// exponential — note the exact endpoints are clamped so f(0)=0
// and f(1)=1 stay precise (the formulas approach but don't reach)
export const easeInExpo = t => (t === 0 ? 0 : 2 ** (10 * (t - 1)));
export const easeOutExpo = t => (t === 1 ? 1 : 1 - 2 ** (-10 * t));
export const easeInOutExpo = t => {
  if (t === 0) return 0;
  if (t === 1) return 1;
  if (t < 0.5) return 0.5 * 2 ** (20 * t - 10);
  return 1 - 0.5 * 2 ** (-20 * t + 10);
};

// back — overshoots slightly before settling. c1 controls the
// overshoot magnitude (1.70158 is the standard Penner value)
const c1 = 1.70158;
const c3 = c1 + 1;
export const easeInBack = t => c3 * t * t * t - c1 * t * t;
export const easeOutBack = t => {
  const u = t - 1;
  return 1 + c3 * u * u * u + c1 * u * u;
};
export const easeInOutBack = t => {
  const c2 = c1 * 1.525;
  return t < 0.5
    ? ((2 * t) ** 2 * ((c2 + 1) * 2 * t - c2)) / 2
    : ((2 * t - 2) ** 2 * ((c2 + 1) * (t * 2 - 2) + c2) + 2) / 2;
};

// bounce — outBounce is the canonical "drop and settle" curve
const n1 = 7.5625;
const d1 = 2.75;
export const easeOutBounce = t => {
  if (t < 1 / d1) return n1 * t * t;
  if (t < 2 / d1) {
    const u = t - 1.5 / d1;
    return n1 * u * u + 0.75;
  }
  if (t < 2.5 / d1) {
    const u = t - 2.25 / d1;
    return n1 * u * u + 0.9375;
  }
  const u = t - 2.625 / d1;
  return n1 * u * u + 0.984375;
};
export const easeInBounce = t => 1 - easeOutBounce(1 - t);
export const easeInOutBounce = t =>
  t < 0.5
    ? (1 - easeOutBounce(1 - 2 * t)) / 2
    : (1 + easeOutBounce(2 * t - 1)) / 2;

// ----------------------------------------------------------------
// Tween manager
// ----------------------------------------------------------------

/**
 * @typedef {Object} TweenHandle
 * @property {boolean} done - true once the tween has finished or been cancelled
 * @property {() => void} cancel - stop the tween early; `done` becomes true,
 *   target keeps whatever values it has at that moment
 * @property {(cb: () => void) => TweenHandle} then - register a callback to
 *   fire when the tween completes (not when cancelled)
 */

/**
 * Create a tween manager. Most games need exactly one — the manager
 * owns the active tween set and you call `tick(dt)` from your game
 * loop to advance them all.
 */
export function Tweens() {
  /** @type {Set<any>} */
  const active = new Set();

  /**
   * Tween properties on `target` to the values in `props` over
   * `duration` seconds, applying `ease` to map elapsed-time fraction
   * → progress fraction. Starting values are captured at add time.
   * @param {Object} target
   * @param {Object} props - destination values for each property
   * @param {number} duration - seconds
   * @param {(t: number) => number} [ease=linear]
   * @returns {TweenHandle}
   */
  function add(target, props, duration, ease = linear) {
    const start = {};
    for (const k in props) start[k] = target[k];

    const tween = {
      target,
      props,
      start,
      duration,
      ease,
      elapsed: 0,
      done: false,
      _resolvers: [],
      then(cb) {
        if (this.done && !this._cancelled) cb();
        else this._resolvers.push(cb);
        return this;
      },
      cancel() {
        if (!this.done) {
          this.done = true;
          this._cancelled = true;
          active.delete(this);
        }
      }
    };
    active.add(tween);
    return tween;
  }

  /**
   * Advance all active tweens by `dt` seconds. Tweens that complete
   * have their target snapped to the destination values, are
   * removed from the active set, and fire any registered `then`
   * callbacks.
   * @param {number} dt
   */
  function tick(dt) {
    // copy active to an array first so that tweens added or
    // cancelled inside a `then` callback don't mutate the loop
    for (const t of [...active]) {
      if (t.done) continue;
      t.elapsed += dt;
      const u = Math.min(t.elapsed / t.duration, 1);
      const k = t.ease(u);
      for (const key in t.props) {
        t.target[key] = t.start[key] + (t.props[key] - t.start[key]) * k;
      }
      if (u >= 1) {
        // snap to exact destination to avoid float drift
        for (const key in t.props) t.target[key] = t.props[key];
        t.done = true;
        active.delete(t);
        for (const cb of t._resolvers) cb();
      }
    }
  }

  /**
   * Cancel every active tween — handy for full state resets.
   */
  function cancelAll() {
    for (const t of [...active]) t.cancel();
  }

  return { active, add, tick, cancelAll };
}
