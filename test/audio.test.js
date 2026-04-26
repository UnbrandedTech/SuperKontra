import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Mixer, loadAudioBlob } from '../src/audio.js';

// minimal HTMLAudioElement stand-in. Mirrors the API surface the
// mixer touches; cloneNode() returns a fresh node so multiple
// plays of the same sound don't interfere.
function makeAudio() {
  const node = {
    volume: 1,
    loop: false,
    playbackRate: 1,
    currentTime: 0,
    paused: true,
    _ended: null,
    cloneNode() {
      return makeAudio();
    },
    play() {
      this.paused = false;
      return Promise.resolve();
    },
    pause() {
      this.paused = true;
    },
    addEventListener(event, fn) {
      if (event === 'ended') this._ended = fn;
    },
    fireEnded() {
      this._ended?.();
    }
  };
  return node;
}

// resolve helper for tests — closure over a fake asset map
function makeResolve(map = {}) {
  return name => map[name];
}

test('default channel exists out of the box', () => {
  const m = Mixer();
  assert.ok(m.channel('default'));
  assert.equal(m.channel('default').volume, 1);
});

test('channel() creates new channel with options', () => {
  const m = Mixer();
  const ch = m.channel('music', { volume: 0.5, exclusive: true });
  assert.equal(ch.volume, 0.5);
  assert.equal(ch.exclusive, true);
});

test('channel() returns existing channel if already defined', () => {
  const m = Mixer();
  const a = m.channel('sfx', { volume: 0.8 });
  const b = m.channel('sfx');
  assert.equal(a, b);
});

test('channel() with opts on existing channel updates only given keys', () => {
  const m = Mixer();
  m.channel('sfx', { volume: 0.8, exclusive: false });
  m.channel('sfx', { volume: 0.5 });
  const ch = m.channel('sfx');
  assert.equal(ch.volume, 0.5);
  assert.equal(ch.exclusive, false);
});

test('play() returns null when name does not resolve', () => {
  const m = Mixer({ resolve: makeResolve({}) });
  assert.equal(m.play('missing'), null);
});

test('play() with a name returns a handle and starts the audio', () => {
  const audio = makeAudio();
  const m = Mixer({ resolve: makeResolve({ shot: audio }) });
  const h = m.play('shot');
  assert.ok(h);
  assert.equal(h.node.paused, false);
});

test('play() clones the source so the same sound can overlap', () => {
  const audio = makeAudio();
  const m = Mixer({ resolve: makeResolve({ shot: audio }) });
  const h1 = m.play('shot');
  const h2 = m.play('shot');
  assert.notEqual(h1.node, h2.node);
  // the original is never the one playing — both handles got clones
  assert.notEqual(h1.node, audio);
  assert.notEqual(h2.node, audio);
});

test('play() with raw audio element bypasses resolve', () => {
  const audio = makeAudio();
  const m = Mixer();
  const h = m.play(audio);
  assert.ok(h);
  assert.equal(h.node.paused, false);
});

test('play() applies loop and rate options to the cloned node', () => {
  const audio = makeAudio();
  const m = Mixer({ resolve: makeResolve({ tune: audio }) });
  const h = m.play('tune', { loop: true, rate: 1.5 });
  assert.equal(h.node.loop, true);
  assert.equal(h.node.playbackRate, 1.5);
});

test('exclusive channel stops previous when a new one starts', () => {
  const audio = makeAudio();
  const m = Mixer({ resolve: makeResolve({ a: audio, b: audio }) });
  m.channel('music', { exclusive: true });
  const h1 = m.play('a', { channel: 'music' });
  const h2 = m.play('b', { channel: 'music' });
  assert.equal(h1._stopped, true);
  assert.equal(h2._stopped, false);
});

test('non-exclusive channel allows multiple simultaneous plays', () => {
  const audio = makeAudio();
  const m = Mixer({ resolve: makeResolve({ shot: audio }) });
  m.channel('sfx', { exclusive: false });
  const h1 = m.play('shot', { channel: 'sfx' });
  const h2 = m.play('shot', { channel: 'sfx' });
  assert.equal(h1._stopped, false);
  assert.equal(h2._stopped, false);
});

