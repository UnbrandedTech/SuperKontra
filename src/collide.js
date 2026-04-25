/**
 * Collision detection for kontra-style game objects. A drop-in
 * superset of kontra's `collides()` that adds polygon and circle
 * support via the Separating Axis Theorem (SAT).
 *
 * Shape detection per input:
 *   - `radius` set            → circle
 *   - `vertices` set          → convex polygon (vertices in object-local coords)
 *   - otherwise               → axis-aligned rectangle from `width` / `height`
 *
 * All inputs respect kontra conventions: `anchor` (default {0,0}),
 * `rotation`, and `obj.world` if present (so nested game objects work).
 */

const EPS = 1e-9;

function toShape(obj) {
  // prefer the world-transformed view if the object exposes one
  // (kontra game objects do via the `world` getter on GameObject)
  const src = obj.world || obj;
  let x = src.x ?? obj.x ?? 0;
  let y = src.y ?? obj.y ?? 0;
  let width = src.width ?? obj.width ?? 0;
  let height = src.height ?? obj.height ?? 0;
  const radius = src.radius ?? obj.radius;
  const anchor = src.anchor ?? obj.anchor ?? { x: 0, y: 0 };
  const rotation = src.rotation ?? obj.rotation ?? 0;

  // a `radius` always wins — a kontra Sprite with radius treats
  // width/height as `radius * 2` regardless of what was passed in
  if (radius != null) {
    width = radius * 2;
    height = radius * 2;
  }

  // (x, y) is the anchor point on the object's bounding box; shift
  // so cx/cy is the visual centre regardless of anchor choice
  const cx = x + width * (0.5 - anchor.x);
  const cy = y + height * (0.5 - anchor.y);

  if (radius != null) {
    return { circle: true, cx, cy, radius };
  }

  // axis-aligned rect — fast path with a precomputed bbox so
  // AABB/AABB collisions can use the overlap-rect centre as their
  // contact point (not just averaged corners, which mis-locate
  // the contact when one shape's edge is much longer than the
  // other's, e.g. a player on a wide floor)
  if (!obj.vertices && !rotation) {
    const halfW = width / 2;
    const halfH = height / 2;
    return {
      aabb: true,
      cx,
      cy,
      minX: cx - halfW,
      maxX: cx + halfW,
      minY: cy - halfH,
      maxY: cy + halfH,
      // also expose vertices for the SAT fallback when colliding
      // against a non-AABB polygon
      vertices: [
        [cx - halfW, cy - halfH],
        [cx + halfW, cy - halfH],
        [cx + halfW, cy + halfH],
        [cx - halfW, cy + halfH]
      ]
    };
  }

  // arbitrary polygon (custom vertices, or a rotated rect)
  const local = obj.vertices || [
    [-width / 2, -height / 2],
    [width / 2, -height / 2],
    [width / 2, height / 2],
    [-width / 2, height / 2]
  ];
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  return {
    vertices: local.map(([vx, vy]) => [
      cx + vx * cos - vy * sin,
      cy + vx * sin + vy * cos
    ]),
    cx,
    cy
  };
}

function project(vertices, ax, ay) {
  let min = Infinity;
  let max = -Infinity;
  for (const [vx, vy] of vertices) {
    const dot = vx * ax + vy * ay;
    if (dot < min) min = dot;
    if (dot > max) max = dot;
  }
  return [min, max];
}

function projectCircle(circle, ax, ay) {
  const center = circle.cx * ax + circle.cy * ay;
  return [center - circle.radius, center + circle.radius];
}

function getEdgeAxes(vertices) {
  const axes = [];
  for (let i = 0; i < vertices.length; i++) {
    const [x1, y1] = vertices[i];
    const [x2, y2] = vertices[(i + 1) % vertices.length];
    const ex = x2 - x1;
    const ey = y2 - y1;
    const len = Math.hypot(ex, ey);
    if (len < EPS) continue;
    // perpendicular to the edge, normalized
    axes.push([-ey / len, ex / len]);
  }
  return axes;
}

/**
 * Run SAT on a set of candidate axes. `projA` and `projB` should
 * each return [min, max] for an axis. `cax/cay`, `cbx/cby` are the
 * shape centres so we can flip the final axis to point A → B.
 */
function sat(axes, projA, projB, cax, cay, cbx, cby) {
  let bestOverlap = Infinity;
  let bestAx = 0;
  let bestAy = 0;
  for (const [ax, ay] of axes) {
    const [aMin, aMax] = projA(ax, ay);
    const [bMin, bMax] = projB(ax, ay);
    const overlap = Math.min(aMax, bMax) - Math.max(aMin, bMin);
    if (overlap <= 0) return null;
    if (overlap < bestOverlap) {
      bestOverlap = overlap;
      bestAx = ax;
      bestAy = ay;
    }
  }
  // ensure axis points from A's centre toward B's
  if ((cbx - cax) * bestAx + (cby - cay) * bestAy < 0) {
    bestAx = -bestAx;
    bestAy = -bestAy;
  }
  return { overlap: bestOverlap, axis: { x: bestAx, y: bestAy } };
}

// Find the vertices farthest along an axis — the "support feature."
// When two polygons collide edge-on-edge (a head-on AABB collision,
// say), two vertices tie for support; averaging them gives the
// edge midpoint instead of a corner, which is what we want for
// torque-free head-on collisions to actually produce zero torque.
// For a single-vertex contact (corner penetration) the loop just
// returns that one vertex.
function supportVertex(vertices, ax, ay) {
  let best = -Infinity;
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (const [vx, vy] of vertices) {
    const d = vx * ax + vy * ay;
    if (d > best + EPS) {
      best = d;
      sx = vx;
      sy = vy;
      n = 1;
    } else if (Math.abs(d - best) < EPS) {
      sx += vx;
      sy += vy;
      n++;
    }
  }
  return [sx / n, sy / n];
}

