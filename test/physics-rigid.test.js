import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/physics-rigid.js';

const closeTo = (a, b, tol = 1e-3) => Math.abs(a - b) <= tol;

// run the world at a fixed timestep for n frames
const tick = (world, dt, n = 1) => {
  for (let i = 0; i < n; i++) world.step(dt);
};

test('add() defaults missing fields and returns the body', () => {
  const world = World();
  const body = world.add({ x: 0, y: 0, width: 10, height: 10 });
  assert.equal(body.vx, 0);
  assert.equal(body.vy, 0);
  assert.equal(body.mass, 1);
  assert.equal(body.restitution, 0);
  assert.equal(body.friction, 0);
});

test('remove() takes a body out of integration', () => {
  const world = World({ gravity: { x: 0, y: 100 } });
  const body = world.add({ x: 0, y: 0, width: 10, height: 10 });
  world.remove(body);
  tick(world, 1 / 60, 60);
  assert.equal(body.vy, 0);
  assert.equal(body.y, 0);
});

test('gravity accelerates a free body', () => {
  const world = World({ gravity: { x: 0, y: 100 } });
  const body = world.add({ x: 0, y: 0, width: 10, height: 10 });
  tick(world, 0.1);
  // semi-implicit Euler: v += g*dt then x += v*dt
  // after one 0.1s step: vy = 10, y = 1
  assert.ok(closeTo(body.vy, 10));
  assert.ok(closeTo(body.y, 1));
});

test('static body (mass=0) does not move', () => {
  const world = World({ gravity: { x: 0, y: 100 } });
  const ground = world.add({
    x: 0,
    y: 100,
    width: 100,
    height: 10,
    mass: 0
  });
  tick(world, 1 / 60, 60);
  assert.equal(ground.y, 100);
  assert.equal(ground.vy, 0);
});

test('a falling body comes to rest on a static floor', () => {
  const world = World({ gravity: { x: 0, y: 500 } });
  const player = world.add({
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    mass: 1
  });
  const ground = world.add({
    x: -50,
    y: 100,
    width: 200,
    height: 10,
    mass: 0
  });
  tick(world, 1 / 60, 120); // 2 seconds at 60fps
  // player's bottom should be settled near the ground's top (y=100)
  // — the bottom of a 10-tall body at y=Y is at Y+10
  const bottom = player.y + player.height;
  assert.ok(
    bottom > 99 && bottom < 101,
    `expected bottom near 100, got ${bottom}`
  );
  // and barely moving (resting contact with Baumgarte slop)
  assert.ok(Math.abs(player.vy) < 5, `vy should be small, got ${player.vy}`);
});

test('elastic bounce — restitution=1 preserves vertical speed', () => {
  const world = World({ gravity: { x: 0, y: 1000 } });
  const ball = world.add({
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    mass: 1,
    restitution: 1
  });
  const ground = world.add({
    x: -100,
    y: 200,
    width: 300,
    height: 10,
    mass: 0,
    restitution: 1
  });
  // drop until first bounce, then keep simulating to find the apex
  let maxApex = -Infinity;
  let prevY = ball.y;
  let bouncing = false;
  for (let i = 0; i < 600; i++) {
    world.step(1 / 60);
    if (!bouncing && ball.vy < 0) bouncing = true;
    if (bouncing && ball.y > prevY && prevY < maxApex) break;
    if (bouncing) maxApex = Math.max(maxApex, -ball.y);
    prevY = ball.y;
  }
  // perfectly elastic bounces should return to ~original height (0).
  // some energy loss is expected from positional correction; allow
  // 20% slop.
  assert.ok(
    -maxApex > -50,
    `apex should be near 0, got ${-maxApex}`
  );
});

test('inelastic — restitution=0 sticks (no rebound)', () => {
  const world = World({ gravity: { x: 0, y: 500 } });
  const ball = world.add({
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    mass: 1,
    restitution: 0
  });
  world.add({
    x: -100,
    y: 100,
    width: 300,
    height: 10,
    mass: 0,
    restitution: 0
  });
  tick(world, 1 / 60, 90);
  // settled, not bouncing
  assert.ok(Math.abs(ball.vy) < 5, `vy should be small, got ${ball.vy}`);
});

