import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collides, collidesWithResponse } from '../src/collide.js';

// helpers — kontra-shaped fake game objects.
// circle() defaults to centre-anchored ({0.5, 0.5}) so its (x, y)
// reads as the centre of the circle (the natural convention for
// most callers); pass `anchor` in `rest` to override.
const rect = (x, y, w, h, rest = {}) => ({
  x,
  y,
  width: w,
  height: h,
  ...rest
});
const circle = (x, y, r, rest = {}) => ({
  x,
  y,
  radius: r,
  anchor: { x: 0.5, y: 0.5 },
  ...rest
});

// numeric tolerance for floating-point overlap math
const closeTo = (actual, expected, tol = 1e-6) =>
  Math.abs(actual - expected) <= tol;

test('AABB / AABB — overlap', () => {
  assert.equal(collides(rect(0, 0, 10, 10), rect(5, 5, 10, 10)), true);
});

test('AABB / AABB — no overlap', () => {
  assert.equal(collides(rect(0, 0, 10, 10), rect(20, 20, 10, 10)), false);
});

test('AABB / AABB — exactly touching edges count as no overlap', () => {
  // 0..10 and 10..20 touch at x=10 with zero width of intersection
  assert.equal(collides(rect(0, 0, 10, 10), rect(10, 0, 10, 10)), false);
});

test('AABB / AABB — response axis points A → B and overlap is correct', () => {
  // a at (0,0,10,10); b at (5,0,10,10); overlap on x = 5
  const r = collidesWithResponse(rect(0, 0, 10, 10), rect(5, 0, 10, 10));
  assert.ok(r);
  assert.ok(closeTo(r.overlap, 5));
  assert.ok(closeTo(r.axis.x, 1));
  assert.ok(closeTo(r.axis.y, 0));
  // contact point lies somewhere in the overlap region, vertically
  // centred since the rects align on y
  assert.ok(r.point[0] >= 5 && r.point[0] <= 10);
  assert.ok(closeTo(r.point[1], 5));
});

test('circle / circle — overlap, response is along centre line', () => {
  const a = circle(0, 0, 5);
  const b = circle(7, 0, 5);
  const r = collidesWithResponse(a, b);
  assert.ok(r);
  // sum radii = 10, distance = 7, overlap = 3
  assert.ok(closeTo(r.overlap, 3));
  assert.ok(closeTo(r.axis.x, 1));
  assert.ok(closeTo(r.axis.y, 0));
  // contact sits on A's surface along the line to B → (5, 0)
  assert.ok(closeTo(r.point[0], 5));
  assert.ok(closeTo(r.point[1], 0));
});

test('circle / circle — co-located returns nonzero overlap (no NaN)', () => {
  const r = collidesWithResponse(circle(10, 10, 5), circle(10, 10, 3));
  assert.ok(r);
  assert.ok(Number.isFinite(r.overlap));
  assert.ok(Number.isFinite(r.axis.x));
});

test('circle / circle — far apart', () => {
  assert.equal(collides(circle(0, 0, 5), circle(100, 0, 5)), false);
});

test('AABB / circle — overlap on the side', () => {
  // rect spans x:0..10 y:0..10; circle at (12,5) r=4 → reaches x=8
  const r = collidesWithResponse(
    rect(0, 0, 10, 10),
    circle(12, 5, 4)
  );
  assert.ok(r);
  // closest rect side is right edge (x=10); circle reaches x=8;
  // overlap = 2 along x axis
  assert.ok(closeTo(r.overlap, 2));
  assert.ok(closeTo(r.axis.x, 1));
  assert.ok(closeTo(r.axis.y, 0));
});

test('AABB / circle — no overlap when circle is outside corner', () => {
  // rect 0..10, circle at (20, 20) r=2 — far from any corner
  assert.equal(
    collides(rect(0, 0, 10, 10), circle(20, 20, 2)),
    false
  );
});

test('AABB / circle — corner case picks the corner-to-centre axis', () => {
  // circle clipping the bottom-right corner of a rect
  const r = collidesWithResponse(
    rect(0, 0, 10, 10),
    circle(11, 11, 2)
  );
  assert.ok(r);
  // axis should point roughly diagonally outward (cos45, sin45)
  assert.ok(closeTo(r.axis.x, Math.SQRT1_2, 0.01));
  assert.ok(closeTo(r.axis.y, Math.SQRT1_2, 0.01));
});