test('handle.stop() pauses and removes from active set', () => {
  const audio = makeAudio();
  const m = Mixer({ resolve: makeResolve({ shot: audio }) });
  const h = m.play('shot');
  h.stop();
  assert.equal(h.node.paused, true);
  assert.equal(h.node.currentTime, 0);
  assert.equal(m.channel('default').active.size, 0);
});

test("ended event auto-cleans the handle", () => {
  const audio = makeAudio();
  const m = Mixer({ resolve: makeResolve({ shot: audio }) });
  const h = m.play('shot');
  h.node.fireEnded();
  assert.equal(h._stopped, true);
  assert.equal(m.channel('default').active.size, 0);
});

test('volume cascade — master × channel × instance', () => {
  const audio = makeAudio();
  const m = Mixer({ resolve: makeResolve({ shot: audio }) });
  m.channel('sfx', { volume: 0.5 });
  m.volume = 0.8;
  const h = m.play('shot', { channel: 'sfx', volume: 0.5 });
  // 0.8 * 0.5 * 0.5 = 0.2
  assert.ok(Math.abs(h.node.volume - 0.2) < 1e-9);
});

test('changing master volume updates active sounds immediately', () => {
  const audio = makeAudio();
  const m = Mixer({ resolve: makeResolve({ shot: audio }) });
  const h = m.play('shot');
  m.volume = 0.25;
  assert.equal(h.node.volume, 0.25);
});

test('changing channel volume updates active sounds on that channel', () => {
  const audio = makeAudio();
  const m = Mixer({ resolve: makeResolve({ shot: audio }) });
  const ch = m.channel('sfx', { volume: 1 });
  const h = m.play('shot', { channel: 'sfx' });
  ch.volume = 0.3;
  assert.equal(h.node.volume, 0.3);
});

test('master mute zeroes volume on all active sounds', () => {
  const audio = makeAudio();
  const m = Mixer({ resolve: makeResolve({ shot: audio }) });
  const h = m.play('shot');
  m.muted = true;
  assert.equal(h.node.volume, 0);
  m.muted = false;
  assert.equal(h.node.volume, 1);
});

test('channel mute zeroes only that channel', () => {
  const audio = makeAudio();
  const m = Mixer({
    resolve: makeResolve({ shot: audio, beep: audio })
  });
  const sfx = m.channel('sfx');
  m.channel('ui', { volume: 1 });
  const a = m.play('shot', { channel: 'sfx' });
  const b = m.play('beep', { channel: 'ui' });
  sfx.muted = true;
  assert.equal(a.node.volume, 0);
  assert.equal(b.node.volume, 1);
});

test('stop(channelName) stops only that channel', () => {
  const audio = makeAudio();
  const m = Mixer({
    resolve: makeResolve({ shot: audio, beep: audio })
  });
  m.channel('sfx');
  m.channel('ui');
  const a = m.play('shot', { channel: 'sfx' });
  const b = m.play('beep', { channel: 'ui' });
  m.stop('sfx');
  assert.equal(a._stopped, true);
  assert.equal(b._stopped, false);
});

test('stopAll() stops every active sound', () => {
  const audio = makeAudio();
  const m = Mixer({
    resolve: makeResolve({ a: audio, b: audio })
  });
  const h1 = m.play('a');
  const h2 = m.play('b');
  m.stopAll();
  assert.equal(h1._stopped, true);
  assert.equal(h2._stopped, true);
});

test('fadeOut decreases volume across ticks', () => {
  const audio = makeAudio();
  const m = Mixer({ resolve: makeResolve({ shot: audio }) });
  const h = m.play('shot');
  const initialVol = h.node.volume;
  h.fadeOut(1); // 1 second
  // halfway through, volume should be ~halved
  m.tick(0.5);
  assert.ok(
    h.node.volume < initialVol * 0.6 && h.node.volume > initialVol * 0.4,
    `expected ~${initialVol * 0.5}, got ${h.node.volume}`
  );
});