test('momentum transfer — equal masses swap velocities along normal', () => {
  // a moves right at +10, b is stationary; they collide elastically.
  // 1D elastic between equal masses → a stops, b moves at +10.
  const world = World();
  const a = world.add({
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    mass: 1,
    restitution: 1,
    vx: 10
  });
  const b = world.add({
    x: 11,
    y: 0,
    width: 10,
    height: 10,
    mass: 1,
    restitution: 1
  });
  // step until they collide; first overlap appears within ~0.1s
  for (let i = 0; i < 30; i++) world.step(1 / 60);
  assert.ok(a.vx < 1, `a should have lost velocity, got vx=${a.vx}`);
  assert.ok(b.vx > 5, `b should have gained velocity, got vx=${b.vx}`);
});

test('mass ratio — heavier body keeps more of its velocity', () => {
  // heavy body at +10 hits a stationary light body. heavy keeps
  // most of its motion; light flies off faster than heavy was going.
  const world = World();
  const heavy = world.add({
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    mass: 10,
    restitution: 1,
    vx: 10
  });
  const light = world.add({
    x: 11,
    y: 0,
    width: 10,
    height: 10,
    mass: 1,
    restitution: 1
  });
  for (let i = 0; i < 30; i++) world.step(1 / 60);
  assert.ok(heavy.vx > 5, `heavy should keep speed, got ${heavy.vx}`);
  assert.ok(light.vx > heavy.vx, 'light should be faster than heavy after impact');
});

test('friction slows tangential sliding on a surface', () => {
  const world = World({ gravity: { x: 0, y: 500 } });
  const slider = world.add({
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    mass: 1,
    friction: 1, // maxed
    vx: 50
  });
  world.add({
    x: -100,
    y: 100,
    width: 300,
    height: 10,
    mass: 0,
    friction: 1
  });
  tick(world, 1 / 60, 120); // 2s of sliding
  assert.ok(
    slider.vx < 50,
    `friction should slow vx, got ${slider.vx}`
  );
});

test('frictionless surface preserves tangential velocity', () => {
  const world = World({ gravity: { x: 0, y: 500 } });
  const slider = world.add({
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    mass: 1,
    friction: 0,
    vx: 50
  });
  world.add({
    x: -100,
    y: 100,
    width: 300,
    height: 10,
    mass: 0,
    friction: 0
  });
  tick(world, 1 / 60, 60);
  // some loss from positional correction perturbing velocity, but
  // most of it should remain
  assert.ok(slider.vx > 40, `expected ~50, got ${slider.vx}`);
});

// --------------------------------------------------------------
// rotational dynamics
// --------------------------------------------------------------

test('add() defaults va, rotation, and auto-computes inertia', () => {
  const world = World();
  const body = world.add({ x: 0, y: 0, width: 6, height: 4, mass: 2 });
  assert.equal(body.va, 0);
  assert.equal(body.rotation, 0);
  // I = m·(w² + h²)/12 = 2·(36+16)/12 = 8.667
  assert.ok(Math.abs(body.inertia - 8.6667) < 0.01);
});

test('inertia auto-computes for circles via I = m·r²/2', () => {
  const world = World();
  const body = world.add({
    x: 0,
    y: 0,
    radius: 5,
    mass: 4,
    anchor: { x: 0.5, y: 0.5 }
  });
  // I = 4 · 25 / 2 = 50
  assert.equal(body.inertia, 50);
});

test('static body has zero inertia and never spins', () => {
  const world = World();
  const wall = world.add({
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    mass: 0
  });
  const ball = world.add({
    x: 11,
    y: 0,
    width: 10,
    height: 10,
    mass: 1,
    vx: -10
  });
  assert.equal(wall.inertia, 0);
  for (let i = 0; i < 30; i++) world.step(1 / 60);
  assert.equal(wall.va, 0);
  assert.equal(wall.rotation, 0);
});

