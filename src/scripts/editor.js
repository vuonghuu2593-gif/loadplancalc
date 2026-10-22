// Hand editing of a load plan. Pure JS, no DOM (runs on the page, in the worker and in Node tests).
// Units mm / kg; x = length from the back wall, y = across, z = up. Boxes: { k, x, y, z, dx, dy, dz }
// where k is the box type's position in the input list. Every hand change is checked with the same
// rules as an automatic plan (inside, no overlap, allowed position, door, full support, non-stackable).
import { normalize, pack, allowedPerms, summarize, validate, centreOn } from './packer.js';

const EPS = 0.01;

// Uniform grid over the load space so "what is near this box" stays fast with thousands of boxes.
class Grid {
  constructor(cell) { this.c = cell; this.m = new Map(); }
  keys(x, y, z, dx, dy, dz) {
    const c = this.c, out = [];
    const x0 = Math.floor((x + EPS) / c), x1 = Math.floor((x + dx - EPS) / c);
    const y0 = Math.floor((y + EPS) / c), y1 = Math.floor((y + dy - EPS) / c);
    const z0 = Math.floor((z + EPS) / c), z1 = Math.floor((z + dz - EPS) / c);
    for (let i = x0; i <= x1; i++) for (let j = y0; j <= y1; j++) for (let m = z0; m <= z1; m++) out.push(i * 1e6 + j * 1e3 + m);
    return out;
  }
  add(i, b) { for (const k of this.keys(b.x, b.y, b.z, b.dx, b.dy, b.dz)) { const a = this.m.get(k); if (a) a.push(i); else this.m.set(k, [i]); } }
  near(x, y, z, dx, dy, dz) {
    const s = new Set();
    for (const k of this.keys(x, y, z, dx, dy, dz)) { const a = this.m.get(k); if (a) for (const i of a) s.add(i); }
    return s;
  }
}

// Editing context: normalised container and box types plus the boxes now in the plan.
export function makeCtx(container, rawItems, boxes) {
  const { cont, items } = normalize(container, rawItems);
  const dims = items.filter((it) => it.l > 0).flatMap((it) => [it.l, it.w, it.h]);
  const cell = Math.min(600, Math.max(100, dims.length ? Math.min(...dims) : 300));
  const ctx = { cont, items, boxes: boxes.map((b) => ({ k: b.k, x: +b.x, y: +b.y, z: +b.z, dx: +b.dx, dy: +b.dy, dz: +b.dz })), grid: new Grid(cell) };
  ctx.boxes.forEach((b, i) => ctx.grid.add(i, b));
  return ctx;
}
function addBox(ctx, b) { ctx.boxes.push(b); ctx.grid.add(ctx.boxes.length - 1, b); }

const overlap = (a, b) => a.x < b.x + b.dx - EPS && b.x < a.x + a.dx - EPS && a.y < b.y + b.dy - EPS && b.y < a.y + a.dy - EPS && a.z < b.z + b.dz - EPS && b.z < a.z + a.dz - EPS;

function hits(ctx, b, ignore) {
  for (const i of ctx.grid.near(b.x, b.y, b.z, b.dx, b.dy, b.dz)) if (!ignore?.has(i) && overlap(ctx.boxes[i], b)) return i;
  return -1;
}

// '' when the box stands fully on the floor or on stackable boxes, otherwise the reason.
function support(ctx, b, ignore) {
  if (b.z < EPS) return '';
  let area = 0; const below = [];
  for (const i of ctx.grid.near(b.x, b.y, b.z - 1, b.dx, b.dy, 1)) {
    if (ignore?.has(i)) continue;
    const o = ctx.boxes[i];
    if (Math.abs(o.z + o.dz - b.z) > EPS) continue;
    const ox = Math.min(b.x + b.dx, o.x + o.dx) - Math.max(b.x, o.x), oy = Math.min(b.y + b.dy, o.y + o.dy) - Math.max(b.y, o.y);
    if (ox > EPS && oy > EPS) { if (!ctx.items[o.k].stackable) return 'it would stand on a box that must not carry others'; area += ox * oy; below.push(o); }
  }
  // same rule as validate(): full support, or (interlocked layers) the chosen share of the base and the centre over a box
  const ms = ctx.cont.minSupport ?? 1;
  if (ms < 1) return area < ms * b.dx * b.dy - EPS ? `less than ${Math.round(ms * 100)}% of its base would rest on boxes below` : centreOn(b, below) ? '' : 'its centre would not be over a box below';
  return area < b.dx * b.dy * (1 - 1e-9) - EPS ? 'it would not stand fully on the floor or on boxes below' : '';
}

