import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  Tweens,
  linear,
  easeInQuad,
  easeOutQuad,
  easeInOutQuad,
  easeInCubic,
  easeOutCubic,
  easeInOutCubic,
  easeInSine,
  easeOutSine,
  easeInOutSine,
  easeInExpo,
  easeOutExpo,
  easeInOutExpo,
  easeInBack,
  easeOutBack,
  easeInOutBack,
  easeInBounce,
  easeOutBounce,
  easeInOutBounce
} from '../src/tween.js';

const closeTo = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

// ----------------------------------------------------------------
// easings — every easing must hit f(0) = 0 and f(1) = 1
// ----------------------------------------------------------------

const all = [
  ['linear', linear],
  ['easeInQuad', easeInQuad],
  ['easeOutQuad', easeOutQuad],
  ['easeInOutQuad', easeInOutQuad],
  ['easeInCubic', easeInCubic],
  ['easeOutCubic', easeOutCubic],
  ['easeInOutCubic', easeInOutCubic],
  ['easeInSine', easeInSine],
  ['easeOutSine', easeOutSine],
  ['easeInOutSine', easeInOutSine],
  ['easeInExpo', easeInExpo],
  ['easeOutExpo', easeOutExpo],
  ['easeInOutExpo', easeInOutExpo],
  ['easeInBack', easeInBack],
  ['easeOutBack', easeOutBack],
  ['easeInOutBack', easeInOutBack],
  ['easeInBounce', easeInBounce],
  ['easeOutBounce', easeOutBounce],
  ['easeInOutBounce', easeInOutBounce]
];

for (const [name, fn] of all) {
  test(`${name}(0) === 0`, () => {
    assert.ok(closeTo(fn(0), 0));
  });
  test(`${name}(1) === 1`, () => {
    assert.ok(closeTo(fn(1), 1));
  });
}

test('linear is the identity function', () => {
  assert.equal(linear(0.3), 0.3);
  assert.equal(linear(0.7), 0.7);
});

test('easeInQuad(0.5) = 0.25 (slow start)', () => {
  assert.ok(closeTo(easeInQuad(0.5), 0.25));
});

test('easeOutQuad(0.5) = 0.75 (fast start, slow end)', () => {
  assert.ok(closeTo(easeOutQuad(0.5), 0.75));
});

test('easeInOutQuad(0.5) = 0.5 (symmetric midpoint)', () => {
  assert.ok(closeTo(easeInOutQuad(0.5), 0.5));
});

test('easeInOutCubic(0.5) = 0.5 (symmetric midpoint)', () => {
  assert.ok(closeTo(easeInOutCubic(0.5), 0.5));
});

test('easeInOutSine(0.5) = 0.5 (symmetric midpoint)', () => {
  assert.ok(closeTo(easeInOutSine(0.5), 0.5));
});

test('easeInBack overshoots negative before climbing', () => {
  // back curves dip below zero in the first half before recovering
  // — the dip is the visible "wind-up" before motion starts
  let foundDip = false;
  for (let t = 0; t < 0.4; t += 0.05) {
    if (easeInBack(t) < 0) {
      foundDip = true;
      break;
    }
  }
  assert.ok(foundDip, 'easeInBack should dip below 0 in its early arc');
});

test('easeOutBack overshoots above 1 before settling', () => {
  let foundOvershoot = false;
  for (let t = 0.5; t < 1; t += 0.05) {
    if (easeOutBack(t) > 1) {
      foundOvershoot = true;
      break;
    }
  }
  assert.ok(foundOvershoot, 'easeOutBack should overshoot above 1');
});

// ----------------------------------------------------------------
// Tweens manager
// ----------------------------------------------------------------

test('add() returns a handle and registers the tween as active', () => {
  const tw = Tweens();
  const t = tw.add({ x: 0 }, { x: 100 }, 1);
  assert.ok(t);
  assert.equal(tw.active.size, 1);
});

test('tick() interpolates linearly toward the destination', () => {
  const tw = Tweens();
  const target = { x: 0 };
  tw.add(target, { x: 100 }, 1);
  tw.tick(0.5); // halfway
  assert.ok(closeTo(target.x, 50));
});

