// Container / pallet loading engine. Pure JS, no DOM: runs in a Web Worker, the page, and Node tests.
// Units: millimetres and kilograms. Axes: x = length (back wall -> door), y = width, z = height.
//
// Method: block building (Eley 2002; Fanslau & Bortfeldt 2010). The empty space is a list of
// cuboids. Each step takes the cuboid nearest the back wall and floor, fills its corner with the best
// block of identical boxes (nx x ny x nz in one orientation), and splits what is left into new cuboids
// (guillotine cuts). The space above a block is limited to the block's footprint, so every box stands
// fully on the floor or on boxes below it. Many greedy runs with different scoring rules and seeded
// random choices are tried; the best run is kept, so the same input always gives the same answer.

export const ORIENT = {
  // permutation of [l, w, h] -> [dx, dy, dz]
  any: [[0, 1, 2], [1, 0, 2], [0, 2, 1], [2, 0, 1], [1, 2, 0], [2, 1, 0]],
  upright: [[0, 1, 2], [1, 0, 2]],
};

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

function orientations(it) {
  if (it.os) return it.os;
  const d = [it.l, it.w, it.h];
  const seen = new Set(); const out = [];
  for (const p of ORIENT[it.rotation === 'upright' ? 'upright' : 'any']) {
    const o = [d[p[0]], d[p[1]], d[p[2]]];
    const k = o.join('x');
    if (!seen.has(k)) { seen.add(k); out.push(o); }
  }
  return out;
}

// Candidate block shapes for an item in a space, respecting quantity and weight left.
function blocks(it, o, sp, qty, wLeft) {
  const [dx, dy, dz] = o;
  const mx = Math.floor(sp.sx / dx), my = Math.floor(sp.sy / dy);
  let mz = Math.floor(sp.sz / dz);
  if (!it.stackable) mz = Math.min(mz, 1);
  if (it.maxLayers) mz = Math.min(mz, it.maxLayers);
  if (mx < 1 || my < 1 || mz < 1) return [];
  const byW = it.weight > 0 ? Math.floor(wLeft / it.weight + 1e-9) : Infinity;
  const cap = Math.min(qty, byW);
  if (cap < 1) return [];
  const out = [];
  const add = (nx, ny, nz) => { if (nx >= 1 && ny >= 1 && nz >= 1 && nx * ny * nz <= cap) out.push([nx, ny, nz]); };
  // full column walls first (fill height, then width, then as much length as quantity allows)
  for (const order of [[2, 1, 0], [1, 2, 0], [2, 0, 1], [0, 2, 1], [1, 0, 2], [0, 1, 2]]) {
    const m = [mx, my, mz]; const n = [1, 1, 1]; let left = cap;
    for (const a of order) { const per = n[0] * n[1] * n[2]; n[a] = Math.max(1, Math.min(m[a], Math.floor(left / per))); }
    add(n[0], n[1], n[2]);
  }
  return out;
}

// Best count of one item in an empty cuboid using two blocks side by side (two orientations with
// the same height, cut along length or width), times the number of layers. Used as a cheap
// look-ahead: how well can the space left over by a block still be filled?
function twoBlock(it, sx, sy, sz) {
  const os = orientations(it);
  let best = 0;
  for (const a of os) {
    if (a[2] > sz) continue;
    let layers = Math.floor(sz / a[2]);
    if (!it.stackable) layers = Math.min(layers, 1);
    if (it.maxLayers) layers = Math.min(layers, it.maxLayers);
    const g = (o, X, Y) => Math.floor(X / o[0]) * Math.floor(Y / o[1]);
    for (const b of os) {
      if (b[2] !== a[2]) continue;
      for (let cx = 0; cx <= sx; cx += a[0]) { const c = g(a, cx, sy) + g(b, sx - cx, sy); if (c * layers > best) best = c * layers; }
      for (let cy = 0; cy <= sy; cy += a[1]) { const c = g(a, sx, cy) + g(b, sx, sy - cy); if (c * layers > best) best = c * layers; }
    }
  }
  return best;
}