// Orientation index (0-5, see ORIENT_NAMES) of a box, or -1.
export function orientIndex(it, b) {
  const d = [it.l, it.w, it.h];
  const P = [[0, 1, 2], [1, 0, 2], [0, 2, 1], [2, 0, 1], [1, 2, 0], [2, 1, 0]];
  return P.findIndex((p) => Math.abs(d[p[0]] - b.dx) < 0.5 && Math.abs(d[p[1]] - b.dy) < 0.5 && Math.abs(d[p[2]] - b.dz) < 0.5);
}

// Why a box cannot go at b (ignoring the boxes in `ignore`), or '' when it can.
export function placeProblem(ctx, b, ignore) {
  const { cont } = ctx; const it = ctx.items[b.k];
  if (!it) return 'unknown box type';
  if (b.x < -EPS || b.y < -EPS || b.z < -EPS || b.x + b.dx > cont.L + EPS || b.y + b.dy > cont.W + EPS || b.z + b.dz > cont.H + EPS) return 'it would stick out of the load space';
  const d = [it.l, it.w, it.h];
  if (!allowedPerms(it).some((p) => Math.abs(d[p[0]] - b.dx) < EPS && Math.abs(d[p[1]] - b.dy) < EPS && Math.abs(d[p[2]] - b.dz) < EPS)) return 'this box may not be turned that way';
  if ((cont.doorW && b.dy > cont.doorW + EPS) || (cont.doorH && b.dz > cont.doorH + EPS)) return 'it would not pass the door turned this way';
  if (hits(ctx, b, ignore) >= 0) return 'it would hit another box';
  return support(ctx, b, ignore);
}

// Boxes standing directly on box i.
export function onTop(ctx, i) {
  const b = ctx.boxes[i]; const out = [];
  for (const j of ctx.grid.near(b.x, b.y, b.z + b.dz, b.dx, b.dy, 1)) {
    const o = ctx.boxes[j];
    if (j === i || Math.abs(o.z - (b.z + b.dz)) > EPS) continue;
    if (Math.min(b.x + b.dx, o.x + o.dx) - Math.max(b.x, o.x) > EPS && Math.min(b.y + b.dy, o.y + o.dy) - Math.max(b.y, o.y) > EPS) out.push(j);
  }
  return out;
}
// Box i and everything that stands on it, directly or higher up.
export function stackFrom(ctx, i) {
  const seen = new Set([i]); const todo = [i];
  while (todo.length) for (const j of onTop(ctx, todo.pop())) if (!seen.has(j)) { seen.add(j); todo.push(j); }
  return [...seen];
}

// Candidate corner points next to, behind, beside and on top of every box (extreme points).
function cornerPoints(ctx, d, ignore) {
  const { cont } = ctx; const pts = new Map();
  const add = (x, y, z) => {
    if (x < -EPS || y < -EPS || z < -EPS || x + d[0] > cont.L + EPS || y + d[1] > cont.W + EPS || z + d[2] > cont.H + EPS) return;
    const k = `${Math.round(x * 10)},${Math.round(y * 10)},${Math.round(z * 10)}`;
    if (!pts.has(k)) pts.set(k, [Math.max(0, x), Math.max(0, y), Math.max(0, z)]);
  };
  add(0, 0, 0); add(0, cont.W - d[1], 0); add(cont.L - d[0], 0, 0); add(cont.L - d[0], cont.W - d[1], 0);
  ctx.boxes.forEach((o, i) => {
    if (ignore?.has(i)) return;
    add(o.x + o.dx, o.y, o.z); add(o.x, o.y + o.dy, o.z); add(o.x, o.y, o.z + o.dz);
    add(o.x - d[0], o.y, o.z); add(o.x, o.y - d[1], o.z);
    add(o.x + o.dx, o.y + o.dy - d[1], o.z); add(o.x + o.dx - d[0], o.y + o.dy, o.z);
    add(o.x + o.dx, cont.W - d[1], o.z); add(o.x + o.dx, 0, o.z); add(o.x + o.dx, o.y, 0); add(o.x, o.y + o.dy, 0);
  });
  return [...pts.values()];
}

