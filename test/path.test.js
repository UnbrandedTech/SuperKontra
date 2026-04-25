import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findPath } from '../src/path.js';

// helpers — tiny grid notation for legible fixtures.
//   '.' walkable, '#' blocked, 'S' start, 'G' goal
//
// rows are top-down, cols are left-to-right; (0,0) is top-left.
function parse(rows) {
  const lines = rows.trim().split('\n').map(l => l.trim());
  const height = lines.length;
  const width = lines[0].length;
  let start, goal;
  const blocked = new Set();
  lines.forEach((line, row) => {
    [...line].forEach((ch, col) => {
      if (ch === '#') blocked.add(row * width + col);
      else if (ch === 'S') start = { col, row };
      else if (ch === 'G') goal = { col, row };
    });
  });
  return {
    width,
    height,
    start,
    goal,
    cost: (col, row) => (blocked.has(row * width + col) ? Infinity : 1)
  };
}

const findOnGrid = (rows, opts = {}) => {
  const g = parse(rows);
  return findPath({ ...g, ...opts });
};

const lastCell = path => path[path.length - 1];

test('returns [start] when start equals goal', () => {
  const p = findPath({
    start: { col: 3, row: 4 },
    goal: { col: 3, row: 4 },
    width: 10,
    height: 10,
    cost: () => 1
  });
  assert.deepEqual(p, [{ col: 3, row: 4 }]);
});

test('finds a direct path on an open grid', () => {
  const path = findOnGrid(`
    S....
    .....
    ....G
  `);
  // includes both endpoints
  assert.deepEqual(path[0], { col: 0, row: 0 });
  assert.deepEqual(lastCell(path), { col: 4, row: 2 });
  // 4-way connectivity → Manhattan distance + 1 = 7 cells
  assert.equal(path.length, 7);
});

test('detours around a wall', () => {
  // straight-line blocked by a vertical barrier
  const path = findOnGrid(`
    S.#.G
    ..#..
    ..#..
    .....
  `);
  assert.deepEqual(path[0], { col: 0, row: 0 });
  assert.deepEqual(lastCell(path), { col: 4, row: 0 });
  // path can't go through col=2 in rows 0-2; must go around through
  // row=3. The shortest such detour is 9 cells (down 3, right 4,
  // up 3 — counting both endpoints).
  assert.ok(
    path.length >= 9,
    `detour length should be at least 9, got ${path.length}`
  );
  // sanity: no cell of the path is in a wall
  for (const { col, row } of path) {
    if (row < 3) assert.notEqual(col, 2);
  }
});

test('returns null when goal is unreachable', () => {
  // S surrounded by walls
  const path = findOnGrid(`
    .....
    .###.
    .#S#.
    .###.
    ....G
  `);
  assert.equal(path, null);
});

test('returns null when goal is fully walled off', () => {
  const path = findOnGrid(`
    S....
    .....
    .###.
    .#G#.
    .###.
  `);
  assert.equal(path, null);
});

test('all cells of the returned path are adjacent (4-way connectivity)', () => {
  const path = findOnGrid(`
    S....
    ..#..
    .....
    ....G
  `);
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const d =
      Math.abs(b.col - a.col) + Math.abs(b.row - a.row);
    assert.equal(d, 1, `step ${i} skipped (${a.col},${a.row}) → (${b.col},${b.row})`);
  }
});

test('diagonal mode finds shorter paths on open ground', () => {
  const grid = `
    S....
    .....
    .....
    .....
    ....G
  `;
  const ortho = findOnGrid(grid, { diagonal: false });
  const diag = findOnGrid(grid, { diagonal: true });
  // 4-way: 9 cells (4+4 + start). 8-way: 5 cells (diagonal).
  assert.equal(ortho.length, 9);
  assert.equal(diag.length, 5);
});

test('diagonal moves are valid neighbors in 8-way mode', () => {
  const path = findOnGrid(
    `
    S...
    ....
    ...G
  `,
    { diagonal: true }
  );
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const dx = Math.abs(b.col - a.col);
    const dy = Math.abs(b.row - a.row);
    assert.ok(dx <= 1 && dy <= 1 && (dx || dy));
  }
});

test('weighted costs steer the path through cheaper cells', () => {
  // a "wall of mud" at col 2 — passable but expensive. With cost
  // 100, the detour around the column should be cheaper than
  // walking through it.
  const cost = (col, row) => {
    if (col === 2 && row !== 4) return 100;
    return 1;
  };
  const path = findPath({
    start: { col: 0, row: 0 },
    goal: { col: 4, row: 0 },
    width: 5,
    height: 5,
    cost
  });
  // path should NOT step on (2, 0..3) — should detour through row 4
  for (const { col, row } of path) {
    if (col === 2) {
      assert.equal(row, 4, `unexpected mud step at (${col}, ${row})`);
    }
  }
});

test('custom heuristic function is accepted', () => {
  // a heuristic that always returns 0 — A* degenerates into
  // Dijkstra, still optimal but explores more
  let calls = 0;
  const path = findPath({
    start: { col: 0, row: 0 },
    goal: { col: 3, row: 0 },
    width: 4,
    height: 4,
    cost: () => 1,
    heuristic: () => {
      calls++;
      return 0;
    }
  });
  assert.equal(path.length, 4);
  assert.ok(calls > 0, 'custom heuristic should be invoked');
});

test('heuristic by string name selects the named function', () => {
  // doesn't change the path on this trivial grid; just verifies the
  // option doesn't blow up and produces an optimal-length path
  const path = findPath({
    start: { col: 0, row: 0 },
    goal: { col: 3, row: 3 },
    width: 5,
    height: 5,
    cost: () => 1,
    heuristic: 'euclidean'
  });
  assert.equal(path.length, 7);
});

test('out-of-bounds neighbors are not visited (cost callback never sees them)', () => {
  const seen = [];
  findPath({
    start: { col: 0, row: 0 },
    goal: { col: 1, row: 0 },
    width: 2,
    height: 1,
    cost: (c, r) => {
      seen.push([c, r]);
      return 1;
    }
  });
  for (const [c, r] of seen) {
    assert.ok(c >= 0 && c < 2 && r >= 0 && r < 1);
  }
});

test('integrates with a kontra-shaped 1D layer.data array', () => {
  // simulate a 5x4 kontra TileEngine layer.data — any nonzero tile
  // index is a wall, exactly how `layerCollidesWith` interprets it
  const width = 5;
  const height = 4;
  const data = [
    0, 0, 0, 1, 0,
    0, 1, 0, 1, 0,
    0, 1, 0, 0, 0,
    0, 0, 0, 0, 0
  ];
  const path = findPath({
    start: { col: 0, row: 0 },
    goal: { col: 4, row: 0 },
    width,
    height,
    cost: (col, row) =>
      data[row * width + col] ? Infinity : 1
  });
  assert.ok(path);
  assert.deepEqual(path[0], { col: 0, row: 0 });
  assert.deepEqual(lastCell(path), { col: 4, row: 0 });
  // path must avoid any wall tile
  for (const { col, row } of path) {
    assert.equal(data[row * width + col], 0);
  }
});

test('large open grid completes in reasonable time and length', () => {
  const W = 50;
  const H = 50;
  const path = findPath({
    start: { col: 0, row: 0 },
    goal: { col: W - 1, row: H - 1 },
    width: W,
    height: H,
    cost: () => 1
  });
  // optimal Manhattan distance is (W-1) + (H-1) = 98 → 99 cells
  assert.equal(path.length, 99);
});
