import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Camera } from '../src/camera.js';

// minimal mock 2D context that records save/restore/translate calls
function mockContext() {
  const calls = [];
  return {
    ctx: {
      save() {
        calls.push(['save']);
      },
      restore() {
        calls.push(['restore']);
      },
      translate(x, y) {
        calls.push(['translate', x, y]);
      }
    },
    calls
  };
}

test('default state has no offset and shaking is false', () => {
  const cam = Camera();
  assert.equal(cam.offsetX, 0);
  assert.equal(cam.offsetY, 0);
  assert.equal(cam.shaking, false);
});

test('shake() with zero intensity or duration is a no-op', () => {
  const cam = Camera();
  cam.shake(0, 1);
  cam.shake(5, 0);
  assert.equal(cam.shaking, false);
});

test('shake() starts a shake; tick produces nonzero offsets', () => {
  const cam = Camera();
  cam.shake(10, 0.3);
  assert.equal(cam.shaking, true);
  cam.tick(0.05);
  // randomised, but magnitude is bounded by current decayed intensity
  assert.ok(Math.abs(cam.offsetX) <= 10);
  assert.ok(Math.abs(cam.offsetY) <= 10);
});

test('shake decays to zero over the duration', () => {
  const cam = Camera();
  cam.shake(10, 0.2);
  // run past the duration in chunks
  for (let i = 0; i < 30; i++) cam.tick(1 / 60);
  assert.equal(cam.shaking, false);
  assert.equal(cam.offsetX, 0);
  assert.equal(cam.offsetY, 0);
});

test('multiple shake calls take max intensity, max remaining duration', () => {
  const cam = Camera();
  cam.shake(5, 1); // small long shake
  cam.tick(0.5); // half-elapsed
  cam.shake(20, 0.3); // big short shake mid-flight

  // intensity should now use the bigger 20 (decayed from t=0)
  // we'll sample magnitude bounds across a few ticks
  let maxSeen = 0;
  for (let i = 0; i < 20; i++) {
    cam.tick(0.01);
    maxSeen = Math.max(maxSeen, Math.abs(cam.offsetX));
  }
  assert.ok(
    maxSeen > 5,
    `expected larger shake to upgrade the intensity, got ${maxSeen}`
  );
});

test('a smaller shake mid-flight does not weaken an active stronger shake', () => {
  const cam = Camera();
  cam.shake(20, 0.5); // big
  cam.shake(2, 0.5); // smaller — should be ignored

  // the offset bounds should still allow up to 20 (initial) — sample
  let maxSeen = 0;
  for (let i = 0; i < 100; i++) {
    cam.tick(1 / 200);
    maxSeen = Math.max(maxSeen, Math.abs(cam.offsetX));
  }
  assert.ok(maxSeen > 5);
});

test('apply()/unapply() pair save+translate and restore on a real-shaped context', () => {
  const { ctx, calls } = mockContext();
  const cam = Camera({ context: ctx });
  cam.shake(10, 0.3);
  cam.tick(0.01); // produces a nonzero offset
  cam.apply();
  cam.unapply();
  // save → translate → restore
  assert.equal(calls[0][0], 'save');
  assert.equal(calls[1][0], 'translate');
  assert.equal(calls[2][0], 'restore');
});

test('apply() no-ops without a context', () => {
  const cam = Camera();
  cam.shake(10, 0.3);
  cam.tick(0.01);
  // shouldn't throw
  assert.doesNotThrow(() => {
    cam.apply();
    cam.unapply();
  });
});

test('draw(fn) wraps fn in save/restore', () => {
  const { ctx, calls } = mockContext();
  const cam = Camera({ context: ctx });
  let inside = false;
  cam.draw(() => {
    inside = true;
    // user drawing happens here — for the test we just check
    // ordering of context calls relative to fn invocation
  });
  assert.equal(inside, true);
  // last two recorded calls should be save before fn, restore after
  assert.equal(calls[0][0], 'save');
  assert.equal(calls[calls.length - 1][0], 'restore');
});

test('draw(fn) restores even if fn throws', () => {
  const { ctx, calls } = mockContext();
  const cam = Camera({ context: ctx });
  assert.throws(() =>
    cam.draw(() => {
      throw new Error('oops');
    })
  );
  // restore should still have been called
  const last = calls[calls.length - 1];
  assert.equal(last[0], 'restore');
});

test('setContext attaches a context after construction', () => {
  const { ctx, calls } = mockContext();
  const cam = Camera();
  cam.shake(10, 0.5);
  cam.tick(0.01);
  cam.setContext(ctx);
  cam.apply();
  cam.unapply();
  assert.equal(calls[0][0], 'save');
  assert.equal(calls[2][0], 'restore');
});

test('tick() with no active shake leaves offsets at zero', () => {
  const cam = Camera();
  cam.tick(1);
  assert.equal(cam.offsetX, 0);
  assert.equal(cam.offsetY, 0);
});