function polyPoly(a, b) {
  const axes = [...getEdgeAxes(a.vertices), ...getEdgeAxes(b.vertices)];
  const r = sat(
    axes,
    (ax, ay) => project(a.vertices, ax, ay),
    (ax, ay) => project(b.vertices, ax, ay),
    a.cx,
    a.cy,
    b.cx,
    b.cy
  );
  if (!r) return null;
  const [pax, pay] = supportVertex(a.vertices, r.axis.x, r.axis.y);
  const [pbx, pby] = supportVertex(b.vertices, -r.axis.x, -r.axis.y);
  r.point = [(pax + pbx) / 2, (pay + pby) / 2];
  return r;
}

function polyCircle(poly, circle) {
  const axes = getEdgeAxes(poly.vertices);
  // SAT for poly-vs-circle needs one extra axis: from the closest
  // polygon vertex toward the circle's centre. without it, two
  // shapes can overlap on a corner without any edge axis showing it
  let bestD2 = Infinity;
  let cvx = 0;
  let cvy = 0;
  for (const [vx, vy] of poly.vertices) {
    const dx = vx - circle.cx;
    const dy = vy - circle.cy;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD2) {
      bestD2 = d2;
      cvx = vx;
      cvy = vy;
    }
  }
  const dx = cvx - circle.cx;
  const dy = cvy - circle.cy;
  const len = Math.hypot(dx, dy);
  if (len > EPS) {
    axes.push([dx / len, dy / len]);
  }
  const r = sat(
    axes,
    (ax, ay) => project(poly.vertices, ax, ay),
    (ax, ay) => projectCircle(circle, ax, ay),
    poly.cx,
    poly.cy,
    circle.cx,
    circle.cy
  );
  if (!r) return null;
  // contact lies on the circle's surface in the direction of the
  // polygon (i.e. opposite the A→B axis)
  r.point = [
    circle.cx - r.axis.x * circle.radius,
    circle.cy - r.axis.y * circle.radius
  ];
  return r;
}

function circleCircle(a, b) {
  const dx = b.cx - a.cx;
  const dy = b.cy - a.cy;
  const dist = Math.hypot(dx, dy);
  const sum = a.radius + b.radius;
  if (dist >= sum) return null;
  if (dist < EPS) {
    // exactly co-located — pick an arbitrary axis so callers can
    // separate without dividing by zero. point is just A's centre.
    return {
      overlap: sum,
      axis: { x: 1, y: 0 },
      point: [a.cx, a.cy]
    };
  }
  const nx = dx / dist;
  const ny = dy / dist;
  return {
    overlap: sum - dist,
    axis: { x: nx, y: ny },
    // contact sits on A's surface along the line to B
    point: [a.cx + nx * a.radius, a.cy + ny * a.radius]
  };
}

// AABB/AABB fast path. Picks the smaller-overlap axis as the MTV
// (matches SAT's behaviour) and uses the overlap rectangle's centre
// as the contact point — the correct location for an edge-on-edge
// collision where neither shape's edge is the bottleneck.
function aabbAabb(a, b) {
  const minX = Math.max(a.minX, b.minX);
  const maxX = Math.min(a.maxX, b.maxX);
  const minY = Math.max(a.minY, b.minY);
  const maxY = Math.min(a.maxY, b.maxY);
  if (minX >= maxX || minY >= maxY) return null;
  const ox = maxX - minX;
  const oy = maxY - minY;
  let axis;
  let overlap;
  if (ox < oy) {
    overlap = ox;
    axis = { x: a.cx < b.cx ? 1 : -1, y: 0 };
  } else {
    overlap = oy;
    axis = { x: 0, y: a.cy < b.cy ? 1 : -1 };
  }
  return {
    overlap,
    axis,
    point: [(minX + maxX) / 2, (minY + maxY) / 2]
  };
}

function flipResponse(r) {
  if (!r) return null;
  // axis flips because A and B have swapped roles, but the
  // contact point is in world space and stays put
  return {
    overlap: r.overlap,
    axis: { x: -r.axis.x, y: -r.axis.y },
    point: r.point
  };
}

/**
 * Detect collision between two kontra-style game objects.
 *
 * @param {Object} a
 * @param {Object} b
 * @returns {boolean}
 */
export function collides(a, b) {
  return collidesWithResponse(a, b) !== null;
}

/**
 * Detect collision and return the minimum-translation vector for
 * separation, or null if the shapes don't overlap. The returned
 * `axis` is a unit vector pointing from `a` toward `b`; multiply
 * by `overlap` and apply to either body to push them apart.
 *
 * @param {Object} a
 * @param {Object} b
 * @returns {{overlap: number, axis: {x: number, y: number}} | null}
 */
export function collidesWithResponse(a, b) {
  const sa = toShape(a);
  const sb = toShape(b);

  if (sa.circle && sb.circle) return circleCircle(sa, sb);
  if (sa.circle) return flipResponse(polyCircle(sb, sa));
  if (sb.circle) return polyCircle(sa, sb);
  // both axis-aligned rects → fast path with proper contact point
  if (sa.aabb && sb.aabb) return aabbAabb(sa, sb);
  return polyPoly(sa, sb);
}