// Free spots where one box of type k fits, sorted back wall first, then bottom up. `orient` is an
// orientation index (fixed) or null (automatic: at each spot the first allowed orientation that fits).
export function spots(ctx, k, orient, opts = {}) {
  const it = ctx.items[k]; if (!it) return [];
  let os = it.os;
  if (orient != null) { const P = [[0, 1, 2], [1, 0, 2], [0, 2, 1], [2, 0, 1], [1, 2, 0], [2, 1, 0]][orient]; const d = [it.l, it.w, it.h]; const o = [d[P[0]], d[P[1]], d[P[2]]]; os = os.filter((x) => x.join() === o.join()); }
  if (opts.prefer) os = [...os].sort((a, b) => (b.join() === opts.prefer.join()) - (a.join() === opts.prefer.join()));
  const found = new Map();
  for (const o of os) {
    for (const [x, y, z] of cornerPoints(ctx, o, opts.ignore)) {
      const key = `${Math.round(x * 10)},${Math.round(y * 10)},${Math.round(z * 10)}`;
      if (orient == null && found.has(key)) continue;
      const b = { k, x, y, z, dx: o[0], dy: o[1], dz: o[2] };
      if (!placeProblem(ctx, b, opts.ignore)) found.set(orient == null ? key : key + o.join(), b);
    }
  }
  return [...found.values()].sort((a, b) => a.x - b.x || a.z - b.z || a.y - b.y).slice(0, opts.limit ?? 2000);
}

// Slide box i along one axis (0 along, 1 across, 2 up) in direction dir (+1 / -1) to the nearest
// spot that is free; snaps to the walls and to the faces of other boxes. Returns the new box or null.
export function nudge(ctx, i, axis, dir) {
  const b = ctx.boxes[i]; const P = ['x', 'y', 'z'][axis], D = ['dx', 'dy', 'dz'][axis];
  const size = [ctx.cont.L, ctx.cont.W, ctx.cont.H][axis];
  const vals = new Set([0, size - b[D]]);
  ctx.boxes.forEach((o, j) => { if (j !== i) { vals.add(o[P]); vals.add(o[P] + o[D]); vals.add(o[P] - b[D]); vals.add(o[P] + o[D] - b[D]); } });
  const cur = b[P]; const ignore = new Set([i]);
  const list = [...vals].filter((v) => (dir > 0 ? v > cur + EPS : v < cur - EPS)).sort((a, c) => Math.abs(a - cur) - Math.abs(c - cur));
  for (const v of list) { const c = { ...b, [P]: v }; if (!placeProblem(ctx, c, ignore)) return c; }
  return null;
}

