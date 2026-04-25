/**
 * Particle Garden — a small playable demo that exercises seven of
 * the eight super-kontra modules running inside kontra's GameLoop.
 *
 * Modules used:
 *   physics-rigid  — circles fall, collide, rotate
 *   physics-verlet — rope hangs from the ceiling, swings naturally
 *   collide        — wall + circle + circle collisions (via World)
 *   fsm            — title / playing, with a paused state pushed
 *                    on top so the scene keeps drawing behind it
 *   state          — best-count saves to localStorage with versioning
 *   audio          — synthesized thud plays on floor impacts via
 *                    the Mixer (variable rate for variety)
 *   tween          — "NEW BEST" UI banner pops with easeOutBack and
 *                    fades out
 *
 * The remaining module (`path`) doesn't fit a free-form sandbox;
 * see test/path.test.js for its usage examples.
 */

import { init, GameLoop, initKeys, onKey } from 'kontra';
import { World } from 'super-kontra/physics-rigid.js';
import { Verlet } from 'super-kontra/physics-verlet.js';
import { FSM } from 'super-kontra/fsm.js';
import { Save } from 'super-kontra/state.js';
import { Mixer } from 'super-kontra/audio.js';
import {
  Tweens,
  easeOutCubic,
  easeOutBack
} from 'super-kontra/tween.js';

const { canvas, context } = init();
initKeys();

const W = canvas.width;
const H = canvas.height;
const FLOOR_Y = H - 24;