test('user-provided inertia overrides auto-compute', () => {
  const world = World();
  const body = world.add({
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    mass: 1,
    inertia: 100
  });
  assert.equal(body.inertia, 100);
});

test('inertia: 0 makes a dynamic body translate but not rotate', () => {
  const world = World();
  // a body with mass but locked rotation — useful for player
  // characters that should bounce off walls without spinning.
  const player = world.add({
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    mass: 1,
    inertia: 0,
    vx: 5,
    vy: -3 // off-axis approach so the contact is off-centre
  });
  world.add({
    x: 8,
    y: -5,
    width: 30,
    height: 5,
    mass: 0
  });
  for (let i = 0; i < 60; i++) world.step(1 / 60);
  assert.equal(player.va, 0);
});

test('on-centre head-on collision produces no torque', () => {
  // two equal AABBs hitting along their shared horizontal axis —
  // the contact point lies on the line between centres so r×n = 0
  const world = World();
  const a = world.add({
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    mass: 1,
    restitution: 1,
    vx: 10
  });
  const b = world.add({
    x: 11,
    y: 0,
    width: 10,
    height: 10,
    mass: 1,
    restitution: 1
  });
  for (let i = 0; i < 30; i++) world.step(1 / 60);
  assert.ok(
    Math.abs(a.va) < 0.01,
    `a.va should be ~0, got ${a.va}`
  );
  assert.ok(
    Math.abs(b.va) < 0.01,
    `b.va should be ~0, got ${b.va}`
  );
});

test('off-centre collision induces angular velocity', () => {
  // a moving block strikes a stationary block above its centreline.
  // the impulse acts above the moving block's centre of mass and
  // below the stationary block's, so both should pick up spin.
  const world = World();
  const moving = world.add({
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    mass: 1,
    restitution: 1,
    vx: 10
  });
  const target = world.add({
    x: 11,
    y: -5, // offset upward so contact is above moving's centre
    width: 10,
    height: 10,
    mass: 1,
    restitution: 1
  });
  for (let i = 0; i < 30; i++) world.step(1 / 60);
  assert.ok(
    Math.abs(moving.va) > 0.01,
    `moving should pick up spin, got va=${moving.va}`
  );
  assert.ok(
    Math.abs(target.va) > 0.01,
    `target should pick up spin, got va=${target.va}`
  );
});

test('larger inertia spins less under the same impulse', () => {
  // run two identical off-centre collisions — one body has its
  // inertia bumped 10× — and compare resulting angular velocities
  function spinAfter(inertiaScale) {
    const w = World();
    const a = w.add({
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      mass: 1,
      inertia: (1 * (100 + 100)) / 12 * inertiaScale,
      restitution: 1,
      vx: 10
    });
    w.add({
      x: 11,
      y: -5,
      width: 10,
      height: 10,
      mass: 0
    });
    for (let i = 0; i < 30; i++) w.step(1 / 60);
    return Math.abs(a.va);
  }
  const lightSpin = spinAfter(1);
  const heavySpin = spinAfter(10);
  assert.ok(
    heavySpin < lightSpin,
    `heavy inertia should spin less; light=${lightSpin} heavy=${heavySpin}`
  );
});

test('rotation accumulates over steps based on va', () => {
  const world = World();
  const body = world.add({
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    mass: 1,
    va: Math.PI // 180° per second
  });
  world.step(0.5); // half a second
  // rotation = va * dt = π * 0.5 ≈ 1.5708
  assert.ok(Math.abs(body.rotation - Math.PI / 2) < 1e-6);
});

test('angularDamping bleeds spin', () => {
  const world = World();
  const body = world.add({
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    mass: 1,
    va: 5,
    angularDamping: 1
  });
  for (let i = 0; i < 60; i++) world.step(1 / 60);
  assert.ok(
    Math.abs(body.va) < 5,
    `va should decay below 5, got ${body.va}`
  );
});