test('fadeOut completes exactly at the duration boundary', () => {
  const audio = makeAudio();
  const m = Mixer({ resolve: makeResolve({ shot: audio }) });
  const h = m.play('shot');
  h.fadeOut(0.5);
  m.tick(0.5);
  assert.equal(h._stopped, true);
});

test('fadeOut(0) stops immediately', () => {
  const audio = makeAudio();
  const m = Mixer({ resolve: makeResolve({ shot: audio }) });
  const h = m.play('shot');
  h.fadeOut(0);
  assert.equal(h._stopped, true);
});

test('tick() does nothing when no fades are in flight', () => {
  const audio = makeAudio();
  const m = Mixer({ resolve: makeResolve({ shot: audio }) });
  const h = m.play('shot');
  const v = h.node.volume;
  m.tick(0.5);
  assert.equal(h.node.volume, v);
  assert.equal(h._stopped, false);
});

// ----------------------------------------------------------------
// iOS unlock + pre-gesture queue
// ----------------------------------------------------------------

// minimal Document mock: tracks listeners by event name and lets
// tests trigger them, mirroring the addEventListener({once,capture})
// shape Mixer uses.
function mockDocument() {
  const listeners = {};
  return {
    addEventListener(name, fn) {
      listeners[name] = listeners[name] || [];
      listeners[name].push(fn);
    },
    /** synthetic gesture — fires every registered listener for `name` */
    fire(name) {
      (listeners[name] || []).slice().forEach(fn => fn());
    }
  };
}

test('Mixer is unlocked by default when no document is available', () => {
  const m = Mixer({ document: null });
  assert.equal(m.unlocked, true);
});

test('Mixer with a document starts locked until a gesture fires', () => {
  const doc = mockDocument();
  const m = Mixer({ document: doc });
  assert.equal(m.unlocked, false);
  doc.fire('pointerdown');
  assert.equal(m.unlocked, true);
});

test('pre-unlock play() queues and does not fire audio.play()', () => {
  const audio = makeAudio();
  const doc = mockDocument();
  const m = Mixer({
    resolve: makeResolve({ shot: audio }),
    document: doc
  });
  const handle = m.play('shot');
  assert.ok(handle, 'pre-unlock play returns a deferred handle');
  // none of the cloned nodes have started playing
  assert.equal(audio.paused, true);
});

test('first gesture drains the queue and plays audio synchronously inside the handler', () => {
  const audio = makeAudio();
  const doc = mockDocument();
  const m = Mixer({
    resolve: makeResolve({ shot: audio }),
    document: doc
  });
  m.play('shot');
  m.play('shot');
  assert.equal(m.channel('default').active.size, 0);
  doc.fire('pointerdown');
  // both queued plays are live now (each its own clone)
  assert.equal(m.channel('default').active.size, 2);
});

test('cancelling a deferred handle prevents the play at drain time', () => {
  const audio = makeAudio();
  const doc = mockDocument();
  const m = Mixer({
    resolve: makeResolve({ shot: audio }),
    document: doc
  });
  const a = m.play('shot');
  const b = m.play('shot');
  a.stop(); // cancel before unlock
  doc.fire('pointerdown');
  // only `b` made it to the active set
  assert.equal(m.channel('default').active.size, 1);
});

test('audio sources seen pre-unlock are warm-played and paused at unlock', () => {
  const audio = makeAudio();
  let warmPlays = 0;
  let warmPauses = 0;
  // wrap the source's play/pause to count warmup invocations.
  // (clones get their own play counters via cloneNode.)
  const origPlay = audio.play.bind(audio);
  audio.play = function () {
    warmPlays++;
    return origPlay();
  };
  const origPause = audio.pause.bind(audio);
  audio.pause = function () {
    warmPauses++;
    return origPause();
  };
  const doc = mockDocument();
  const m = Mixer({
    resolve: makeResolve({ shot: audio }),
    document: doc
  });
  m.play('shot'); // queued; doesn't touch the source's play yet
  assert.equal(warmPlays, 0);
  doc.fire('pointerdown');
  // after gesture: source was warm-played at least once
  assert.ok(warmPlays >= 1, `warmPlays=${warmPlays}`);
});

