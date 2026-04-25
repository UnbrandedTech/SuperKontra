/**
 * On-canvas debug overlay — FPS, per-section timing, arbitrary
 * counters. Each metric is a 60-sample rolling window; the overlay
 * shows the mean. Designed to drop into a kontra GameLoop without
 * coupling to the rest of super-kontra.
 *
 *   const debug = Debug({ context: kontra.getContext() });
 *
 *   GameLoop({
 *     update(dt) {
 *       debug.time('physics', () => world.step(dt));
 *       debug.time('rope',    () => rope.step(dt));
 *     },
 *     render() {
 *       debug.tick();                     // measure visual FPS
 *       debug.time('render', () => game.render());
 *       debug.count('bodies', bodies.length);
 *       debug.render();                   // draw the overlay last
 *     }
 *   });
 *
 * `tick()` measures inter-call wall time. Call it once per visible
 * frame (typically inside your render hook) — that's what gives the
 * "fps" line. Sections measured by `time()` time exactly the
 * function passed; nesting works (the inner section is included in
 * the outer's total, like a profiler tree).
 */

const SAMPLE_WINDOW = 60;

/**
 * @typedef {Object} DebugOptions
 * @property {CanvasRenderingContext2D} [context] - canvas to draw to.
 *   render() no-ops if absent, so a Debug instance can be created
 *   before init() and wired up later.
 * @property {'top-left'|'top-right'|'bottom-left'|'bottom-right'} [position='top-left']
 * @property {boolean} [visible=true]
 */

/** @param {DebugOptions} [opts] */
export function Debug(opts = {}) {
  const samples = {}; // { label: { values: Float64Array, idx, count } }
  const counters = {}; // { label: any }
  const labels = []; // insertion-ordered for stable display
  let lastTickAt = 0;
  let visible = opts.visible !== false;
  let context = opts.context ?? null;
  let position = opts.position ?? 'top-left';

  function record(label, value) {
    let buf = samples[label];
    if (!buf) {
      buf = samples[label] = {
        values: new Float64Array(SAMPLE_WINDOW),
        idx: 0,
        count: 0
      };
      labels.push(label);
    }
    buf.values[buf.idx] = value;
    buf.idx = (buf.idx + 1) % SAMPLE_WINDOW;
    if (buf.count < SAMPLE_WINDOW) buf.count++;
  }

  function mean(buf) {
    if (!buf || !buf.count) return 0;
    let sum = 0;
    for (let i = 0; i < buf.count; i++) sum += buf.values[i];
    return sum / buf.count;
  }

  /**
   * Record an inter-call interval as the 'frame' metric. Call once
   * per visible frame — typically in your render hook.
   */
  function tick() {
    const now = performance.now();
    if (lastTickAt) record('frame', now - lastTickAt);
    lastTickAt = now;
  }

  /**
   * Time a synchronous section. Returns whatever `fn` returns so it
   * can wrap an existing call without changing data flow.
   * @param {string} label
   * @param {() => any} fn
   */
  function time(label, fn) {
    const t0 = performance.now();
    const r = fn();
    record(label, performance.now() - t0);
    return r;
  }

  /**
   * Set or update a numeric (or stringly-coercible) counter. No
   * sampling — counters display the most recent value.
   * @param {string} label
   * @param {any} value
   */
  function count(label, value) {
    if (!(label in counters)) labels.push('count:' + label);
    counters[label] = value;
  }

  /** Toggle the on-screen overlay. Metrics keep recording. */
  function toggle() {
    visible = !visible;
  }

  /** Provide or replace the canvas context. */
  function setContext(ctx) {
    context = ctx;
  }

  /** Build the lines that will be displayed, in stable order. */
  function lines() {
    const out = [];
    if (samples.frame) {
      const ms = mean(samples.frame);
      const fps = ms > 0 ? 1000 / ms : 0;
      out.push(
        'fps   ' +
          fps.toFixed(0).padStart(3) +
          '  ' +
          ms.toFixed(1).padStart(5) +
          ' ms'
      );
    }
    for (const label of labels) {
      if (label === 'frame') continue;
      if (label.startsWith('count:')) {
        const k = label.slice(6);
        out.push(k.padEnd(6) + String(counters[k]));
      } else if (samples[label]) {
        out.push(
          label.padEnd(6) +
            mean(samples[label]).toFixed(2).padStart(7) +
            ' ms'
        );
      }
    }
    return out;
  }

  /** Draw the overlay onto the configured canvas context. */
  function render() {
    if (!visible || !context) return;
    const out = lines();
    if (!out.length) return;
    const ctx = context;
    const PAD = 8;
    const LINE = 14;
    const FONT = '11px ui-monospace, monospace';
    ctx.save();
    ctx.font = FONT;
    ctx.textBaseline = 'top';
    // measure widest line so the panel fits even with long counters
    let w = 0;
    for (const ln of out) {
      const m = ctx.measureText(ln).width;
      if (m > w) w = m;
    }
    const panelW = Math.ceil(w) + PAD * 2;
    const panelH = out.length * LINE + PAD * 2;
    const cw = ctx.canvas.width;
    const ch = ctx.canvas.height;
    let x = 10;
    let y = 10;
    if (position.includes('right')) x = cw - panelW - 10;
    if (position.includes('bottom')) y = ch - panelH - 10;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(x, y, panelW, panelH);
    ctx.fillStyle = '#ddd';
    for (let i = 0; i < out.length; i++) {
      ctx.fillText(out[i], x + PAD, y + PAD + i * LINE);
    }
    ctx.restore();
  }

  return {
    tick,
    time,
    count,
    render,
    toggle,
    setContext,
    lines,
    get visible() {
      return visible;
    },
    set visible(v) {
      visible = v;
    },
    get position() {
      return position;
    },
    set position(p) {
      position = p;
    },
    samples,
    counters
  };
}
