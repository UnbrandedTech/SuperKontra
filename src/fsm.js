/**
 * Finite-state machine for game flow — menu → playing → paused →
 * game over → high-score, etc.
 *
 * States are stacked. `transition(name)` REPLACES the top of the
 * stack (calls the old state's exit, the new state's enter).
 * `push(name)` stacks a new state on top without exiting the one
 * beneath; `pop()` exits the top state and reveals the one beneath.
 * `update(dt)` only ticks the top state, but `render()` walks the
 * stack from bottom to top so a paused state can render its overlay
 * on top of the still-rendered playing scene.
 *
 * Each state is a bag of optional lifecycle hooks: `enter(payload)`,
 * `exit()`, `update(dt)`, `render()`. Missing hooks silently no-op.
 *
 * Game data lives in your closure scope, not on the state objects —
 * each state is just behaviour. The `payload` on enter() is the
 * only data the FSM transports.
 */

/**
 * @typedef {Object} StateHooks
 * @property {(payload?: any) => void} [enter]
 * @property {() => void} [exit]
 * @property {(dt: number) => void} [update]
 * @property {() => void} [render]
 */

/**
 * @param {Object} options
 * @param {string} options.initial - name of the state to start in
 * @param {{[name: string]: StateHooks}} options.states
 */
export function FSM({ initial, states }) {
  if (!initial) throw Error('FSM: missing `initial` state name');
  if (!states) throw Error('FSM: missing `states` map');
  if (!states[initial]) {
    throw Error(`FSM: initial state "${initial}" is not in states`);
  }

  // stack of state names. top of stack = current. start() seeds it
  // with the initial state; transition replaces the top, push/pop
  // add and remove a layer.
  const stack = [];
  let previous = null;

  function call(name, hook, ...args) {
    states[name]?.[hook]?.(...args);
  }

  function topName() {
    return stack[stack.length - 1] ?? null;
  }

  /**
   * Enter the initial state. Calling twice throws — restart by
   * transitioning to a state and back, not by re-starting.
   * @param {*} [payload] forwarded to the initial state's enter()
   */
  function start(payload) {
    if (stack.length) throw Error('FSM.start(): already started');
    stack.push(initial);
    call(initial, 'enter', payload);
  }

  /**
   * Replace the top state with `name`. Fires the top state's exit()
   * and the target state's enter(). Same-name re-entry is allowed
   * (and runs both hooks) — useful for "restart level".
   * Stack depth is unchanged.
   * @param {string} name
   * @param {*} [payload] forwarded to enter()
   */
  function transition(name, payload) {
    if (!states[name]) {
      throw Error(`FSM.transition(): unknown state "${name}"`);
    }
    if (!stack.length) {
      throw Error('FSM.transition() called before start()');
    }
    const old = topName();
    call(old, 'exit');
    previous = old;
    stack[stack.length - 1] = name;
    call(name, 'enter', payload);
  }

  /**
   * Stack a new state on top. The state below is NOT exited — it
   * stays in the stack so a later pop() reveals it. Useful for
   * pause menus and modal dialogs over an active scene.
   * @param {string} name
   * @param {*} [payload]
   */
  function push(name, payload) {
    if (!states[name]) {
      throw Error(`FSM.push(): unknown state "${name}"`);
    }
    if (!stack.length) {
      throw Error('FSM.push() called before start()');
    }
    stack.push(name);
    call(name, 'enter', payload);
  }

  /**
   * Remove the top state. Fires its exit(). The state beneath
   * becomes current — its enter() is NOT called again (it never
   * really left). Throws if only the initial state remains.
   */
  function pop() {
    if (stack.length <= 1) {
      throw Error('FSM.pop(): stack is at the initial state');
    }
    const top = stack.pop();
    call(top, 'exit');
    previous = top;
  }

  /**
   * Forward an update tick to the TOP state's update(dt) hook.
   * No-ops before start().
   * @param {number} dt
   */
  function update(dt) {
    const top = topName();
    if (top !== null) call(top, 'update', dt);
  }

  /**
   * Walk the stack bottom-to-top, calling render() on each. This
   * means a paused state pushed over a playing state will draw its
   * overlay on top of the still-rendered scene — the standard
   * pause-menu pattern.
   */
  function render() {
    for (const name of stack) call(name, 'render');
  }

  return {
    start,
    transition,
    push,
    pop,
    update,
    render,
    get current() {
      return topName();
    },
    get previous() {
      return previous;
    },
    get depth() {
      return stack.length;
    }
  };
}