function score(rule, vol, sp, bx, by, bz) {
  const fill = vol / (sp.sx * sp.sy * sp.sz);
  switch (rule) {
    case 1: return vol * (0.6 + 0.4 * (bz / sp.sz)) * (0.6 + 0.4 * (by / sp.sy)); // prefer full walls
    case 2: return fill * 1e12 + vol; // best fit of the space
    case 3: return vol * (by / sp.sy) * (bz / sp.sz); // strict wall building
    default: return vol;
  }
}

function residuals(sp, c, it, useA) {
  const rx = sp.sx - c.bx, ry = sp.sy - c.by, rz = sp.sz - c.bz;
  const out = [];
  if (rz > 0 && it.stackable) out.push({ x: sp.x, y: sp.y, z: sp.z + c.bz, sx: c.bx, sy: c.by, sz: rz, under: [c.k] });
  if (useA) { // front piece spans the full width
    if (rx > 0) out.push({ x: sp.x + c.bx, y: sp.y, z: sp.z, sx: rx, sy: sp.sy, sz: sp.sz, under: sp.under });
    if (ry > 0) out.push({ x: sp.x, y: sp.y + c.by, z: sp.z, sx: c.bx, sy: ry, sz: sp.sz, under: sp.under });
  } else { // side piece spans the full length
    if (ry > 0) out.push({ x: sp.x, y: sp.y + c.by, z: sp.z, sx: sp.sx, sy: ry, sz: sp.sz, under: sp.under });
    if (rx > 0) out.push({ x: sp.x + c.bx, y: sp.y, z: sp.z, sx: rx, sy: c.by, sz: sp.sz, under: sp.under });
  }
  return out;
}

