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
 * Fetch an audio file as a Blob and return an HTMLAudioElement
 * pointing at a `blob:` URL. Avoids the HTTP Range requests that
 * `el.src = url; el.load()` triggers — those break under many
 * service workers (Workbox without explicit range handling, the
 * MDN tutorial SW patterns, the Wavedash and YT Playables
 * iframe SWs) and silently fail to load audio.
 *
 * Use this when you're shipping into a PWA / SW-mediated context.
 * For the simpler case (no service worker in the way) kontra's
 * `loadAudio(url)` is lighter and supports format negotiation.
 *
 *   import { Mixer, loadAudioBlob } from 'super-kontra/audio';
 *   const thud = await loadAudioBlob('/audio/thud.wav');
 *   const mixer = Mixer();
 *   mixer.play(thud);
 *
 * @param {string} url
 * @returns {Promise<HTMLAudioElement>}
 */
export async function loadAudioBlob(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw Error(
      `loadAudioBlob: HTTP ${response.status} for ${url}`
    );
  }
  const blob = await response.blob();
  const blobUrl = URL.createObjectURL(blob);
  const audio = new Audio();
  return new Promise((resolve, reject) => {
    // canplaythrough is the right ready-event for "fully loaded
    // and able to play start-to-finish without buffering" — the
    // semantic match for blob-based loading where bytes are local
    audio.addEventListener(
      'canplaythrough',
      () => resolve(audio),
      { once: true }
    );
    audio.addEventListener(
      'error',
      () =>
        reject(
          Error(`loadAudioBlob: audio decode failed for ${url}`)
        ),
      { once: true }
    );
    audio.src = blobUrl;
    audio.load();
  });
}

/**
 * @typedef {Object} MixerOptions
 * @property {(name: string) => HTMLAudioElement | null | undefined} [resolve]
 *   - looks up an audio element by name. Typically
 *   `name => audioAssets[name]` if pairing with kontra.
 * @property {Document} [document=globalThis.document] - DOM document
 *   to listen on for the first user gesture (iOS audio unlock).
 *   Defaults to `globalThis.document`. Pass a mock for tests, or
 *   `null` to disable gesture-gating entirely (useful in headless
 *   environments where you control playback timing).
 */

/**
 * @param {MixerOptions} [options]
 */
export function Mixer({
  resolve,
  document: doc = globalThis.document
} = {}) {
  // private master state — exposed via the accessors on `mixer`
  let masterVolume = 1;
  let masterMuted = false;

  /** @type {Map<string, any>} */
  const channels = new Map();

  /** @type {Set<any>} */
  const handles = new Set();

  // ----------------------------------------------------------------
  // iOS / autoplay-policy gating. Browsers reject audio.play() until
  // the user has interacted with the page; iOS additionally requires
  // each unique audio element to have its first play() inside a
  // user-gesture handler. Mixer handles this transparently:
  //
  //   - pre-unlock plays go into a queue and return a deferred
  //     handle; user can stop()/fadeOut() them and they'll be
  //     skipped at drain time
  //   - on the first pointerdown / keydown / touchstart, we drain
  //     the queue synchronously inside the gesture handler (so iOS
  //     considers each play user-initiated) and warm-play+pause
  //     every audio element we've seen so future clones from those
  //     sources work
  //
  // If no `document` is available (node tests, custom envs) we
  // start unlocked — no gating to enforce.
  // ----------------------------------------------------------------
  let unlocked = !doc;
  /** @type {{audio: any, opts: PlayOptions, deferred: any}[]} */
  const queue = [];
  /** @type {Set<any>} unique audio sources seen (to warm at unlock) */
  const seen = new Set();

  function tryUnlock() {
    if (unlocked) return;
    unlocked = true;
    // drain pending plays inside this gesture handler — keeps each
    // play() call user-initiated from iOS's perspective
    const pending = queue.splice(0);
    for (const item of pending) {
      if (item.deferred._cancelled) continue;
      const real = _doPlay(item.audio, item.opts);
      if (real) item.deferred._real = real;
    }
    // warm every source audio: a synchronous play+pause inside the
    // gesture marks each element as user-unlocked so future clones
    // play normally
    for (const audio of seen) {
      const pr = audio.play();
      if (pr && typeof pr.then === 'function') {
        pr.then(() => audio.pause()).catch(() => {});
      } else {
        audio.pause();
      }
    }
  }

  if (doc && typeof doc.addEventListener === 'function') {
    // capture-phase + once for low overhead. each event type only
    // fires its first occurrence; tryUnlock no-ops once unlocked.
    ['pointerdown', 'keydown', 'touchstart'].forEach(ev => {
      doc.addEventListener(ev, tryUnlock, {
        capture: true,
        once: true
      });
    });
  }

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
   * name doesn't resolve. Pre-unlock plays return a deferred
   * handle and queue until the first user gesture; post-unlock
   * plays return a real handle immediately.
   * @param {string | HTMLAudioElement} audioOrName
   * @param {PlayOptions} [opts]
   */
  function play(audioOrName, opts = {}) {
    const audio =
      typeof audioOrName === 'string'
        ? resolve?.(audioOrName)
        : audioOrName;
    if (!audio) return null;
    seen.add(audio);

    if (!unlocked) {
      // create a deferred handle that proxies stop / fadeOut to a
      // real handle once the queue drains. cancelling pre-drain
      // also flips _cancelled so tryUnlock skips this entry.
      const deferred = {
        _cancelled: false,
        _real: null,
        get done() {
          return this._cancelled || (this._real?.done ?? false);
        },
        stop() {
          this._cancelled = true;
          this._real?.stop();
        },
        fadeOut(seconds) {
          this._cancelled = true;
          this._real?.fadeOut(seconds);
        }
      };
      queue.push({ audio, opts, deferred });
      return deferred;
    }
    return _doPlay(audio, opts);
  }

  function _doPlay(audio, opts) {
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
    },
    /** Read-only: has a user gesture unlocked playback yet? */
    get unlocked() {
      return unlocked;
    },
    /**
     * Force the unlock dance to run now. Useful for tests, or for
     * games that have already-passed-through-a-gesture state when
     * the Mixer is constructed (e.g. coming from a "press start"
     * splash screen). Equivalent to a synthetic gesture event.
     */
    unlock: tryUnlock
  };

  return mixer;
}
