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
