import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Verlet } from '../src/physics-verlet.js';

const closeTo = (a, b, tol = 1e-3) => Math.abs(a - b) <= tol;

test('point() creates a particle with zero implicit velocity', () => {
  const w = Verlet();
  const p = w.point(10, 20);
  assert.equal(p.x, 10);
  assert.equal(p.y, 20);
  assert.equal(p.px, 10);
  assert.equal(p.py, 20);
});

test('non-pinned particle accelerates under gravity', () => {
  const w = Verlet({ gravity: { x: 0, y: 100 } });
  const p = w.point(0, 0);
  for (let i = 0; i < 60; i++) w.step(1 / 60);
  // approx y ≈ 0.5 * g * t² with t=1: y ≈ 50
  assert.ok(p.y > 30, `expected significant fall, got ${p.y}`);
});

test('pinned particle ignores gravity', () => {
  const w = Verlet({ gravity: { x: 0, y: 100 } });
  const p = w.point(50, 50, { pinned: true });
  for (let i = 0; i < 60; i++) w.step(1 / 60);
  assert.equal(p.x, 50);
  assert.equal(p.y, 50);
});

test('link() defaults rest length to current distance', () => {
  const w = Verlet();
  const a = w.point(0, 0);
  const b = w.point(0, 25);
  const l = w.link(a, b);
  assert.equal(l.length, 25);
});

test('link maintains distance between two free particles after a perturbation', () => {
  const w = Verlet();
  const a = w.point(0, 0);
  const b = w.point(10, 0);
  w.link(a, b);
  // teleport b away — the constraint should pull it back
  b.x = 20;
  b.px = 20;
  for (let i = 0; i < 20; i++) w.step(1 / 60);
  const dist = Math.hypot(b.x - a.x, b.y - a.y);
  assert.ok(
    closeTo(dist, 10, 0.5),
    `dist should converge to 10, got ${dist}`
  );
});

test('compressed link expands back to rest length', () => {
  const w = Verlet();
  const a = w.point(0, 0);
  const b = w.point(10, 0);
  w.link(a, b);
  b.x = 5; // squish them
  b.px = 5;
  for (let i = 0; i < 20; i++) w.step(1 / 60);
  const dist = Math.hypot(b.x - a.x, b.y - a.y);
  assert.ok(
    closeTo(dist, 10, 0.5),
    `dist should expand back to 10, got ${dist}`
  );
});

test('pendulum: pinned anchor + free bob keeps rest length', () => {
  const w = Verlet({ gravity: { x: 0, y: 500 } });
  const anchor = w.point(0, 0, { pinned: true });
  const bob = w.point(50, 0); // start swung 90° to the side
  w.link(anchor, bob);
  for (let i = 0; i < 120; i++) w.step(1 / 60);
  // anchor unchanged
  assert.equal(anchor.x, 0);
  assert.equal(anchor.y, 0);
  // bob still ~50 from anchor (pendulum, stiff link)
  const dist = Math.hypot(bob.x, bob.y);
  assert.ok(
    closeTo(dist, 50, 1.5),
    `dist should stay ~50, got ${dist}`
  );
});

test('hanging rope: every segment converges to its rest length', () => {
  const w = Verlet({ gravity: { x: 0, y: 200 } });
  const segs = [];
  segs.push(w.point(0, 0, { pinned: true }));
  for (let i = 1; i < 8; i++) {
    const p = w.point(0, i * 10);
    w.link(segs[i - 1], p);
    segs.push(p);
  }
  for (let i = 0; i < 200; i++) w.step(1 / 60);
  // each adjacent pair should be ~10 apart after settling
  for (let i = 1; i < segs.length; i++) {
    const dist = Math.hypot(
      segs[i].x - segs[i - 1].x,
      segs[i].y - segs[i - 1].y
    );
    assert.ok(
      closeTo(dist, 10, 2),
      `segment ${i} dist = ${dist} (expected ~10)`
    );
  }
  // tail of the rope should hang well below the anchor
  assert.ok(
    segs[segs.length - 1].y > 50,
    `tail should hang down, got y=${segs[segs.length - 1].y}`
  );
});

test('two pinned particles in a link do not move', () => {
  const w = Verlet();
  const a = w.point(0, 0, { pinned: true });
  const b = w.point(10, 0, { pinned: true });
  w.link(a, b);
  for (let i = 0; i < 60; i++) w.step(1 / 60);
  assert.equal(a.x, 0);
  assert.equal(b.x, 10);
});

test('initial velocity (px set apart from x) is preserved', () => {
  const w = Verlet();
  const p = w.point(10, 0);
  // implicit velocity vector: x - px = 1 per step
  p.px = 9;
  for (let i = 0; i < 5; i++) w.step(1 / 60);
  // after 5 steps with no forces, x should be 10 + 5 = 15
  assert.ok(closeTo(p.x, 15, 0.001), `expected x=15, got ${p.x}`);
});