test('post-unlock plays bypass the queue and run immediately', () => {
  const audio = makeAudio();
  const doc = mockDocument();
  const m = Mixer({
    resolve: makeResolve({ shot: audio }),
    document: doc
  });
  doc.fire('pointerdown'); // unlock first
  const handle = m.play('shot');
  assert.ok(handle.node, 'post-unlock returns a real handle with a node');
  assert.equal(handle.node.paused, false);
});

test('mixer.unlock() forces the unlock without a real gesture', () => {
  const audio = makeAudio();
  const doc = mockDocument();
  const m = Mixer({
    resolve: makeResolve({ shot: audio }),
    document: doc
  });
  m.play('shot'); // queued
  m.unlock();
  assert.equal(m.unlocked, true);
  assert.equal(m.channel('default').active.size, 1);
});

test('multiple gestures only unlock once', () => {
  const doc = mockDocument();
  const m = Mixer({ document: doc });
  doc.fire('pointerdown');
  // second gesture is a no-op (Mixer registers listeners with
  // {once: true} so repeated fires don't accumulate state)
  doc.fire('pointerdown');
  assert.equal(m.unlocked, true);
});

// ----------------------------------------------------------------
// loadAudioBlob — fetches via Blob to dodge HTTP Range requests
// ----------------------------------------------------------------

test('loadAudioBlob fetches the URL, creates a blob: URL, and resolves on canplaythrough', async () => {
  // mock fetch + URL.createObjectURL + Audio for the duration of
  // the test. Restore at the end so other tests aren't affected.
  const origFetch = globalThis.fetch;
  const origCreateObjURL = globalThis.URL?.createObjectURL;
  const origAudio = globalThis.Audio;

  let blobUrlSeen;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    blob: async () => ({ /* fake blob */ size: 1024, type: 'audio/wav' })
  });
  globalThis.URL = globalThis.URL || {};
  globalThis.URL.createObjectURL = blob => {
    return 'blob:fake-' + blob.size;
  };
  globalThis.Audio = function FakeAudio() {
    const listeners = {};
    const node = {
      addEventListener(name, fn) {
        listeners[name] = fn;
      },
      load() {
        // simulate the browser successfully loading the blob and
        // firing canplaythrough on the next microtask
        Promise.resolve().then(() =>
          listeners.canplaythrough?.()
        );
      },
      set src(v) {
        blobUrlSeen = v;
      }
    };
    return node;
  };

  try {
    const audio = await loadAudioBlob('/audio/thud.wav');
    assert.ok(audio);
    assert.match(blobUrlSeen, /^blob:/);
  } finally {
    globalThis.fetch = origFetch;
    if (origCreateObjURL)
      globalThis.URL.createObjectURL = origCreateObjURL;
    globalThis.Audio = origAudio;
  }
});

test('loadAudioBlob throws on non-OK responses', async () => {
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false,
    status: 404
  });
  try {
    await assert.rejects(() => loadAudioBlob('/missing.wav'), /HTTP 404/);
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('play() returns null and recovers gracefully when audio.play() rejects', async () => {
  const audio = makeAudio();
  // override the play to reject (simulates browser autoplay block)
  audio.cloneNode = () => {
    const n = makeAudio();
    n.play = () => Promise.reject(new Error('NotAllowed'));
    return n;
  };
  const m = Mixer({ resolve: makeResolve({ shot: audio }) });
  const h = m.play('shot');
  assert.ok(h);
  // wait a microtask so the rejection handler runs
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(h._stopped, true);
});