// ----------------------------------------------------------------
// Audio — synthesize a short thud WAV and stash it as a real
// HTMLAudioElement. In a real game you'd kontra.loadAudio('thud.wav')
// and pull via query('a', 'thud') — this avoids shipping a binary
// asset alongside the demo.
// ----------------------------------------------------------------
function synthThudWav() {
  const sampleRate = 22050;
  const samples = Math.floor(sampleRate * 0.18);
  const buf = new ArrayBuffer(44 + samples * 2);
  const v = new DataView(buf);
  const writeStr = (off, s) => {
    for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  v.setUint32(4, 36 + samples * 2, true);
  writeStr(8, 'WAVEfmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  writeStr(36, 'data');
  v.setUint32(40, samples * 2, true);
  for (let i = 0; i < samples; i++) {
    const t = i / sampleRate;
    const env = Math.exp(-t * 22);
    // pitch falls quickly — gives a "thud" rather than a "beep"
    const freq = 110 * Math.exp(-t * 8);
    const sample = Math.sin(2 * Math.PI * freq * t) * env * 0x4000;
    v.setInt16(44 + i * 2, sample | 0, true);
  }
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return 'data:audio/wav;base64,' + btoa(bin);
}
const thudAudio = new Audio(synthThudWav());

const mixer = Mixer();
mixer.channel('sfx', { volume: 0.4 });

// ----------------------------------------------------------------
// Save — versioned high-count storage
// ----------------------------------------------------------------
const save = Save({
  key: 'super-kontra-demo',
  version: 1
});
let bestCount = save.read()?.bestCount ?? 0;

// ----------------------------------------------------------------
// Physics world — gravity + walls
// ----------------------------------------------------------------
const world = World({ gravity: { x: 0, y: 800 } });
world.add({
  x: 0, y: FLOOR_Y, width: W, height: 24,
  mass: 0, restitution: 0.45, friction: 0.6
});
world.add({
  x: -10, y: 0, width: 10, height: H,
  mass: 0, restitution: 0.5
});
world.add({
  x: W, y: 0, width: 10, height: H,
  mass: 0, restitution: 0.5
});

const COLORS = ['#ff7eb6', '#7dd3fc', '#facc15', '#a78bfa', '#86efac', '#fb923c'];
const bodies = [];

function spawnCircle(x, y) {
  const radius = 7 + Math.random() * 12;
  const body = {
    x, y,
    radius,
    color: COLORS[(Math.random() * COLORS.length) | 0],
    anchor: { x: 0.5, y: 0.5 },
    mass: 1,
    restitution: 0.55,
    friction: 0.4,
    vx: (Math.random() - 0.5) * 80,
    vy: -40
  };
  world.add(body);
  bodies.push(body);

  if (bodies.length > bestCount) {
    bestCount = bodies.length;
    save.write({ bestCount });
    bestPopElapsed = 0;
  }
}

// ----------------------------------------------------------------
// Floor-impact detection — listen for body.vy crossing the
// "was falling fast, now slowed" threshold near the floor and
// fire a thud per impact (rate randomised so chains don't sound
// machine-gun-like)
// ----------------------------------------------------------------
const prevVy = new WeakMap();
function checkImpacts() {
  for (const b of bodies) {
    const wasFast = (prevVy.get(b) ?? 0) > 220;
    const nowSlow = Math.abs(b.vy) < 120;
    const nearFloor = b.y + b.radius >= FLOOR_Y - 4;
    if (wasFast && nowSlow && nearFloor) {
      mixer.play(thudAudio, {
        channel: 'sfx',
        rate: 0.8 + Math.random() * 0.5
      });
    }
    prevVy.set(b, b.vy);
  }
}

// ----------------------------------------------------------------
// Verlet rope — anchored to top centre, free tail draggable
// ----------------------------------------------------------------
const rope = Verlet({ gravity: { x: 0, y: 220 }, iterations: 12 });
const ropePoints = [];
const ROPE_X = W * 0.78;
const ROPE_SEGS = 14;
const ROPE_LEN = 14;
ropePoints.push(rope.point(ROPE_X, 0, { pinned: true }));
for (let i = 1; i <= ROPE_SEGS; i++) {
  const p = rope.point(ROPE_X, i * ROPE_LEN);
  rope.link(ropePoints[i - 1], p);
  ropePoints.push(p);
}
const ropeTail = ropePoints[ropePoints.length - 1];

// ----------------------------------------------------------------
// Mouse — drag rope tail when grabbed; otherwise hold-to-drop
// ----------------------------------------------------------------
let mouseX = 0;
let mouseY = 0;
let mouseDown = false;
let dragging = null;

function localPos(e) {
  const r = canvas.getBoundingClientRect();
  return [e.clientX - r.x, e.clientY - r.y];
}

canvas.addEventListener('mousemove', e => {
  [mouseX, mouseY] = localPos(e);
  if (dragging) {
    dragging.x = mouseX;
    dragging.y = mouseY;
    dragging.px = mouseX;
    dragging.py = mouseY;
  }
});
canvas.addEventListener('mousedown', e => {
  [mouseX, mouseY] = localPos(e);
  mouseDown = true;
  // also grab the rope tail if the click landed near it. dragging
  // and mouseDown coexist — the playing state's spawn logic checks
  // `!dragging`, so a rope grab doesn't accidentally fire circles.
  const dx = mouseX - ropeTail.x;
  const dy = mouseY - ropeTail.y;
  if (Math.hypot(dx, dy) < 22) dragging = ropeTail;
});
canvas.addEventListener('mouseup', () => {
  mouseDown = false;
  dragging = null;
});

// ----------------------------------------------------------------
// Tween manager — drives the title fade and "new best" pop
// ----------------------------------------------------------------
const tweens = Tweens();
const titleFade = { a: 0 };
let bestPopElapsed = 1; // seconds elapsed in the current pop; >=1 = idle

// ----------------------------------------------------------------
// FSM — title / playing / paused
// ----------------------------------------------------------------
const game = FSM({
  initial: 'title',
  states: {
    title: {
      enter() {
        titleFade.a = 0;
        tweens.add(titleFade, { a: 1 }, 0.6, easeOutCubic);
      },
      update() {
        // first click moves on. mouseDown stays set so a held click
        // immediately starts spawning in the playing state — feels
        // more responsive than forcing a release-and-re-click.
        if (mouseDown) game.transition('playing');
      },
      render() {
        context.save();
        context.globalAlpha = titleFade.a;
        context.fillStyle = '#fff';
        context.font = 'bold 44px ui-monospace, monospace';
        context.textAlign = 'center';
        context.fillText('PARTICLE GARDEN', W / 2, H / 2 - 14);
        context.font = '14px ui-monospace, monospace';
        context.fillStyle = '#aaa';
        context.fillText('click anywhere to start', W / 2, H / 2 + 24);
        context.restore();
      }
    },

    playing: {
      update(dt) {
        // cap dt to avoid the spiral of death after a tab refocus
        const step = Math.min(dt, 1 / 30);
        if (mouseDown && !dragging) {
          // throttle spawn rate
          if (Math.random() < 0.6) spawnCircle(mouseX, mouseY);
        }
        world.step(step);
        rope.step(step);
        checkImpacts();
        // remove escapees so the array doesn't grow unbounded
        for (let i = bodies.length - 1; i >= 0; i--) {
          const b = bodies[i];
          if (b.y > H + 200 || b.x < -200 || b.x > W + 200) {
            world.remove(b);
            bodies.splice(i, 1);
          }
        }
      },
      render() {
        // floor
        context.fillStyle = '#3a3a55';
        context.fillRect(0, FLOOR_Y, W, H - FLOOR_Y);

        // bodies — rendered with a tick mark so rotation is visible
        for (const b of bodies) {
          context.save();
          context.translate(b.x, b.y);
          context.rotate(b.rotation || 0);
          context.fillStyle = b.color;
          context.beginPath();
          context.arc(0, 0, b.radius, 0, Math.PI * 2);
          context.fill();
          context.strokeStyle = 'rgba(0,0,0,0.4)';
          context.lineWidth = 2;
          context.beginPath();
          context.moveTo(0, 0);
          context.lineTo(b.radius * 0.7, 0);
          context.stroke();
          context.restore();
        }

        // rope
        context.strokeStyle = '#bbb';
        context.lineWidth = 2;
        context.beginPath();
        for (let i = 0; i < ropePoints.length; i++) {
          const p = ropePoints[i];
          if (i === 0) context.moveTo(p.x, p.y);
          else context.lineTo(p.x, p.y);
        }
        context.stroke();
        context.fillStyle = '#ff7eb6';
        context.beginPath();
        context.arc(ropeTail.x, ropeTail.y, 6, 0, Math.PI * 2);
        context.fill();

        // HUD
        context.fillStyle = '#888';
        context.font = '12px ui-monospace, monospace';
        context.textAlign = 'left';
        context.fillText('count ' + bodies.length, 12, 22);
        context.fillText('best  ' + bestCount, 12, 40);

        // "NEW BEST" pop — easeOutBack scale-in then fade
        if (bestPopElapsed < 1.5) {
          bestPopElapsed += 1 / 60;
          const scale = easeOutBack(Math.min(bestPopElapsed * 2.5, 1));
          const fade = bestPopElapsed > 1
            ? Math.max(0, 1 - (bestPopElapsed - 1) / 0.5)
            : 1;
          context.save();
          context.translate(W / 2, 64);
          context.scale(scale, scale);
          context.globalAlpha = fade;
          context.fillStyle = '#facc15';
          context.font = 'bold 22px ui-monospace, monospace';
          context.textAlign = 'center';
          context.fillText('NEW BEST: ' + bestCount, 0, 0);
          context.restore();
        }
      }
    },

    paused: {
      enter() {
        // swallow any held click so resume doesn't immediately spawn
        mouseDown = false;
        dragging = null;
      },
      // update intentionally absent — paused freezes the world
      render() {
        context.fillStyle = 'rgba(0, 0, 0, 0.55)';
        context.fillRect(0, 0, W, H);
        context.fillStyle = '#fff';
        context.font = 'bold 32px ui-monospace, monospace';
        context.textAlign = 'center';
        context.fillText('PAUSED', W / 2, H / 2 - 8);
        context.fillStyle = '#aaa';
        context.font = '13px ui-monospace, monospace';
        context.fillText('Esc to resume', W / 2, H / 2 + 22);
      }
    }
  }
});
game.start();

// keyboard — onKey fires on rising edge so a held key triggers once
onKey('esc', () => {
  if (game.current === 'playing') game.push('paused');
  else if (game.current === 'paused') game.pop();
});
onKey('r', () => {
  if (game.current === 'playing') {
    for (const b of bodies) world.remove(b);
    bodies.length = 0;
  }
});

// ----------------------------------------------------------------
// Main loop
// ----------------------------------------------------------------
GameLoop({
  update(dt) {
    game.update(dt);
    tweens.tick(dt);
  },
  render() {
    game.render();
  }
}).start();