function packOnce(cont, items, rule, splitRule, rand, noise) {
  const qty = items.map((it) => it.qty);
  let wLeft = cont.maxWeight > 0 ? cont.maxWeight : Infinity;
  const spaces = [{ x: 0, y: 0, z: 0, sx: cont.L, sy: cont.W, sz: cont.H }];
  const placed = [];
  const minDim = Math.min(...items.flatMap((it) => [it.l, it.w, it.h]));
  const vols = items.map((it) => it.l * it.w * it.h);
  const memo = new Map();
  const est = (r, k0, n0) => { // look-ahead value of a residual space (volume it can still take)
    if (r.z > 0 && r.under && r.under.some((u) => !items[u].stackable)) return 0;
    const key = r.sx + ',' + r.sy + ',' + r.sz;
    let counts = memo.get(key);
    if (!counts) { counts = items.map((it) => twoBlock(it, r.sx, r.sy, r.sz)); memo.set(key, counts); }
    let best = 0;
    for (let k = 0; k < items.length; k++) {
      const left = qty[k] - (k === k0 ? n0 : 0);
      if (left > 0) best = Math.max(best, Math.min(counts[k], left) * vols[k]);
    }
    return best;
  };
  let guard = 0;
  while (spaces.length && guard++ < 100000) {
    // nearest the back wall, then lowest, then leftmost
    let bi = 0;
    for (let i = 1; i < spaces.length; i++) {
      const a = spaces[i], b = spaces[bi];
      if (a.x < b.x || (a.x === b.x && (a.z < b.z || (a.z === b.z && a.y < b.y)))) bi = i;
    }
    const sp = spaces.splice(bi, 1)[0];
    if (sp.sx < minDim && sp.sy < minDim && sp.sz < minDim) continue;
    if (sp.z > 0 && sp.under && sp.under.some((u) => !items[u].stackable)) continue;
    const cands = [];
    for (let k = 0; k < items.length; k++) {
      if (qty[k] < 1) continue;
      const it = items[k];
      for (const o of orientations(it)) {
        if (o[0] > sp.sx || o[1] > sp.sy || o[2] > sp.sz) continue;
        const shapes = blocks(it, o, sp, qty[k], wLeft);
        if (rule === 4 && shapes.length) { // shorter walls too, so a mixed pattern can be found
          const [nx0, ny0, nz0] = shapes[0];
          for (let nx = 1; nx < nx0; nx++) shapes.push([nx, ny0, nz0]);
          for (let ny = 1; ny < ny0; ny++) shapes.push([nx0, ny, nz0]);
        }
        for (const [nx, ny, nz] of shapes) {
          const bx = nx * o[0], by = ny * o[1], bz = nz * o[2];
          const c = { k, o, nx, ny, nz, bx, by, bz, useA: null, s: 0 };
          if (rule === 4) {
            const n = nx * ny * nz; let bestS = -1;
            for (const useA of [true, false]) {
              const sc = bx * by * bz + residuals(sp, c, it, useA).reduce((t, r) => t + est(r, k, n), 0);
              if (sc > bestS) { bestS = sc; c.useA = useA; }
            }
            c.s = bestS;
          } else c.s = score(rule, bx * by * bz, sp, bx, by, bz);
          if (noise) c.s *= 1 + noise * (rand() - 0.5);
          if (cont.priority) c.s += (items.length - k) * 1e30; // list order first
          cands.push(c);
        }
      }
    }
    if (!cands.length) continue;
    let c = cands[0];
    for (const d of cands) if (d.s > c.s) c = d;
    const it = items[c.k];
    for (let i = 0; i < c.nx; i++) for (let j = 0; j < c.ny; j++) for (let m = 0; m < c.nz; m++) {
      placed.push({ k: c.k, x: sp.x + i * c.o[0], y: sp.y + j * c.o[1], z: sp.z + m * c.o[2], dx: c.o[0], dy: c.o[1], dz: c.o[2] });
    }
    const n = c.nx * c.ny * c.nz;
    qty[c.k] -= n;
    wLeft -= n * it.weight;
    let useA = c.useA;
    if (useA === null) {
      const rx = sp.sx - c.bx, ry = sp.sy - c.by;
      const volA = Math.max(rx * sp.sy, ry * c.bx), volB = Math.max(ry * sp.sx, rx * c.by);
      useA = splitRule === 0 ? volA >= volB : splitRule === 1;
    }
    spaces.push(...residuals(sp, c, it, useA));
    if (qty.every((q) => q < 1)) break;
  }
  return placed;
}

function evaluate(placed, items) {
  let vol = 0, w = 0;
  for (const p of placed) { vol += p.dx * p.dy * p.dz; w += items[p.k].weight; }
  return { vol, w, n: placed.length };
}