test('rotated AABB collides with axis-aligned AABB', () => {
  // a 10x10 rect rotated 45° centred at (5,5) has a diagonal of
  // 10*sqrt(2) ≈ 14.14, so it extends ~7.07 in each direction from
  // its centre. another rect at (10,5,5,5) sits between x=10..15.
  // 5 + 7.07 = 12.07 > 10 → overlap.
  const rotated = {
    x: 5,
    y: 5,
    width: 10,
    height: 10,
    anchor: { x: 0.5, y: 0.5 },
    rotation: Math.PI / 4
  };
  const aabb = rect(10, 5, 5, 5, { anchor: { x: 0, y: 0.5 } });
  assert.equal(collides(rotated, aabb), true);
});

test('rotated AABB does NOT collide if far enough away', () => {
  const rotated = {
    x: 5,
    y: 5,
    width: 10,
    height: 10,
    anchor: { x: 0.5, y: 0.5 },
    rotation: Math.PI / 4
  };
  // place the second rect well past the rotated rect's diagonal reach
  const far = rect(20, 5, 5, 5, { anchor: { x: 0, y: 0.5 } });
  assert.equal(collides(rotated, far), false);
});

test('explicit polygon — triangle overlapping rect', () => {
  const tri = {
    x: 5,
    y: 5,
    vertices: [
      [0, -5],
      [5, 5],
      [-5, 5]
    ],
    anchor: { x: 0, y: 0 } // ignored (no width/height) — handled in toShape
  };
  // tri vertices in world coords with cx,cy = (5,5):
  // (5,0), (10,10), (0,10)
  // rect at 0..6,7..12 overlaps the bottom of the triangle
  const r = rect(0, 7, 6, 5);
  assert.equal(collides(tri, r), true);
});

test('anchor-aware: centre-anchored sprite', () => {
  // sprite with anchor {0.5, 0.5} at (50, 50) of size 10x10
  // visual extent: 45..55 on both axes
  const a = { x: 50, y: 50, width: 10, height: 10, anchor: { x: 0.5, y: 0.5 } };
  // top-left-anchored rect at (50, 50) of size 10x10 → 50..60
  const b = rect(50, 50, 10, 10);
  // they overlap on x: 50..55 (overlap 5)
  const r = collidesWithResponse(a, b);
  assert.ok(r);
  assert.ok(closeTo(r.overlap, 5));
});

test('obj.world is preferred over obj.x for nested transforms', () => {
  // child sprite whose own x is 0 but whose world transform places
  // it at (50, 50). collide should use the world-space coords.
  const child = {
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    world: { x: 50, y: 50, width: 10, height: 10 }
  };
  assert.equal(collides(child, rect(55, 50, 10, 10)), true);
  assert.equal(collides(child, rect(0, 0, 10, 10)), false);
});

test('collides() returns boolean, collidesWithResponse() returns object or null', () => {
  const r1 = collides(rect(0, 0, 10, 10), rect(5, 5, 10, 10));
  assert.equal(typeof r1, 'boolean');
  const r2 = collidesWithResponse(rect(0, 0, 10, 10), rect(5, 5, 10, 10));
  assert.equal(typeof r2, 'object');
  assert.equal(r2 === null, false);
  const r3 = collidesWithResponse(rect(0, 0, 10, 10), rect(50, 50, 10, 10));
  assert.equal(r3, null);
});

test('symmetry — flipping arguments flips the axis but keeps the overlap', () => {
  const a = rect(0, 0, 10, 10);
  const b = rect(5, 0, 10, 10);
  const r1 = collidesWithResponse(a, b);
  const r2 = collidesWithResponse(b, a);
  assert.ok(r1 && r2);
  assert.ok(closeTo(r1.overlap, r2.overlap));
  assert.ok(closeTo(r1.axis.x, -r2.axis.x));
  assert.ok(closeTo(r1.axis.y, -r2.axis.y));
});

test('symmetry — circle-vs-rect order does not matter for the boolean', () => {
  const r = rect(0, 0, 10, 10);
  const c = circle(12, 5, 4);
  assert.equal(collides(r, c), collides(c, r));
});