test('rotation feeds back into collision detection', () => {
  // a square at (0,0) with rotation 45° has corners reaching
  // ~7 units from the centre. a target rect placed where it would
  // miss the unrotated square but clip the rotated one's corner
  // should collide once rotation is applied.
  const world = World();
  const body = world.add({
    x: 5,
    y: 5,
    width: 10,
    height: 10,
    mass: 1,
    anchor: { x: 0.5, y: 0.5 },
    rotation: 0
  });
  // place B just outside the square's unrotated bounds (x>10)
  world.add({
    x: 12,
    y: 5,
    width: 5,
    height: 5,
    mass: 0,
    anchor: { x: 0.5, y: 0.5 }
  });
  // step with no rotation — no collision, no movement
  world.step(1 / 60);
  const yBefore = body.y;
  // rotate the square by 45° — its corner now reaches into B
  body.rotation = Math.PI / 4;
  // run a step; positional correction should now displace `body`
  for (let i = 0; i < 5; i++) world.step(1 / 60);
  assert.ok(
    body.x !== 5 || body.y !== yBefore,
    'rotated body should now interact with target'
  );
});

// --------------------------------------------------------------
// broadphase
// --------------------------------------------------------------

test('broadphase scales to hundreds of bodies without missing collisions', () => {
  // 200 circles dropped onto a static floor — every body should
  // settle on or above the floor; none should fall through, none
  // should escape sideways. Mostly a smoke test that the spatial
  // grid produces every real collision pair (false negatives in
  // broadphase = bodies passing through each other).
  const world = World({ gravity: { x: 0, y: 500 } });
  const FLOOR_Y = 400;
  world.add({
    x: -200,
    y: FLOOR_Y,
    width: 600,
    height: 200,
    mass: 0,
    restitution: 0.3
  });
  // walls (extra wide to prevent tunneling at large body counts)
  world.add({
    x: -200,
    y: 0,
    width: 200,
    height: FLOOR_Y,
    mass: 0
  });
  world.add({
    x: 200,
    y: 0,
    width: 200,
    height: FLOOR_Y,
    mass: 0
  });
  const balls = [];
  for (let i = 0; i < 200; i++) {
    balls.push(
      world.add({
        x: 5 + (i % 20) * 10,
        y: -i * 5, // staggered drop heights
        radius: 4,
        anchor: { x: 0.5, y: 0.5 },
        mass: 1,
        restitution: 0.2,
        friction: 0.4
      })
    );
  }
  // simulate ~3 seconds of falling
  for (let i = 0; i < 180; i++) world.step(1 / 60);
  // every ball should have its centre near the floor — not past
  // the bottom of the floor slab (FLOOR_Y + 200) and not way out
  // of bounds. some Baumgarte-tolerated penetration is expected
  // when 200 bodies pile up; the contract being tested is "no
  // tunneling," not "zero overlap on rest contact".
  for (const b of balls) {
    assert.ok(
      b.y < FLOOR_Y + 50,
      `ball escaped through floor: y=${b.y}`
    );
    assert.ok(
      b.x > -10 && b.x < 210,
      `ball escaped sideways: x=${b.x}`
    );
  }
});

test('custom cellSize is honored', () => {
  // mostly a smoke test — pick an absurd cellSize and confirm the
  // sim still runs without errors and bodies still collide
  const world = World({
    gravity: { x: 0, y: 500 },
    cellSize: 1000
  });
  world.add({
    x: -100,
    y: 100,
    width: 300,
    height: 10,
    mass: 0
  });
  const ball = world.add({
    x: 50,
    y: 0,
    width: 10,
    height: 10,
    mass: 1
  });
  for (let i = 0; i < 60; i++) world.step(1 / 60);
  assert.ok(ball.y < 100, `ball should rest on floor, y=${ball.y}`);
});

// --------------------------------------------------------------
// sleeping
// --------------------------------------------------------------

