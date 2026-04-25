import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Save } from '../src/state.js';

// in-memory storage matching the Web Storage interface — node has
// no localStorage by default, and using a real one in tests would
// leak state across runs anyway
function makeStorage(seed = {}) {
  const data = { ...seed };
  return {
    setItem(k, v) {
      data[k] = String(v);
    },
    getItem(k) {
      return k in data ? data[k] : null;
    },
    removeItem(k) {
      delete data[k];
    },
    _data: data
  };
}

test('write then read round-trips the user state', () => {
  const storage = makeStorage();
  const save = Save({ key: 'g', version: 1, storage });
  save.write({ player: { x: 10, hp: 50 }, level: 3 });
  const out = save.read();
  assert.deepEqual(out, { player: { x: 10, hp: 50 }, level: 3 });
});

test('read() returns null when nothing is saved', () => {
  const save = Save({ key: 'g', version: 1, storage: makeStorage() });
  assert.equal(save.read(), null);
});

test('exists() reflects whether a save is present', () => {
  const storage = makeStorage();
  const save = Save({ key: 'g', version: 1, storage });
  assert.equal(save.exists(), false);
  save.write({ score: 0 });
  assert.equal(save.exists(), true);
  save.clear();
  assert.equal(save.exists(), false);
});

test('clear() removes the saved blob', () => {
  const storage = makeStorage();
  const save = Save({ key: 'g', version: 1, storage });
  save.write({ x: 1 });
  save.clear();
  assert.equal(save.read(), null);
});

test('migrations run in order to bring an old save forward', () => {
  const storage = makeStorage();
  // pretend the player saved at v1 — write the raw envelope directly
  storage.setItem(
    'g',
    JSON.stringify({ version: 1, savedAt: 0, data: { hp: 50 } })
  );
  const save = Save({
    key: 'g',
    version: 3,
    migrations: {
      1: (d) => ({ ...d, mp: 10 }),
      2: (d) => ({ ...d, level: 1 })
    },
    storage
  });
  const out = save.read();
  assert.deepEqual(out, { hp: 50, mp: 10, level: 1 });
});

test('migrations skip stages that are already current', () => {
  const storage = makeStorage();
  // save already at v2 — only migration[2] should run
  storage.setItem(
    'g',
    JSON.stringify({ version: 2, savedAt: 0, data: { hp: 50, mp: 10 } })
  );
  const seen = [];
  const save = Save({
    key: 'g',
    version: 3,
    migrations: {
      1: (d) => {
        seen.push(1);
        return d;
      },
      2: (d) => {
        seen.push(2);
        return { ...d, level: 1 };
      }
    },
    storage
  });
  save.read();
  assert.deepEqual(seen, [2]);
});

test('reading a save newer than the code throws a clear error', () => {
  const storage = makeStorage();
  storage.setItem(
    'g',
    JSON.stringify({ version: 5, savedAt: 0, data: {} })
  );
  const save = Save({ key: 'g', version: 2, storage });
  assert.throws(() => save.read(), /newer than supported/);
});

test('missing migrations throw rather than silently dropping data', () => {
  const storage = makeStorage();
  storage.setItem(
    'g',
    JSON.stringify({ version: 1, savedAt: 0, data: {} })
  );
  const save = Save({ key: 'g', version: 3, storage });
  assert.throws(() => save.read(), /Missing migration/);
});

test('corrupt JSON returns null instead of crashing', () => {
  const storage = makeStorage();
  storage.setItem('g', 'not json {{{');
  const save = Save({ key: 'g', version: 1, storage });
  assert.equal(save.read(), null);
});

test('non-object blobs return null', () => {
  const storage = makeStorage();
  storage.setItem('g', JSON.stringify('just a string'));
  const save = Save({ key: 'g', version: 1, storage });
  assert.equal(save.read(), null);
});

test('dump() returns the raw blob string and null when empty', () => {
  const storage = makeStorage();
  const save = Save({ key: 'g', version: 1, storage });
  assert.equal(save.dump(), null);
  save.write({ x: 1 });
  const blob = save.dump();
  assert.ok(typeof blob === 'string');
  const parsed = JSON.parse(blob);
  assert.equal(parsed.version, 1);
  assert.deepEqual(parsed.data, { x: 1 });
});

test('restore() round-trips with dump() across two Save instances', () => {
  const a = makeStorage();
  const b = makeStorage();
  const sa = Save({ key: 'g', version: 1, storage: a });
  sa.write({ score: 99 });
  const blob = sa.dump();

  const sb = Save({ key: 'g', version: 1, storage: b });
  sb.restore(blob);
  assert.deepEqual(sb.read(), { score: 99 });
});

test('restore() applies migrations on the next read, not at import', () => {
  const storage = makeStorage();
  const save = Save({
    key: 'g',
    version: 2,
    migrations: { 1: (d) => ({ ...d, mp: 10 }) },
    storage
  });
  // build an old-version blob outside the lib
  const oldBlob = JSON.stringify({
    version: 1,
    savedAt: 0,
    data: { hp: 50 }
  });
  save.restore(oldBlob);
  // raw stored blob is unchanged...
  assert.equal(JSON.parse(storage.getItem('g')).version, 1);
  // ...but read() migrates on-demand
  assert.deepEqual(save.read(), { hp: 50, mp: 10 });
});

test('restore() rejects invalid JSON', () => {
  const save = Save({ key: 'g', version: 1, storage: makeStorage() });
  assert.throws(() => save.restore('not json'), /not valid JSON/);
});

test('restore() rejects malformed envelope (missing version)', () => {
  const save = Save({ key: 'g', version: 1, storage: makeStorage() });
  assert.throws(
    () => save.restore(JSON.stringify({ data: {} })),
    /missing version or data/
  );
});

test('restore() rejects a save that needs missing migrations', () => {
  const save = Save({ key: 'g', version: 3, storage: makeStorage() });
  const oldBlob = JSON.stringify({
    version: 1,
    savedAt: 0,
    data: {}
  });
  // no migrations configured — restore should fail before writing
  assert.throws(() => save.restore(oldBlob), /Missing migration/);
});

test('restore() rejects a save newer than the code without writing', () => {
  const storage = makeStorage();
  const save = Save({ key: 'g', version: 1, storage });
  const futureBlob = JSON.stringify({
    version: 5,
    savedAt: 0,
    data: {}
  });
  assert.throws(() => save.restore(futureBlob), /newer than supported/);
  assert.equal(storage.getItem('g'), null);
});

test('different keys are independent', () => {
  const storage = makeStorage();
  const slot1 = Save({ key: 'g:slot1', version: 1, storage });
  const slot2 = Save({ key: 'g:slot2', version: 1, storage });
  slot1.write({ name: 'first' });
  slot2.write({ name: 'second' });
  assert.deepEqual(slot1.read(), { name: 'first' });
  assert.deepEqual(slot2.read(), { name: 'second' });
});

test('Save() throws if required options are missing', () => {
  assert.throws(
    () => Save({ version: 1, storage: makeStorage() }),
    /requires a `key`/
  );
  assert.throws(
    () => Save({ key: 'g', storage: makeStorage() }),
    /numeric `version`/
  );
});

test('Save() throws if no storage backend is available', () => {
  // node has no globalThis.localStorage; passing storage:undefined
  // explicitly should fail with a clear message
  assert.throws(
    () => Save({ key: 'g', version: 1, storage: undefined }),
    /storage backend/
  );
});
