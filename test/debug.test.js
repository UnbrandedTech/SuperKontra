import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Debug } from '../src/debug.js';

// minimal mock 2D context — captures fillText so tests can assert on
// rendered lines, ignores fillStyle / font assignments, lets save/
// restore noop. enough surface for Debug.render to not throw.
function mockContext({ width = 800, height = 600 } = {}) {
  const fills = [];
  const rects = [];
  const ctx = {
    canvas: { width, height },
    save() {},
    restore() {},
    measureText(s) {
      // crude monospace estimate — width ~ 7 px per char at 11px
      return { width: s.length * 7 };
    },
    fillRect(...args) {
      rects.push(args);
    },
    fillText(s, x, y) {
      fills.push({ s, x, y });
    },
    set fillStyle(_) {},
    set font(_) {},
    set textBaseline(_) {}
  };
  return { ctx, fills, rects };
}

test('time(label, fn) records the section duration and returns fn’s value', () => {
  const debug = Debug();
  const result = debug.time('work', () => {
    // brief synchronous burn so duration > 0 deterministically
    let s = 0;
    for (let i = 0; i < 1e4; i++) s += i;
    return s;
  });
  assert.equal(result, (1e4 * (1e4 - 1)) / 2);
  assert.ok(debug.samples.work);
  assert.equal(debug.samples.work.count, 1);
});

test('tick() records inter-call wall time as the "frame" metric', async () => {
  const debug = Debug();
  debug.tick(); // primes lastTickAt; no sample yet
  assert.equal(debug.samples.frame ?? null, null);
  // small async wait to ensure measurable elapsed time
  await new Promise(r => setTimeout(r, 5));
  debug.tick();
  assert.ok(debug.samples.frame);
  assert.equal(debug.samples.frame.count, 1);
  assert.ok(debug.samples.frame.values[0] >= 1);
});

test('count(label, value) stores the most recent value (no averaging)', () => {
  const debug = Debug();
  debug.count('bodies', 10);
  assert.equal(debug.counters.bodies, 10);
  debug.count('bodies', 459);
  assert.equal(debug.counters.bodies, 459);
});

test('ring buffer wraps after 60 samples without losing capacity', () => {
  const debug = Debug();
  for (let i = 0; i < 100; i++) {
    debug.time('tag', () => {});
  }
  // after 100 records, count caps at the window size (60)
  assert.equal(debug.samples.tag.count, 60);
});

test('lines() includes fps when frame samples exist and counters in insertion order', async () => {
  const debug = Debug();
  debug.tick();
  await new Promise(r => setTimeout(r, 5));
  debug.tick();
  debug.time('a', () => {});
  debug.time('b', () => {});
  debug.count('count1', 42);
  const out = debug.lines();
  // fps line is first when frame samples exist
  assert.match(out[0], /^fps/);
  // sections appear in time-call order
  const aIdx = out.findIndex(l => l.startsWith('a'));
  const bIdx = out.findIndex(l => l.startsWith('b'));
  assert.ok(aIdx >= 0 && bIdx >= 0 && aIdx < bIdx);
  // counter prefixed by its name
  assert.ok(out.some(l => l.startsWith('count1') && l.includes('42')));
});

test('render() draws a panel and one fillText per line', () => {
  const { ctx, fills, rects } = mockContext();
  const debug = Debug({ context: ctx });
  debug.time('a', () => {});
  debug.count('n', 5);
  debug.render();
  // exactly one panel rect, one fillText per output line
  assert.equal(rects.length, 1);
  assert.equal(fills.length, debug.lines().length);
});

test('render() no-ops when visible is false', () => {
  const { ctx, fills, rects } = mockContext();
  const debug = Debug({ context: ctx, visible: false });
  debug.time('a', () => {});
  debug.render();
  assert.equal(fills.length, 0);
  assert.equal(rects.length, 0);
});

test('render() no-ops when no context has been provided', () => {
  const debug = Debug();
  debug.time('a', () => {});
  // shouldn't throw despite no ctx
  assert.doesNotThrow(() => debug.render());
});

test('setContext() lets a Debug be created before init() and wired up later', () => {
  const debug = Debug();
  debug.time('a', () => {});
  // initial render no-ops (no ctx)
  debug.render();
  const { ctx, fills } = mockContext();
  debug.setContext(ctx);
  debug.render();
  assert.ok(fills.length > 0);
});

test('toggle() flips visibility', () => {
  const debug = Debug();
  assert.equal(debug.visible, true);
  debug.toggle();
  assert.equal(debug.visible, false);
  debug.toggle();
  assert.equal(debug.visible, true);
});

test('position presets place the panel correctly', () => {
  // top-left: panel x near 10
  // top-right: panel x near canvas.width - panelW - 10
  const make = pos => {
    const { ctx, rects } = mockContext({ width: 800, height: 600 });
    const debug = Debug({ context: ctx, position: pos });
    debug.count('a', 1);
    debug.render();
    return rects[0]; // [x, y, w, h]
  };
  const tl = make('top-left');
  const tr = make('top-right');
  const bl = make('bottom-left');
  const br = make('bottom-right');
  assert.ok(tl[0] < 100, `top-left x should be near 10, got ${tl[0]}`);
  assert.ok(tr[0] > 600, `top-right x should be near right edge, got ${tr[0]}`);
  assert.ok(tl[1] < 100, `top-left y should be near 10, got ${tl[1]}`);
  assert.ok(bl[1] > 400, `bottom-left y should be near bottom, got ${bl[1]}`);
  assert.ok(br[0] > 600 && br[1] > 400, `bottom-right offset wrong: ${br}`);
});

test('time() preserves the function return value through the wrapper', () => {
  const debug = Debug();
  const value = debug.time('echo', () => 'hello');
  assert.equal(value, 'hello');
});

test('count() updates persist across render calls', () => {
  const { ctx, fills } = mockContext();
  const debug = Debug({ context: ctx });
  debug.count('n', 1);
  debug.render();
  const firstCall = fills.find(f => f.s.startsWith('n'));
  assert.ok(firstCall.s.includes('1'));
  debug.count('n', 999);
  fills.length = 0;
  debug.render();
  const secondCall = fills.find(f => f.s.startsWith('n'));
  assert.ok(secondCall.s.includes('999'));
});
