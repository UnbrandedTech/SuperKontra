/**
 * Versioned save/load over a key-value storage backend (defaults to
 * localStorage). Wraps user state in a small envelope:
 *
 *   { version: number, savedAt: number, data: <user state> }
 *
 * On read, if the stored `version` is less than the constructor's
 * `version`, the configured `migrations` run in order to bring the
 * data forward. Reading is therefore safe across game updates: ship
 * a new version, write a migration that adds/renames/removes the
 * fields you changed, old saves load.
 *
 * Saving and loading is synchronous because localStorage is — call
 * at safe points (level complete, autosave tick, quit), not every
 * frame.
 *
 * Storage backend is swappable: pass `{ storage: sessionStorage }`
 * or any object with `getItem`/`setItem`/`removeItem` for tests
 * or for memory-only saves.
 */

/**
 * @typedef {Object} SaveOptions
 * @property {string} key - localStorage key. Use a unique prefix per
 *   game; for save slots, append a slot id (`'mygame:slot1'`).
 * @property {number} version - Current schema version. Bump whenever
 *   you change the shape of saved state in a way that breaks loads.
 * @property {{[fromVersion: number]: (data: any) => any}} [migrations]
 *   - Map of source-version → transform. Transforms run in sequence:
 *   `migrations[N]` takes data at version N and returns it at N+1.
 * @property {Storage} [storage] - Defaults to `globalThis.localStorage`.
 */

/**
 * @param {SaveOptions} options
 */
export function Save({
  key,
  version,
  migrations = {},
  storage = globalThis.localStorage
}) {
  if (!key) throw Error('Save requires a `key`');
  if (typeof version != 'number') {
    throw Error('Save requires a numeric `version`');
  }
  if (!storage) {
    throw Error(
      'Save needs a storage backend (no localStorage in this environment — pass `storage` explicitly)'
    );
  }

  function envelope(data) {
    return JSON.stringify({
      version,
      savedAt: Date.now(),
      data
    });
  }

  // bring an envelope from its stored version up to the current one
  function migrate(blob) {
    let v = blob.version;
    let data = blob.data;
    if (v > version) {
      throw Error(
        `Save at version ${v} is newer than supported (${version})`
      );
    }
    while (v < version) {
      const fn = migrations[v];
      if (!fn) {
        throw Error(`Missing migration from save version ${v}`);
      }
      data = fn(data);
      v++;
    }
    return data;
  }

  function write(state) {
    storage.setItem(key, envelope(state));
  }

  function read() {
    const raw = storage.getItem(key);
    if (!raw) return null;
    let blob;
    try {
      blob = JSON.parse(raw);
    } catch {
      // corrupt save — treat as missing rather than crash the
      // game; caller can detect via `exists()` if they care
      return null;
    }
    if (typeof blob !== 'object' || blob === null) return null;
    return migrate(blob);
  }

  function exists() {
    return storage.getItem(key) != null;
  }

  function clear() {
    storage.removeItem(key);
  }

  // current saved blob as a string (or null) — for clipboard,
  // file download, or shipping over the wire
  function dump() {
    return storage.getItem(key);
  }

  // import an externally-produced blob string. validates by parsing
  // and dry-running migration; only writes to storage if valid.
  function restore(str) {
    let blob;
    try {
      blob = JSON.parse(str);
    } catch {
      throw Error('save data is not valid JSON');
    }
    if (
      typeof blob !== 'object' ||
      blob === null ||
      typeof blob.version != 'number' ||
      !('data' in blob)
    ) {
      throw Error('save data is missing version or data field');
    }
    // dry-run migration to surface errors before committing
    migrate(blob);
    storage.setItem(key, str);
  }

  return { write, read, exists, clear, dump, restore };
}