export function pack(container, rawItems, opts = {}) {
  const cont = { L: +container.L, W: +container.W, H: +container.H, maxWeight: +container.maxWeight || 0,
    doorW: +container.doorW || 0, doorH: +container.doorH || 0, priority: !!opts.priority };
  const items = rawItems
    .map((it, i) => ({ ...it, idx: i, l: +it.l, w: +it.w, h: +it.h, weight: +it.weight || 0, qty: Math.floor(+it.qty || 0), stackable: it.stackable !== false }))
    .filter((it) => it.l > 0 && it.w > 0 && it.h > 0 && it.qty > 0);
  // a box must pass the door in the orientation it is stowed in (width across, height up)
  for (const it of items) it.os = orientations(it).filter((o) => (!cont.doorW || o[1] <= cont.doorW) && (!cont.doorH || o[2] <= cont.doorH));
  if (!(cont.L > 0 && cont.W > 0 && cont.H > 0) || !items.length) return { placed: [], items, cont, totals: { vol: 0, w: 0, n: 0 } };
  const tries = opts.tries ?? 120;
  const rand = rng(opts.seed ?? 12345);
  let best = null, bestE = null;
  const consider = (placed) => {
    const e = evaluate(placed, items);
    if (!best || e.vol > bestE.vol + 1e-6 || (Math.abs(e.vol - bestE.vol) < 1e-6 && e.n > bestE.n)) { best = placed; bestE = e; }
  };
  for (let rule = 0; rule < 4; rule++) for (let split = 0; split < 3; split++) consider(packOnce(cont, items, rule, split, rand, 0));
  consider(packOnce(cont, items, 4, 0, rand, 0));
  const total = items.reduce((s, it) => s + it.qty, 0);
  const t0 = Date.now(), budget = opts.timeMs ?? 1500;
  for (let t = 0; t < tries && bestE.n < total && Date.now() - t0 < budget; t++) consider(packOnce(cont, items, t % 5, t % 3, rand, 0.3));
  // loading order: back wall first, bottom up
  best.sort((a, b) => a.x - b.x || a.z - b.z || a.y - b.y);
  const perItem = items.map(() => 0);
  for (const p of best) perItem[p.k]++;
  let cx = 0, cy = 0, cz = 0;
  for (const p of best) { const m = items[p.k].weight; cx += m * (p.x + p.dx / 2); cy += m * (p.y + p.dy / 2); cz += m * (p.z + p.dz / 2); }
  const cog = bestE.w > 0 ? { x: cx / bestE.w, y: cy / bestE.w, z: cz / bestE.w } : null;
  return { placed: best, items, cont, totals: bestE, perItem, cog };
}

// Independent checker used by tests and by the page before showing a plan.
export function validate(res, eps = 0.01) {
  const { placed, items, cont } = res; const errors = [];
  let w = 0;
  for (const p of placed) {
    if (p.x < -eps || p.y < -eps || p.z < -eps || p.x + p.dx > cont.L + eps || p.y + p.dy > cont.W + eps || p.z + p.dz > cont.H + eps) errors.push('outside container');
    const it = items[p.k];
    const dims = [it.l, it.w, it.h].sort((a, b) => a - b).join(), got = [p.dx, p.dy, p.dz].sort((a, b) => a - b).join();
    if (dims !== got) errors.push('wrong box size');
    if (it.rotation === 'upright' && Math.abs(p.dz - it.h) > eps) errors.push('upright box turned');
    if ((cont.doorW && p.dy > cont.doorW + eps) || (cont.doorH && p.dz > cont.doorH + eps)) errors.push('box larger than the door');
    w += it.weight;
  }
  if (cont.maxWeight > 0 && w > cont.maxWeight + eps) errors.push('over weight limit');
  const counts = items.map(() => 0); placed.forEach((p) => counts[p.k]++);
  items.forEach((it, i) => { if (counts[i] > it.qty) errors.push('more boxes than ordered'); });
  // overlaps and support (grid of x-sorted boxes keeps this fast enough for a few thousand boxes)
  const s = [...placed].sort((a, b) => a.x - b.x);
  for (let i = 0; i < s.length; i++) {
    const a = s[i];
    for (let j = i + 1; j < s.length && s[j].x < a.x + a.dx - eps; j++) {
      const b = s[j];
      if (a.y < b.y + b.dy - eps && b.y < a.y + a.dy - eps && a.z < b.z + b.dz - eps && b.z < a.z + a.dz - eps) { errors.push('boxes overlap'); break; }
    }
  }
  for (const a of placed) {
    if (a.z < eps) continue;
    let area = 0;
    for (const b of placed) {
      if (Math.abs(b.z + b.dz - a.z) > eps) continue;
      const ox = Math.min(a.x + a.dx, b.x + b.dx) - Math.max(a.x, b.x), oy = Math.min(a.y + a.dy, b.y + b.dy) - Math.max(a.y, b.y);
      if (ox > 0 && oy > 0) { area += ox * oy; if (!items[b.k].stackable) errors.push('box on a non-stackable box'); }
    }
    if (area < a.dx * a.dy - eps) errors.push('box not fully supported');
  }
  return [...new Set(errors)];
}
