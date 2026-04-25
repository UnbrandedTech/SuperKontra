import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FSM } from '../src/fsm.js';

// helper for building a state object with spies as hooks
function spies() {
  const calls = [];
  const make = name => (...args) => calls.push([name, ...args]);
  return {
    calls,
    state: {
      enter: make('enter'),
      exit: make('exit'),
      update: make('update'),
      render: make('render')
    }
  };
}

test('start() enters the initial state', () => {
  const a = spies();
  const fsm = FSM({
    initial: 'a',
    states: { a: a.state }
  });
  fsm.start();
  assert.equal(fsm.current, 'a');
  assert.deepEqual(a.calls, [['enter', undefined]]);
});

test('start() forwards a payload to the initial state', () => {
  const a = spies();
  const fsm = FSM({
    initial: 'a',
    states: { a: a.state }
  });
  fsm.start({ level: 1 });
  assert.deepEqual(a.calls[0], ['enter', { level: 1 }]);
});

test('start() throws when called twice', () => {
  const fsm = FSM({
    initial: 'a',
    states: { a: {} }
  });
  fsm.start();
  assert.throws(() => fsm.start(), /already started/);
});

test('transition() fires exit() on the old state then enter() on the new', () => {
  const a = spies();
  const b = spies();
  const fsm = FSM({
    initial: 'a',
    states: { a: a.state, b: b.state }
  });
  fsm.start();
  a.calls.length = 0; // discard initial enter
  fsm.transition('b', 99);
  assert.deepEqual(a.calls, [['exit']]);
  assert.deepEqual(b.calls, [['enter', 99]]);
  assert.equal(fsm.current, 'b');
  assert.equal(fsm.previous, 'a');
});

test('transition() to an unknown state throws', () => {
  const fsm = FSM({ initial: 'a', states: { a: {} } });
  fsm.start();
  assert.throws(
    () => fsm.transition('zzz'),
    /unknown state "zzz"/
  );
});

test('transition() before start() throws', () => {
  const fsm = FSM({ initial: 'a', states: { a: {}, b: {} } });
  assert.throws(() => fsm.transition('b'), /before start/);
});

test('update() and render() dispatch to the current state', () => {
  const a = spies();
  const b = spies();
  const fsm = FSM({
    initial: 'a',
    states: { a: a.state, b: b.state }
  });
  fsm.start();
  fsm.update(0.016);
  fsm.render();
  // a got enter, update, render
  assert.deepEqual(
    a.calls.map(c => c[0]),
    ['enter', 'update', 'render']
  );
  fsm.transition('b');
  fsm.update(0.016);
  fsm.render();
  // b got enter, update, render
  assert.deepEqual(
    b.calls.map(c => c[0]),
    ['enter', 'update', 'render']
  );
});

test('missing hooks no-op silently', () => {
  // a state defined as `{}` — no hooks at all — should never throw
  const fsm = FSM({
    initial: 'silent',
    states: { silent: {} }
  });
  assert.doesNotThrow(() => fsm.start());
  assert.doesNotThrow(() => fsm.update(0.016));
  assert.doesNotThrow(() => fsm.render());
  assert.doesNotThrow(() =>
    FSM({ initial: 'a', states: { a: {}, b: {} } }).start()
  );
});

test('update() before start() is a no-op (does not throw, does not call hooks)', () => {
  const a = spies();
  const fsm = FSM({ initial: 'a', states: { a: a.state } });
  fsm.update(0.016);
  fsm.render();
  assert.deepEqual(a.calls, []);
});

test('previous tracks the most recently exited state', () => {
  const fsm = FSM({
    initial: 'a',
    states: { a: {}, b: {}, c: {} }
  });
  fsm.start();
  assert.equal(fsm.previous, null);
  fsm.transition('b');
  assert.equal(fsm.previous, 'a');
  fsm.transition('c');
  assert.equal(fsm.previous, 'b');
});

test('re-entering the same state still fires exit + enter (useful for "restart level")', () => {
  const a = spies();
  const fsm = FSM({ initial: 'a', states: { a: a.state } });
  fsm.start();
  a.calls.length = 0;
  fsm.transition('a', 'restart');
  assert.deepEqual(a.calls, [
    ['exit'],
    ['enter', 'restart']
  ]);
  assert.equal(fsm.current, 'a');
  assert.equal(fsm.previous, 'a');
});

test('constructor validates required options', () => {
  assert.throws(() => FSM({ states: { a: {} } }), /missing `initial`/);
  assert.throws(() => FSM({ initial: 'a' }), /missing `states`/);
  assert.throws(
    () => FSM({ initial: 'missing', states: { a: {} } }),
    /not in states/
  );
});

test('current is null until start() is called', () => {
  const fsm = FSM({ initial: 'a', states: { a: {} } });
  assert.equal(fsm.current, null);
  fsm.start();
  assert.equal(fsm.current, 'a');
});

// --------------------------------------------------------------
// stack semantics — push / pop / depth
// --------------------------------------------------------------

