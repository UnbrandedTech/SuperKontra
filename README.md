# SuperKontra

Opt-in extensions for [kontra.js](https://github.com/straker/kontra) — physics, broadphase, and other primitives kontra deliberately leaves out. Designed to compose with kontra's factory style and stay byte-aware (each module independent and tree-shakeable), but without kontra's strict 13KB-zipped budget — so source uses modern JS.

This repo currently consumes a local kontra fork via `file:../kontra` while [straker is on a feature-work hiatus](https://github.com/straker/kontra). Swap to the published package when upstream resumes.

## Modules

| Module | Purpose | Status |
|---|---|---|
| `super-kontra/collide` | SAT-based collision detection — AABB, circle, polygon. Drop-in superset of kontra's `collides()`. | implemented |
| `super-kontra/physics-rigid` | Impulse-based rigid-body solver — gravity, mass, friction, restitution, **rotation** (angular velocity, inertia, off-centre torque). | implemented |
| `super-kontra/physics-verlet` | Positional Verlet solver — particles, distance constraints, pin constraints. Ropes / cloth / softbody. | implemented |
| `super-kontra/state` | Versioned localStorage saves with automatic schema migrations and string export/import for cloud sync. | implemented |
| `super-kontra/audio` | Channel-based mixer over `HTMLAudioElement`. Pulls audio by name from kontra's `audioAssets`, supports per-channel volume/mute/exclusive playback, fades, and overlapping SFX. | implemented |
| `super-kontra/fsm` | Finite-state machine for game flow (menu/playing/paused/gameOver). Stack-based — push/pop overlay states like pause menus on top of an active scene. Per-state lifecycle hooks dispatched from your kontra GameLoop. | implemented |
| `super-kontra/tween` | Tween manager + 19 Penner easing functions (linear/quad/cubic/sine/expo/back/bounce in/out/inOut variants). Interpolate any object's properties over time; tick(dt) advances all active tweens. | implemented |
| `super-kontra/path` | A* pathfinding on a 2D tile grid. 4- or 8-way connectivity, weighted costs, pluggable heuristic. Drop-in for kontra TileEngine layer data. | implemented |

## Install (during local dev)

```bash
# in your kontra fork
cd ~/Projects/Personal/kontra
npm run build

# in your game
npm install ../SuperKontra
```

## Usage

```js
import { collides, World, Verlet } from 'super-kontra';
import { Sprite } from 'kontra';

// collision
let a = Sprite({ x: 0, y: 0, width: 10, height: 10 });
let b = Sprite({ x: 5, y: 5, width: 10, height: 10 });
collides(a, b);                // true (drop-in for kontra.collides — also handles polygons/circles)

// rigid bodies (with rotation)
let world = World({ gravity: { x: 0, y: 500 } });
let player = world.add({
  x: 100, y: 0, width: 32, height: 32,
  mass: 1, restitution: 0.2, friction: 0.4
  // inertia auto-computed from mass + dimensions; pass `inertia: 0`
  // to disable rotation on a body, or supply a custom number
});
let ground = world.add({
  x: 0, y: 400, width: 800, height: 50,
  mass: 0  // mass: 0 = static (immovable, unrotatable)
});
world.step(1 / 60);            // integrate one frame
// off-centre hits induce spin: read player.rotation each frame
// and assign it to your sprite

// verlet
let cloth = Verlet();
let p1 = cloth.point(100, 100, { pinned: true });
let p2 = cloth.point(100, 200);
cloth.link(p1, p2);
cloth.step(1 / 60);

// audio mixer — pull-pattern, paired with kontra's audioAssets
import { audioAssets } from 'kontra';
let mixer = Mixer({ resolve: name => audioAssets[name] });
mixer.channel('music', { volume: 0.5, exclusive: true });
mixer.channel('sfx',   { volume: 0.8 });

let theme = mixer.play('intro', { channel: 'music', loop: true });
mixer.play('laser', { channel: 'sfx', rate: 1 + Math.random() * 0.2 });

// duck during dialog
mixer.channel('music').volume = 0.2;

// fade out the theme over 2s, advanced by your game loop
theme.fadeOut(2);
// in your update():
mixer.tick(1 / 60);

// finite-state machine for game flow (with stacked overlays)
let game = FSM({
  initial: 'menu',
  states: {
    menu: {
      enter() { /* show title */ },
      update() { if (kontra.keyPressed('enter')) game.transition('playing'); }
    },
    playing: {
      enter(opts) { /* start level opts.level */ },
      update(dt) { /* run game */ },
      render()   { /* draw game */ }
    },
    paused: {
      // a stacked state — playing renders behind it, but only paused
      // ticks while paused is on top
      render() { /* draw pause overlay */ }
    }
  }
});
game.start();

let loop = GameLoop({
  update(dt) { game.update(dt); },
  render()   { game.render(); }
});

game.transition('playing', { level: 1 });
// open a pause menu over the playing scene without losing it
game.push('paused');
game.pop();   // dismiss; playing continues without re-entering

// tween — animate object properties over time with easing
let tweens = Tweens();
tweens.add(player, { x: 200, alpha: 0 }, 1.5, easeOutQuad)
  .then(() => console.log('arrived'));
loop.update = dt => { game.update(dt); tweens.tick(dt); };

// pathfinding — A* over a kontra TileEngine collision layer
import { findPath } from 'super-kontra/path';
let layer = tileEngine.layerMap.collision;
let path = findPath({
  start: { col: playerCol, row: playerRow },
  goal:  { col: targetCol, row: targetRow },
  width: tileEngine.width,
  height: tileEngine.height,
  cost: (col, row) =>
    layer.data[row * tileEngine.width + col] ? Infinity : 1,
  diagonal: true
});
// path = [{col, row}, ...] from start to goal, or null if blocked

// versioned save / load
let save = Save({
  key: 'mygame',
  version: 2,
  migrations: {
    1: data => ({ ...data, mp: 10 })  // v1 saves get mp added
  }
});
save.write({ player: { x: 100, hp: 50, mp: 10 }, level: 3 });
let state = save.read();   // null if no save; auto-migrates older versions
let blob  = save.dump();   // raw JSON string for download / clipboard
save.restore(blob);        // import a string from elsewhere
save.exists();             // boolean
save.clear();              // delete this slot
```

## Runtime state — recommended pattern

The `Save` module handles persistence; how you organize state at runtime is up to you. A few principles that pair well with kontra:

- **Mutate directly** — `player.hp -= 10`. Don't wrap state in actions/reducers; games mutate too often for that overhead to be worth it.
- **One world root** that owns the entity collections — `world.player`, `world.enemies`, `world.score`, `world.flags`. Saving = serializing this root.
- **Underscore-prefixed fields are ephemeral** (`_dirty`, `_animFrame`). Skip them in `toSave()`. kontra already uses this convention internally.
- **IDs for cross-references**, not direct object pointers. JSON can't represent cycles cleanly and load order becomes brittle.
- **Per-entity `toSave()` / `fromSave()`** as the seam between your runtime objects and persistence:

  ```js
  class Player extends SpriteClass {
    toSave() { return { x: this.x, y: this.y, hp: this.hp, inv: this.inv }; }
    fromSave(d) { Object.assign(this, d); }
  }

  // top-level save call
  save.write({
    player: world.player.toSave(),
    enemies: world.enemies.map(e => e.toSave()),
    flags: world.flags
  });

  // load
  const data = save.read();
  if (data) {
    world.player.fromSave(data.player);
    world.enemies = data.enemies.map(d => Enemy({ ...d }));
    world.flags = data.flags;
  }
  ```

  Adding a new field is two lines (one in each method); refactoring a renamed field is contained; ephemeral state is auto-skipped.

- **Save at boundaries**, not every frame — level complete, room transition, autosave tick, pause menu. Never mid-physics-step.

## Demo

A playable browser demo lives in [`demo/`](./demo/index.html). It exercises seven of the modules together (physics-rigid + verlet + collide + fsm + state + audio + tween) — drop circles with the mouse, drag the verlet rope, pause with `Esc`, watch the high-count save persist across reloads.

ESM imports resolve through an importmap in `index.html`, so you need a local server (browsers won't load native ESM from `file://`). From the repo root:

```bash
npm install                   # populates node_modules/kontra via the file: dep
python3 -m http.server 8080   # or any static-file server
open http://localhost:8080/demo/
```

## Tests

```bash
npm test
```

Tests run under Node's built-in `node --test` runner — no Karma, no browser needed for the math layer.

## License

MIT.
