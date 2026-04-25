/**
 * Finite-state machine for game flow — menu → playing → paused →
 * game over → high-score, etc.
 *
 * Each state is a bag of optional lifecycle hooks: `enter(payload)`,
 * `exit()`, `update(dt)`, `render()`. Missing hooks are silently
 * skipped. The machine itself doesn't drive your loop — you call
 * `fsm.update(dt)` and `fsm.render()` from your kontra GameLoop and
 * they dispatch to whichever state is current.
 *
 * Transitions are unrestricted: any state can move to any other.
 * Re-entering the same state still fires exit + enter (useful for
 * "restart level"). Misspelt state names throw at transition time
 * rather than failing silently.
 *
 * Game data lives in your closure scope, not on the state objects —
 * each state is just behaviour, and uses ordinary JS variables for
 * what it needs to remember. The `payload` argument to enter() is
 * the only data the FSM transports.
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

  let current = null;
  let previous = null;

  // dispatch a hook on the current state if it exists; missing hooks
  // (states that don't care about update, say) silently no-op
  function call(hook, ...args) {
    const state = states[current];
    state?.[hook]?.(...args);
  }

  /**
   * Enter the initial state. Calling twice throws — restart by
   * transitioning to a state and back, not by re-starting.
   * @param {*} [payload] forwarded to the initial state's enter()
   */
  function start(payload) {
    if (current !== null) {
      throw Error('FSM.start(): already started');
    }
    current = initial;
    call('enter', payload);
  }

  /**
   * Move to a different state. Fires the current state's exit() and
   * the target state's enter(). Same-state transitions are allowed
   * (and run both hooks) — useful for "restart level".
   * @param {string} name
   * @param {*} [payload] forwarded to the target state's enter()
   */
  function transition(name, payload) {
    if (!states[name]) {
      throw Error(`FSM.transition(): unknown state "${name}"`);
    }
    if (current === null) {
      throw Error('FSM.transition() called before start()');
    }
    call('exit');
    previous = current;
    current = name;
    call('enter', payload);
  }

  /**
   * Forward an update tick to the current state's update(dt) hook.
   * Silently no-ops before start() so a game-loop tick doesn't
   * crash on the very first frame.
   * @param {number} dt
   */
  function update(dt) {
    if (current === null) return;
    call('update', dt);
  }

  /** Forward a render to the current state's render() hook. */
  function render() {
    if (current === null) return;
    call('render');
  }

  return {
    start,
    transition,
    update,
    render,
    get current() {
      return current;
    },
    get previous() {
      return previous;
    }
  };
}