test('tick() respects the easing function', () => {
  const tw = Tweens();
  const target = { x: 0 };
  tw.add(target, { x: 100 }, 1, easeInQuad);
  tw.tick(0.5);
  // easeInQuad(0.5) = 0.25 → target.x = 0 + (100-0)*0.25 = 25
  assert.ok(closeTo(target.x, 25));
});

test('tick() snaps to the exact destination on completion', () => {
  const tw = Tweens();
  const target = { x: 0 };
  tw.add(target, { x: 100 }, 1, easeInOutBack); // could overshoot
  tw.tick(2); // way past duration
  assert.equal(target.x, 100);
});

test('done is true after duration elapsed', () => {
  const tw = Tweens();
  const t = tw.add({ x: 0 }, { x: 1 }, 1);
  tw.tick(0.5);
  assert.equal(t.done, false);
  tw.tick(0.5);
  assert.equal(t.done, true);
});

test('completed tween is removed from the active set', () => {
  const tw = Tweens();
  tw.add({ x: 0 }, { x: 1 }, 1);
  tw.tick(1);
  assert.equal(tw.active.size, 0);
});

test('then(cb) fires once on completion', () => {
  const tw = Tweens();
  let calls = 0;
  const t = tw.add({ x: 0 }, { x: 1 }, 1);
  t.then(() => calls++);
  tw.tick(1);
  assert.equal(calls, 1);
  // ticking past completion does not re-fire
  tw.tick(0.5);
  assert.equal(calls, 1);
});

test('then(cb) on an already-done tween fires immediately', () => {
  const tw = Tweens();
  const t = tw.add({ x: 0 }, { x: 1 }, 1);
  tw.tick(1);
  let fired = false;
  t.then(() => (fired = true));
  assert.equal(fired, true);
});

test('cancel() marks the tween done and removes it from active', () => {
  const tw = Tweens();
  const target = { x: 0 };
  const t = tw.add(target, { x: 100 }, 1);
  tw.tick(0.25); // partially advance
  t.cancel();
  assert.equal(t.done, true);
  assert.equal(tw.active.size, 0);
  // target keeps its mid-tween value
  assert.ok(target.x > 0 && target.x < 100);
});

test('cancelled tween does not fire then callbacks', () => {
  const tw = Tweens();
  let calls = 0;
  const t = tw.add({ x: 0 }, { x: 1 }, 1);
  t.then(() => calls++);
  t.cancel();
  tw.tick(2);
  assert.equal(calls, 0);
});

test('multiple properties on one target tween in lockstep', () => {
  const tw = Tweens();
  const target = { x: 0, y: 0, alpha: 1 };
  tw.add(target, { x: 100, y: 50, alpha: 0 }, 1);
  tw.tick(0.5);
  assert.ok(closeTo(target.x, 50));
  assert.ok(closeTo(target.y, 25));
  assert.ok(closeTo(target.alpha, 0.5));
});

test('multiple targets advance independently', () => {
  const tw = Tweens();
  const a = { x: 0 };
  const b = { x: 100 };
  tw.add(a, { x: 100 }, 1);
  tw.add(b, { x: 0 }, 1);
  tw.tick(0.5);
  assert.ok(closeTo(a.x, 50));
  assert.ok(closeTo(b.x, 50));
});

test('initial value is captured at add() time, not deferred', () => {
  const tw = Tweens();
  const target = { x: 10 };
  const t = tw.add(target, { x: 110 }, 1);
  // mutate target outside the tween — the captured start value
  // should remain 10
  target.x = 999;
  // but the tween will overwrite on tick
  tw.tick(0.5);
  // start was 10, end is 110, halfway = 60
  assert.ok(closeTo(target.x, 60));
});

test('custom easing function is accepted', () => {
  const tw = Tweens();
  const target = { x: 0 };
  // a step function — full snap at t=1
  tw.add(target, { x: 100 }, 1, t => (t < 1 ? 0 : 1));
  tw.tick(0.5);
  assert.equal(target.x, 0);
  tw.tick(0.5); // hits the boundary, snap to dest
  assert.equal(target.x, 100);
});

test('cancelAll() stops every active tween', () => {
  const tw = Tweens();
  tw.add({ x: 0 }, { x: 1 }, 1);
  tw.add({ y: 0 }, { y: 1 }, 1);
  tw.add({ z: 0 }, { z: 1 }, 1);
  assert.equal(tw.active.size, 3);
  tw.cancelAll();
  assert.equal(tw.active.size, 0);
});
