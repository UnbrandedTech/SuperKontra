import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Particles } from '../src/particles.js';

// minimal mock 2D context — counts arc/fill calls so render
// behaviour can be verified without a real canvas
function mockContext({ width = 800, height = 600 } = {}) {
  let arcs = 0;
  let fills = 0;
  return {
    ctx: {
      canvas: { width, height },
      globalAlpha: 1,
      fillStyle: '',
      beginPath() {},
      arc() {
        arcs++;
      },
      fill() {
        fills++;
      }
    },
    counts: () => ({ arcs, fills })
  };
}

test('pool size respected — emit beyond max wraps the cursor instead of allocating', () => {
  const p = Particles({ max: 4 });
  p.emit({ count: 6, ttl: 1 });
  // exactly 4 alive (last 4 written); first 2 were overwritten
  assert.equal(p.aliveCount(), 4);
  assert.equal(p.pool.length, 4);
});

test('emit() writes each requested particle into the pool', () => {
  const p = Particles({ max: 16 });
  p.emit({ count: 5, ttl: 1, x: 100, y: 200, color: '#ff0' });
  assert.equal(p.aliveCount(), 5);
  for (let i = 0; i < p.pool.length; i++) {
    if (!p.pool[i].alive) continue;
    assert.equal(p.pool[i].x, 100);
    assert.equal(p.pool[i].y, 200);
    assert.equal(p.pool[i].color, '#ff0');
  }
});

test('tick() advances age and kills expired particles', () => {
  const p = Particles({ max: 4 });
  p.emit({ count: 2, ttl: 0.1 });
  assert.equal(p.aliveCount(), 2);
  p.tick(0.05);
  assert.equal(p.aliveCount(), 2); // half-aged, still alive
  p.tick(0.06); // total 0.11 > 0.1
  assert.equal(p.aliveCount(), 0);
});

test('drag damps velocity exponentially (drag=1 means none)', () => {
  const p = Particles({ max: 2 });
  p.emit({
    count: 2,
    ttl: 10,
    angle: 0,
    speed: 100, // randomised to [50..100], so vx in [50..100]
    drag: 0.5 // half remaining per second
  });
  // capture an initial vx; after 1 second, expect ~50% of it
  const initialVx = p.pool.find(x => x.alive).vx;
  p.tick(1);
  const afterVx = p.pool.find(x => x.alive).vx;
  assert.ok(
    Math.abs(afterVx - initialVx * 0.5) < 0.01,
    `expected ${initialVx * 0.5}, got ${afterVx}`
  );
});

test('drag=1 leaves velocity unchanged across ticks', () => {
  const p = Particles({ max: 2 });
  p.emit({ count: 1, ttl: 10, angle: 0, speed: 100, drag: 1 });
  const before = p.pool.find(x => x.alive).vx;
  p.tick(0.5);
  const after = p.pool.find(x => x.alive).vx;
  assert.equal(before, after);
});

test('gravity adds to vy each tick', () => {
  const p = Particles({ max: 2 });
  p.emit({ count: 1, ttl: 10, gravity: 100 });
  const part = p.pool.find(x => x.alive);
  part.vx = 0;
  part.vy = 0;
  p.tick(0.5); // adds 50 to vy
  assert.ok(
    Math.abs(part.vy - 50) < 0.01,
    `expected vy ≈ 50, got ${part.vy}`
  );
});

test('emit obeys angle and spread (zero spread = exact direction)', () => {
  const p = Particles({ max: 4 });
  p.emit({
    count: 4,
    ttl: 10,
    angle: Math.PI / 2, // straight down
    spread: 0,
    speed: 100
  });
  for (const part of p.pool) {
    if (!part.alive) continue;
    // vx ≈ 0, vy positive (cos(π/2) ≈ 0, sin(π/2) = 1)
    assert.ok(Math.abs(part.vx) < 1e-9);
    assert.ok(part.vy > 0);
  }
});

test('render() no-ops when no context', () => {
  const p = Particles({ max: 4 });
  p.emit({ count: 2, ttl: 1 });
  // shouldn't throw
  assert.doesNotThrow(() => p.render());
});

test('render() draws one arc+fill per alive particle', () => {
  const { ctx, counts } = mockContext();
  const p = Particles({ context: ctx, max: 8 });
  p.emit({ count: 5, ttl: 1 });
  p.render();
  const c = counts();
  assert.equal(c.arcs, 5);
  assert.equal(c.fills, 5);
});

test('render() does not draw dead particles', () => {
  const { ctx, counts } = mockContext();
  const p = Particles({ context: ctx, max: 8 });
  p.emit({ count: 3, ttl: 0.1 });
  p.tick(0.5); // kills all
  p.render();
  assert.equal(counts().arcs, 0);
});

test('clear() kills every particle', () => {
  const p = Particles({ max: 4 });
  p.emit({ count: 4, ttl: 10 });
  assert.equal(p.aliveCount(), 4);
  p.clear();
  assert.equal(p.aliveCount(), 0);
});

test('setContext() lets a Particles be created before init() and wired up later', () => {
  const p = Particles();
  p.emit({ count: 3, ttl: 1 });
  p.render(); // no context, no-op
  const { ctx, counts } = mockContext();
  p.setContext(ctx);
  p.render();
  assert.equal(counts().arcs, 3);
});

test('spark preset emits radial burst with hot defaults', () => {
  const p = Particles({ max: 64 });
  p.spark(50, 50);
  assert.ok(p.aliveCount() > 0);
  // pick a particle and confirm hot-spark colour was applied
  const part = p.pool.find(x => x.alive);
  assert.ok(part.color.startsWith('#'));
  assert.equal(part.x, 50);
  assert.equal(part.y, 50);
});

test('smoke preset rises (negative gravity)', () => {
  const p = Particles({ max: 64 });
  p.smoke(0, 0);
  const part = p.pool.find(x => x.alive);
  assert.ok(
    part.gravityY < 0,
    `expected negative gravity (rising), got ${part.gravityY}`
  );
});

test('exhaust preset directs particles along the given vector', () => {
  const p = Particles({ max: 64 });
  // direction = (1, 0): emit to the right
  p.exhaust(0, 0, 1, 0);
  for (const part of p.pool) {
    if (!part.alive) continue;
    // vx should be positive, vy small (some spread)
    assert.ok(part.vx > 0);
  }
});

test('flash preset emits exactly one short-lived stationary disc', () => {
  const p = Particles({ max: 4 });
  p.flash(100, 100);
  assert.equal(p.aliveCount(), 1);
  const part = p.pool.find(x => x.alive);
  assert.equal(part.vx, 0);
  assert.equal(part.vy, 0);
  assert.ok(part.ttl < 0.5);
});

test('preset overrides honour the opts parameter', () => {
  const p = Particles({ max: 16 });
  p.spark(0, 0, { count: 3, color: '#0f0' });
  assert.equal(p.aliveCount(), 3);
  for (const part of p.pool) {
    if (!part.alive) continue;
    assert.equal(part.color, '#0f0');
  }
});
