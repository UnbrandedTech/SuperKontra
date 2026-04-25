/**
 * Channel-based audio mixer over `HTMLAudioElement`. Pulls audio
 * by name via a `resolve` callback rather than loading anything
 * itself — pair with kontra's asset loader (`audioAssets[name]` or
 * `query('a', name)`) and the mixer stays storage-agnostic.
 *
 * Each `play()` clones the resolved audio so multiple instances of
 * the same sound can overlap (machine-gun fire, particle hits) and
 * returns a handle for individual control.
 *
 * Volumes cascade: `master × channel × instance`, with mute zeroing
 * at any tier. Channel changes propagate to currently-playing
 * handles immediately — set `mixer.channel('music').volume = 0.2`
 * to duck during dialog, restore when done.
 *
 * Fades are driven by `mixer.tick(dt)` from the game loop (no
 * setTimeout / requestAnimationFrame baked in) so timing is
 * deterministic and tied to your update rate.
 *
 * Browsers gate audio on user gesture — calling `play()` before
 * any input may produce a console warning and a silent track.
 * The mixer doesn't try to work around this; trigger the first
 * play from a click/key handler.
 */

/**
 * @typedef {Object} MixerOptions
 * @property {(name: string) => HTMLAudioElement | null | undefined} [resolve]
 *   - looks up an audio element by name. Typically
 *   `name => audioAssets[name]` if pairing with kontra.
 */

/**
 * @typedef {Object} PlayOptions
 * @property {string} [channel='default']
 * @property {boolean} [loop=false]
 * @property {number} [rate=1] - playback rate (1 = normal pitch)
 * @property {number} [volume=1] - per-instance multiplier (0..1)
 */

/**
 * @typedef {Object} ChannelOptions
 * @property {number} [volume=1]
 * @property {boolean} [muted=false]
 * @property {boolean} [exclusive=false] - if true, starting a new
 *   playback stops any other playback on this channel (music tracks)
 */

/**
 * @param {MixerOptions} [options]
 */
export function Mixer({ resolve } = {}) {
  // private master state — exposed via the accessors on `mixer`
  let masterVolume = 1;
  let masterMuted = false;

  /** @type {Map<string, any>} */
  const channels = new Map();

  /** @type {Set<any>} */
  const handles = new Set();

  // ensure a default channel always exists — convenience for
  // users who don't bother with channel definitions
  channel('default');

  function refreshAll() {
    for (const h of handles) h._applyVolume();
  }

  /**
   * Define or fetch a channel. Calling on an existing name without
   * `opts` returns it; passing `opts` updates only the keys present.
   * @param {string} name
   * @param {ChannelOptions} [opts]
   */
  function channel(name, opts) {
    let ch = channels.get(name);
    if (ch) {
      if (opts) {
        if ('volume' in opts) ch.volume = opts.volume;
        if ('muted' in opts) ch.muted = opts.muted;
        if ('exclusive' in opts) ch.exclusive = opts.exclusive;
      }
      return ch;
    }
    let _vol = opts?.volume ?? 1;
    let _muted = opts?.muted ?? false;
    ch = {
      name,
      exclusive: opts?.exclusive ?? false,
      active: new Set(),
      get volume() {
        return _vol;
      },
      set volume(v) {
        _vol = v;
        refreshAll();
      },
      get muted() {
        return _muted;
      },
      set muted(m) {
        _muted = m;
        refreshAll();
      }
    };
    channels.set(name, ch);
    return ch;
  }

  /**
   * Play a sound. `audioOrName` is either a name (passed through
   * `resolve`) or a raw `HTMLAudioElement`. Returns null if the
   * name doesn't resolve, otherwise a handle.
   * @param {string | HTMLAudioElement} audioOrName
   * @param {PlayOptions} [opts]
   */
  function play(audioOrName, opts = {}) {
    const audio =
      typeof audioOrName === 'string'
        ? resolve?.(audioOrName)
        : audioOrName;
    if (!audio) return null;

    const ch = channels.get(opts.channel ?? 'default') || channels.get('default');

    // exclusive channels (music) stop existing playback so a new
    // track replaces the old one cleanly
    if (ch.exclusive) {
      for (const h of [...ch.active]) h.stop();
    }

    const node = audio.cloneNode();
    node.loop = !!opts.loop;
    node.playbackRate = opts.rate ?? 1;

    const handle = makeHandle(node, ch, opts.volume ?? 1);
    handle._applyVolume();

    // browsers reject play() if user hasn't interacted yet — we
    // catch and quietly stop so the handle doesn't leak
    const pr = node.play();
    if (pr && typeof pr.catch === 'function') {
      pr.catch(() => handle.stop());
    }

    return handle;
  }

  function makeHandle(node, ch, instanceVolume) {
    const handle = {
      node,
      channel: ch,
      volume: instanceVolume,
      _stopped: false,
      _fade: null,
      _applyVolume() {
        const muted = masterMuted || ch.muted;
        node.volume = muted
          ? 0
          : masterVolume * ch.volume * handle.volume;
      },
      stop() {
        if (handle._stopped) return;
        handle._stopped = true;
        node.pause();
        // reset so a future cloneNode-based replay starts fresh —
        // the node itself is one-shot and will be GC'd
        node.currentTime = 0;
        ch.active.delete(handle);
        handles.delete(handle);
      },
      /**
       * Fade volume to 0 over `seconds`, then stop. Fades are
       * advanced by `mixer.tick(dt)` from your game loop.
       */
      fadeOut(seconds) {
        if (seconds <= 0) {
          handle.stop();
          return;
        }
        handle._fade = {
          fromVolume: handle.volume,
          duration: seconds,
          elapsed: 0
        };
      }
    };

    ch.active.add(handle);
    handles.add(handle);

    // auto-clean when one-shot audio finishes
    node.addEventListener('ended', () => handle.stop(), { once: true });

    return handle;
  }

  /**
   * Advance fades. Call from your game loop with `dt` in seconds.
   * @param {number} dt
   */
  function tick(dt) {
    for (const h of [...handles]) {
      if (!h._fade) continue;
      h._fade.elapsed += dt;
      const t = h._fade.elapsed / h._fade.duration;
      if (t >= 1) {
        h.stop();
      } else {
        h.volume = h._fade.fromVolume * (1 - t);
        h._applyVolume();
      }
    }
  }

  /**
   * Stop every active sound across all channels.
   */
  function stopAll() {
    for (const h of [...handles]) h.stop();
  }

  /**
   * Stop every active sound on a single channel.
   * @param {string} name
   */
  function stop(name) {
    const ch = channels.get(name);
    if (!ch) return;
    for (const h of [...ch.active]) h.stop();
  }

  // assemble the mixer with master accessors so users can write
  // `mixer.volume = 0.5` and have it ripple through active handles
  const mixer = {
    channel,
    play,
    tick,
    stop,
    stopAll,
    get volume() {
      return masterVolume;
    },
    set volume(v) {
      masterVolume = v;
      refreshAll();
    },
    get muted() {
      return masterMuted;
    },
    set muted(m) {
      masterMuted = m;
      refreshAll();
    }
  };

  return mixer;
}