// "Fill the rest automatically": keeps the boxes already in the plan and loads what is left.
// Gaps behind the front of the kept cargo are filled block by block at corner points (extreme
// points, Crainic, Perboli and Tadei 2008); the empty space in front of it uses the block-building
// engine. Returns a result in the same shape as pack() (k = box type's input position).
export function fillAround(container, rawItems, fixed, opts = {}) {
  const ctx = makeCtx(container, rawItems, fixed);
  const { cont, items, boxes } = ctx;
  cont.priority = !!opts.priority;
  const qty = items.map((it) => it.qty);
  let wLeft = cont.maxWeight > 0 ? cont.maxWeight : Infinity;
  for (const b of boxes) { qty[b.k]--; wLeft -= items[b.k].weight; }
  const front = boxes.reduce((m, b) => Math.max(m, b.x + b.dx), 0);
  const order = items.map((_, k) => k); // list order (only matters with priority)
  // 1) gaps behind the front line
  if (front > 0) {
    const seen = new Set(); let pts = [];
    const add = (x, y, z) => {
      if (x < -EPS || y < -EPS || z < -EPS || x >= front - EPS || y >= cont.W - EPS || z >= cont.H - EPS) return;
      const key = `${Math.round(x * 10)},${Math.round(y * 10)},${Math.round(z * 10)}`;
      if (!seen.has(key)) { seen.add(key); pts.push([x, y, z]); }
    };
    const corners = (o) => { add(o.x + o.dx, o.y, o.z); add(o.x, o.y + o.dy, o.z); add(o.x, o.y, o.z + o.dz); add(o.x + o.dx, o.y, 0); add(o.x, o.y + o.dy, 0); add(o.x + o.dx, 0, o.z); add(o.x, 0, o.z + o.dz); };
    add(0, 0, 0); boxes.forEach(corners);
    let guard = 0;
    while (pts.length && guard++ < 50000 && qty.some((q) => q > 0)) {
      let bi = 0;
      for (let i = 1; i < pts.length; i++) { const a = pts[i], c = pts[bi]; if (a[0] < c[0] - EPS || (Math.abs(a[0] - c[0]) <= EPS && (a[2] < c[2] - EPS || (Math.abs(a[2] - c[2]) <= EPS && a[1] < c[1])))) bi = i; }
      const p = pts[bi]; pts[bi] = pts[pts.length - 1]; pts.pop();
      let best = null;
      for (const k of order) {
        const it = items[k]; if (qty[k] < 1) continue;
        const cap = Math.min(qty[k], it.weight > 0 ? Math.floor(wLeft / it.weight + 1e-9) : Infinity); if (cap < 1) continue;
        for (const o of it.os) {
          const cell = (i, j, m) => ({ k, x: p[0] + i * o[0], y: p[1] + j * o[1], z: p[2] + m * o[2], dx: o[0], dy: o[1], dz: o[2] });
          const free = (b) => b.x + b.dx <= front + EPS && b.y + b.dy <= cont.W + EPS && b.z + b.dz <= cont.H + EPS && hits(ctx, b) < 0;
          const base = cell(0, 0, 0);
          if (!free(base) || support(ctx, base)) continue;
          const maxZ = it.stackable ? (it.maxLayers || Infinity) : 1;
          let nz = 1; while (nz < maxZ && nz < cap && free(cell(0, 0, nz))) nz++;
          const col = (i, j) => { for (let m = 0; m < nz; m++) if (!free(cell(i, j, m))) return false; return !support(ctx, cell(i, j, 0)); };
          let ny = 1; while (ny < Math.floor(cap / nz) && col(0, ny)) ny++;
          const slab = (i) => { for (let j = 0; j < ny; j++) if (!col(i, j)) return false; return true; };
          let nx = 1; while (nx < Math.floor(cap / (nz * ny)) && slab(nx)) nx++;
          const vol = nx * ny * nz * o[0] * o[1] * o[2];
          if (!best || vol > best.vol + EPS) best = { k, o, nx, ny, nz, vol, cell };
        }
        if (cont.priority && best) break;
      }
      if (!best) continue;
      for (let i = 0; i < best.nx; i++) for (let j = 0; j < best.ny; j++) for (let m = 0; m < best.nz; m++) addBox(ctx, { ...best.cell(i, j, m), add: 1 });
      const n = best.nx * best.ny * best.nz; qty[best.k] -= n; wLeft -= n * items[best.k].weight;
      corners({ x: p[0], y: p[1], z: p[2], dx: best.nx * best.o[0], dy: best.ny * best.o[1], dz: best.nz * best.o[2] });
    }
  }
  // 2) the empty space in front of the kept cargo
  if (front < cont.L - EPS && qty.some((q) => q > 0) && wLeft > 0) {
    const rest = rawItems.map((it, k) => ({ ...it, qty: Math.max(0, qty[k]) }));
    const r = pack({ L: cont.L - front, W: cont.W, H: cont.H, maxWeight: Number.isFinite(wLeft) ? Math.max(wLeft, 1e-9) : 0, doorW: cont.doorW, doorH: cont.doorH }, rest, { ...opts, priority: cont.priority });
    for (const p of r.placed) addBox(ctx, { k: r.items[p.k].idx, x: p.x + front, y: p.y, z: p.z, dx: p.dx, dy: p.dy, dz: p.dz, add: 1 });
  }
  const placed = boxes.slice().sort((a, b) => a.x - b.x || a.z - b.z || a.y - b.y);
  return { placed, items, cont, steps: null, ...summarize(placed, items) };
}

// A hand-edited plan in the same shape as pack(), so validate() and the page can use it.
export function asResult(ctx) {
  const placed = ctx.boxes.slice();
  return { placed, items: ctx.items, cont: ctx.cont, steps: null, ...summarize(placed, ctx.items) };
}
export { validate };

// "Room for more": keeping the plan as it is, how many more boxes of type k alone still fit in the space
// left (and under the payload left). Uses the same fill as "Fill the rest automatically", so every extra box
// passes the same checks. Returns { more, limit: 'payload' | 'space', result }.
export function roomFor(container, rawItems, fixed, k, opts = {}) {
  const have = rawItems.map(() => 0);
  for (const b of fixed) have[b.k]++;
  const cap = opts.cap ?? 20000;
  const items = rawItems.map((it, j) => ({ ...it, qty: have[j] + (j === k ? cap : 0) }));
  const r = fillAround(container, items, fixed, { tries: opts.tries ?? 15, timeMs: opts.timeMs ?? 250 });
  const more = r.totals.n - fixed.length;
  const it = r.items[k];
  const limit = r.cont.maxWeight > 0 && it && it.weight > 0 && r.totals.w + it.weight > r.cont.maxWeight + 1e-6 ? 'payload' : 'space';
  return { more, limit, result: r };
}