test('a body that comes to rest goes to sleep after sleepTime', () => {
  const world = World({
    gravity: { x: 0, y: 500 },
    sleepTime: 0.2 // shorter for a quicker test
  });
  const ball = world.add({
    x: 0, y: 0,
    width: 10, height: 10,
    mass: 1, restitution: 0
  });
  world.add({
    x: -100, y: 100,
    width: 300, height: 10,
    mass: 0
  });
  // run long enough that the ball settles AND its sleep timer
  // exceeds sleepTime
  for (let i = 0; i < 90; i++) world.step(1 / 60);
  assert.equal(
    ball.sleeping,
    true,
    `expected sleeping=true after settling, got ${ball.sleeping}`
  );
});

test('a sleeping body skips integration — no gravity drift, no velocity', () => {
  const world = World({ gravity: { x: 0, y: 1000 } });
  const body = world.add({
    x: 100, y: 100,
    width: 10, height: 10,
    mass: 1
  });
  body.sleeping = true; // force sleep up front
  for (let i = 0; i < 60; i++) world.step(1 / 60);
  assert.equal(body.x, 100);
  assert.equal(body.y, 100);
  assert.equal(body.vy, 0);
});

test('a sleeping body wakes when struck by a moving body', () => {
  const world = World({ gravity: { x: 0, y: 0 } });
  const sleeper = world.add({
    x: 50, y: 50,
    width: 20, height: 20,
    mass: 1
  });
  sleeper.sleeping = true;
  const hammer = world.add({
    x: 0, y: 50,
    width: 20, height: 20,
    mass: 1, vx: 100
  });
  for (let i = 0; i < 60; i++) world.step(1 / 60);
  assert.equal(sleeper.sleeping, false, 'sleeper should have woken');
  assert.notEqual(hammer.sleeping, true);
  // sleeper should have moved (had momentum transferred)
  assert.ok(sleeper.x !== 50, 'sleeper should be moving after impact');
});

test('world.wake(body) clears the sleep flag explicitly', () => {
  const world = World();
  const body = world.add({
    x: 0, y: 0, width: 10, height: 10, mass: 1
  });
  body.sleeping = true;
  body._sleepT = 999;
  world.wake(body);
  assert.equal(body.sleeping, false);
  assert.equal(body._sleepT, 0);
});

test('sleeping bodies stay put under gravity for many seconds', () => {
  // regression: an early version put bodies to sleep but didn't
  // skip the integration step, so they kept accelerating downward
  const world = World({ gravity: { x: 0, y: 1000 } });
  const body = world.add({
    x: 50, y: 50, width: 10, height: 10, mass: 1
  });
  body.sleeping = true;
  for (let i = 0; i < 600; i++) world.step(1 / 60); // 10 seconds
  assert.equal(body.x, 50);
  assert.equal(body.y, 50);
});

test('sleep-vs-sleep pair tests are skipped (perf invariant)', () => {
  // verify the optimization actually fires — a sleeping body
  // adjacent to another sleeping body never has resolve() called,
  // so neither gets nudged from positional correction.
  const world = World({ gravity: { x: 0, y: 0 } });
  const a = world.add({
    x: 0, y: 0, width: 12, height: 12, mass: 1
  });
  const b = world.add({
    // overlapping by 2 px — would normally trigger resolve
    x: 10, y: 0, width: 12, height: 12, mass: 1
  });
  a.sleeping = true;
  b.sleeping = true;
  for (let i = 0; i < 30; i++) world.step(1 / 60);
  // positions unchanged — the overlap was never resolved
  assert.equal(a.x, 0);
  assert.equal(b.x, 10);
});

test('two static bodies do not interact', () => {
  const world = World();
  const a = world.add({
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    mass: 0
  });
  const b = world.add({
    x: 50,
    y: 50,
    width: 100,
    height: 100,
    mass: 0
  });
  tick(world, 1 / 60, 60);
  assert.equal(a.x, 0);
  assert.equal(b.x, 50);
});
