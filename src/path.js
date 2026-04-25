/**
 * A* pathfinding on a 2D tile grid.
 *
 *   findPath({
 *     start: { col, row },
 *     goal:  { col, row },
 *     width, height,             // grid extents
 *     cost: (col, row) => Number, // Infinity = impassable
 *     diagonal: false,           // 4- vs 8-way connectivity
 *     heuristic: 'manhattan'     // | 'euclidean' | 'chebyshev' | fn
 *   })
 *
 * Returns an array of `{col, row}` from start to goal (inclusive of
 * both), or `null` if no path exists. start === goal returns
 * `[start]` (a single-cell path).
 *
 * Designed to drop onto a kontra TileEngine layer:
 *
 *   const layer = tileEngine.layerMap.collision;
 *   findPath({
 *     start, goal,
 *     width: tileEngine.width,
 *     height: tileEngine.height,
 *     cost: (col, row) =>
 *       layer.data[row * tileEngine.width + col] ? Infinity : 1
 *   })
 *
 * but the cost callback isn't kontra-specific — pass any 2D-array,
 * 1D-array, or arbitrary lookup.
 */

// Manhattan: 4-way distance, admissible for 4-connected grids
// Chebyshev: max axis distance, admissible for 8-connected grids
// Euclidean: straight-line; admissible for both but slower to expand
const heuristics = {
  manhattan: (ax, ay, bx, by) =>
    Math.abs(bx - ax) + Math.abs(by - ay),
  chebyshev: (ax, ay, bx, by) =>
    Math.max(Math.abs(bx - ax), Math.abs(by - ay)),
  euclidean: (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay)
};

// neighbor offsets for the two connectivity modes; ordering doesn't
// affect correctness, only tie-break behaviour when multiple paths
// share the same f-score
const N4 = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1]
];
const N8 = [
  ...N4,
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1]
];

/**
 * Binary min-heap keyed on `f`. We don't need a full priority-queue
 * library here — A*'s open set is the only consumer, and heap
 * push/pop in JS is small enough to inline.
 */
function heap() {
  const items = [];
  return {
    items,
    size() {
      return items.length;
    },
    push(item) {
      items.push(item);
      // sift up
      let i = items.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (items[p].f <= items[i].f) break;
        [items[p], items[i]] = [items[i], items[p]];
        i = p;
      }
    },
    pop() {
      if (!items.length) return null;
      const top = items[0];
      const last = items.pop();
      if (items.length) {
        items[0] = last;
        // sift down
        let i = 0;
        const n = items.length;
        for (;;) {
          const l = 2 * i + 1;
          const r = 2 * i + 2;
          let s = i;
          if (l < n && items[l].f < items[s].f) s = l;
          if (r < n && items[r].f < items[s].f) s = r;
          if (s === i) break;
          [items[s], items[i]] = [items[i], items[s]];
          i = s;
        }
      }
      return top;
    }
  };
}

function reconstruct(node) {
  const path = [];
  let cur = node;
  while (cur) {
    path.unshift({ col: cur.col, row: cur.row });
    cur = cur.parent;
  }
  return path;
}

/**
 * @param {Object} opts
 * @param {{col: number, row: number}} opts.start
 * @param {{col: number, row: number}} opts.goal
 * @param {number} opts.width  - grid width in cells
 * @param {number} opts.height - grid height in cells
 * @param {(col: number, row: number) => number} opts.cost
 *   - returns the cost to step ONTO that cell. `Infinity` blocks.
 *   Only called for in-bounds cells.
 * @param {boolean} [opts.diagonal=false] - 8-way connectivity
 * @param {string | ((ax, ay, bx, by) => number)} [opts.heuristic]
 *   - 'manhattan' (default for 4-way) | 'chebyshev' (default for
 *   8-way) | 'euclidean' | a custom (ax, ay, bx, by) → number
 * @returns {Array<{col: number, row: number}> | null}
 */
export function findPath({
  start,
  goal,
  width,
  height,
  cost,
  diagonal = false,
  heuristic
}) {
  if (start.col === goal.col && start.row === goal.row) {
    return [{ col: start.col, row: start.row }];
  }

  const h =
    typeof heuristic === 'function'
      ? heuristic
      : heuristics[heuristic] ||
        (diagonal ? heuristics.chebyshev : heuristics.manhattan);

  const neighbors = diagonal ? N8 : N4;
  const cellId = (col, row) => row * width + col;
  const goalId = cellId(goal.col, goal.row);

  const open = heap();
  // gScore: best cost found so far to reach a cell. used to prune
  // duplicate heap entries — we never re-expand a cell that another
  // route reached cheaper.
  const gScore = new Map();
  const closed = new Set();

  const startId = cellId(start.col, start.row);
  gScore.set(startId, 0);
  open.push({
    col: start.col,
    row: start.row,
    id: startId,
    g: 0,
    f: h(start.col, start.row, goal.col, goal.row),
    parent: null
  });

  while (open.size()) {
    const cur = open.pop();
    if (cur.id === goalId) return reconstruct(cur);
    if (closed.has(cur.id)) continue;
    closed.add(cur.id);

    for (const [dx, dy] of neighbors) {
      const nc = cur.col + dx;
      const nr = cur.row + dy;
      if (nc < 0 || nc >= width || nr < 0 || nr >= height) continue;
      const nid = cellId(nc, nr);
      if (closed.has(nid)) continue;

      const c = cost(nc, nr);
      if (!isFinite(c)) continue;

      // diagonal moves traverse √2 cell-widths
      const stepMul = dx && dy ? Math.SQRT2 : 1;
      const tentativeG = cur.g + c * stepMul;

      const prev = gScore.get(nid);
      if (prev !== undefined && tentativeG >= prev) continue;
      gScore.set(nid, tentativeG);

      open.push({
        col: nc,
        row: nr,
        id: nid,
        g: tentativeG,
        f: tentativeG + h(nc, nr, goal.col, goal.row),
        parent: cur
      });
    }
  }

  return null;
}