test('push() stacks a new state without exiting the underlying one', () => {
  const playing = spies();
  const paused = spies();
  const fsm = FSM({
    initial: 'playing',
    states: { playing: playing.state, paused: paused.state }
  });
  fsm.start();
  playing.calls.length = 0; // discard initial enter
  fsm.push('paused');
  // playing's exit is NOT called — it's still in the stack
  assert.deepEqual(playing.calls, []);
  // paused's enter IS called
  assert.deepEqual(paused.calls, [['enter', undefined]]);
  assert.equal(fsm.current, 'paused');
  assert.equal(fsm.depth, 2);
});

test('pop() exits the top state and reveals the one beneath', () => {
  const playing = spies();
  const paused = spies();
  const fsm = FSM({
    initial: 'playing',
    states: { playing: playing.state, paused: paused.state }
  });
  fsm.start();
  fsm.push('paused');
  paused.calls.length = 0;
  playing.calls.length = 0;

  fsm.pop();
  // paused exits; playing does NOT re-enter (it never really left)
  assert.deepEqual(paused.calls, [['exit']]);
  assert.deepEqual(playing.calls, []);
  assert.equal(fsm.current, 'playing');
  assert.equal(fsm.depth, 1);
  assert.equal(fsm.previous, 'paused');
});

test('update() only ticks the top state', () => {
  const playing = spies();
  const paused = spies();
  const fsm = FSM({
    initial: 'playing',
    states: { playing: playing.state, paused: paused.state }
  });
  fsm.start();
  fsm.push('paused');
  playing.calls.length = 0;
  paused.calls.length = 0;

  fsm.update(0.016);

  assert.deepEqual(
    playing.calls.map(c => c[0]),
    []
  );
  assert.deepEqual(
    paused.calls.map(c => c[0]),
    ['update']
  );
});

test('render() walks the stack bottom-to-top so overlays draw on top', () => {
  const order = [];
  const fsm = FSM({
    initial: 'playing',
    states: {
      playing: { render: () => order.push('playing') },
      paused: { render: () => order.push('paused') }
    }
  });
  fsm.start();
  fsm.push('paused');
  fsm.render();
  assert.deepEqual(order, ['playing', 'paused']);
});

test('depth reflects the current stack size', () => {
  const fsm = FSM({
    initial: 'a',
    states: { a: {}, b: {}, c: {} }
  });
  assert.equal(fsm.depth, 0);
  fsm.start();
  assert.equal(fsm.depth, 1);
  fsm.push('b');
  assert.equal(fsm.depth, 2);
  fsm.push('c');
  assert.equal(fsm.depth, 3);
  fsm.pop();
  assert.equal(fsm.depth, 2);
  fsm.pop();
  assert.equal(fsm.depth, 1);
});

test('pop() throws when only the initial state remains', () => {
  const fsm = FSM({ initial: 'a', states: { a: {} } });
  fsm.start();
  assert.throws(() => fsm.pop(), /initial state/);
});

test('push() to an unknown state throws', () => {
  const fsm = FSM({ initial: 'a', states: { a: {} } });
  fsm.start();
  assert.throws(() => fsm.push('zzz'), /unknown state/);
});

test('push() before start() throws', () => {
  const fsm = FSM({ initial: 'a', states: { a: {}, b: {} } });
  assert.throws(() => fsm.push('b'), /before start/);
});

test('transition() replaces the top of the stack without growing it', () => {
  const fsm = FSM({
    initial: 'a',
    states: { a: {}, b: {}, c: {} }
  });
  fsm.start();
  fsm.push('b');
  assert.equal(fsm.depth, 2);
  fsm.transition('c');
  // top went from b → c; depth stays 2; a is still underneath
  assert.equal(fsm.depth, 2);
  assert.equal(fsm.current, 'c');
  fsm.pop();
  assert.equal(fsm.current, 'a');
});

test('push payload is forwarded to enter()', () => {
  const dialog = spies();
  const fsm = FSM({
    initial: 'a',
    states: { a: {}, dialog: dialog.state }
  });
  fsm.start();
  fsm.push('dialog', { message: 'hi' });
  assert.deepEqual(dialog.calls, [['enter', { message: 'hi' }]]);
});

test('hooks can call into pop() to dismiss themselves', () => {
  // common pattern: a "splash" state pops itself after a tick
  let ticks = 0;
  const fsm = FSM({
    initial: 'main',
    states: {
      main: {},
      splash: {
        update() {
          ticks++;
          if (ticks >= 2) fsm.pop();
        }
      }
    }
  });
  fsm.start();
  fsm.push('splash');
  fsm.update(0.016);
  assert.equal(fsm.current, 'splash');
  fsm.update(0.016);
  assert.equal(fsm.current, 'main');
});

test('hooks can call transition() to chain states', () => {
  // common pattern: a "loading" state auto-transitions to "playing"
  // when its update tick reports the assets are ready
  let assetsReady = false;
  const fsm = FSM({
    initial: 'loading',
    states: {
      loading: {
        update() {
          if (assetsReady) fsm.transition('playing');
        }
      },
      playing: {}
    }
  });
  fsm.start();
  fsm.update(0.016);
  assert.equal(fsm.current, 'loading');
  assetsReady = true;
  fsm.update(0.016);
  assert.equal(fsm.current, 'playing');
});
