/**
 * Camera helpers. v1 ships shake — every press-slam, hit-flash,
 * landing-thump, and explosion in a 2D game wants it. Future
 * helpers (follow-with-deadzone, lerp-to-target) layer in here.
 *
 *   const camera = Camera({ context });
 *
 *   GameLoop({
 *     update(dt) { camera.tick(dt); },
 *     render() {
 *       camera.draw(() => {
 *         // every drawing call inside this closure is offset
 *         // by the current shake amount
 *         scene.render();
 *       });
 *       hud.render();   // outside the closure — UI doesn't shake
 *     }
 *   });
 *
 *   // somewhere in your game logic:
 *   camera.shake(8, 0.3);   // 8 px peak, 0.3 second decay
 *
 * Multiple shake calls don't compound — the camera takes the
 * stronger of any active shake plus the longest duration. So a
 * small constant rumble plus a single big slam looks like the
 * slam, not "small + big" stacked.
 */

/**
 * @typedef {Object} CameraOptions
 * @property {CanvasRenderingContext2D} [context] - canvas to apply
 *   the offset to. apply()/unapply()/draw() no-op without it.
 */

/** @param {CameraOptions} [opts] */
export function Camera(opts = {}) {
  let context = opts.context ?? null;

  // shake state
  let shakeIntensity = 0; // peak px offset
  let shakeDuration = 0; // total seconds
  let shakeElapsed = 0;
  let offsetX = 0;
  let offsetY = 0;

  /**
   * Trigger a shake. A stronger request fully replaces the current
   * shake (fresh intensity, fresh duration, decay restarts) so a
   * big slam never feels half-decayed because of a small rumble
   * that was already underway. A weaker request mid-flight is
   * ignored — the bigger shake stays in charge.
   * @param {number} intensity - peak offset in pixels
   * @param {number} duration - decay time in seconds
   */
  function shake(intensity, duration) {
    if (intensity <= 0 || duration <= 0) return;
    if (intensity > shakeIntensity) {
      shakeIntensity = intensity;
      shakeDuration = duration;
      shakeElapsed = 0;
    }
  }

  /**
   * Advance the shake decay. easeOutQuad: shakes hit hard then
   * settle quickly — feels right for impacts; linear feels mushy.
   * @param {number} dt
   */
  function tick(dt) {
    if (shakeDuration <= 0) {
      offsetX = offsetY = 0;
      return;
    }
    shakeElapsed += dt;
    const t = shakeElapsed / shakeDuration;
    if (t >= 1) {
      shakeIntensity = 0;
      shakeDuration = 0;
      shakeElapsed = 0;
      offsetX = offsetY = 0;
      return;
    }
    const decay = (1 - t) * (1 - t); // easeOutQuad
    const intensity = shakeIntensity * decay;
    offsetX = (Math.random() * 2 - 1) * intensity;
    offsetY = (Math.random() * 2 - 1) * intensity;
  }

  /**
   * Apply the current offset to the configured context. Pair every
   * apply() with an unapply() — they save/restore the canvas state
   * stack, so mismatched calls leak transforms.
   */
  function apply() {
    if (!context) return;
    context.save();
    context.translate(offsetX, offsetY);
  }

  /** Restore the canvas state stack saved by apply(). */
  function unapply() {
    if (!context) return;
    context.restore();
  }

  /**
   * Run `fn` with the camera offset applied — no apply/unapply
   * pairing to forget. Use this when the camera-affected drawing
   * is contained in one block; bare apply/unapply when you need
   * to interleave shaken and unshaken drawing.
   * @param {() => void} fn
   */
  function draw(fn) {
    apply();
    try {
      fn();
    } finally {
      unapply();
    }
  }

  /** Late-attach a context. */
  function setContext(ctx) {
    context = ctx;
  }

  return {
    shake,
    tick,
    apply,
    unapply,
    draw,
    setContext,
    get offsetX() {
      return offsetX;
    },
    get offsetY() {
      return offsetY;
    },
    get shaking() {
      return shakeDuration > 0;
    }
  };
}
