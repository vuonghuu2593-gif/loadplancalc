// Container / pallet loading engine. Pure JS, no DOM: runs in a Web Worker, the page, and Node tests.
// Units: millimetres and kilograms. Axes: x = length (back wall -> door), y = width, z = height.
//
// Method: block building (Eley 2002; Fanslau & Bortfeldt 2010). The empty space is a list of
// cuboids. Each step takes the cuboid nearest the back wall and floor, fills its corner with the best
// block of identical boxes (nx x ny x nz in one orientation), and splits what is left into new cuboids
// (guillotine cuts). The space above a block is limited to the block's footprint, so every box stands
// fully on the floor or on boxes below it. Many greedy runs with different scoring rules and seeded
// random choices are tried; the best run is kept, so the same input always gives the same answer.

import { bestPair, bestLayer } from './interlock.js';

export const ORIENT = {
  // permutation of [l, w, h] -> [dx, dy, dz]
  any: [[0, 1, 2], [1, 0, 2], [0, 2, 1], [2, 0, 1], [1, 2, 0], [2, 1, 0]],
  upright: [[0, 1, 2], [1, 0, 2]],
};

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

// The six ways a box can sit, as [along the length, across the width, up] taken from [l, w, h].
// Index order is used by the page and share links: 0-1 height up, 2-3 width up, 4-5 length up.
export const ORIENT_NAMES = ['Height up, length along', 'Height up, length across', 'Width up, length along',
  'Width up, length across', 'Length up, width along', 'Length up, width across'];

// Orientations a box type may use: "any" (all six), "upright" (height stays vertical) or
// "custom" (the ones the user ticked, by index into ORIENT.any).
export function allowedPerms(it) {
  if (it.rotation === 'upright') return ORIENT.upright;
  if (it.rotation === 'custom' && Array.isArray(it.orients)) return ORIENT.any.filter((_, i) => it.orients.includes(i));
  return ORIENT.any;
}

function orientations(it) {
  if (it.os) return it.os;
  const d = [it.l, it.w, it.h];
  const seen = new Set(); const out = [];
  for (const p of allowedPerms(it)) {
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

// One greedy run. Without `start` it fills the empty container. With `start` (semi-automatic steps)
// it continues from an earlier state: quantities, weight left and the free spaces left by earlier
// steps; spaces this run cannot use are handed back so later steps can still fill them.
function packOnce(cont, items, rule, splitRule, rand, noise, start) {
  const qty = start ? start.qty.slice() : items.map((it) => it.qty);
  let wLeft = start ? start.wLeft : (cont.maxWeight > 0 ? cont.maxWeight : Infinity);
  const spaces = start ? start.spaces.slice() : [{ x: 0, y: 0, z: 0, sx: cont.L, sy: cont.W, sz: cont.H }];
  const kept = [];
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
    if (!cands.length) { if (start) kept.push(sp); continue; }
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
  return { placed, spaces: spaces.concat(kept), qty, wLeft };
}

function evaluate(placed, items) {
  let vol = 0, w = 0, front = 0;
  for (const p of placed) { vol += p.dx * p.dy * p.dz; w += items[p.k].weight; if (p.x + p.dx > front) front = p.x + p.dx; }
  return { vol, w, n: placed.length, front };
}

// Many greedy runs (fixed rules first, then seeded random variations); keeps the run that loads the
// most volume, then the most boxes. The same input and seed always give the same answer.
function search(cont, items, start, rand, opts, budget) {
  let best = null, bestE = null;
  const consider = (r) => {
    const e = evaluate(r.placed, items);
    // most volume, then most boxes, then the most compact load (shortest distance from the back wall)
    const tie = Math.abs(e.vol - bestE?.vol) < 1e-6;
    if (!best || e.vol > bestE.vol + 1e-6 || (tie && e.n > bestE.n) || (tie && e.n === bestE.n && e.front < bestE.front - 1e-6)) { best = r; bestE = e; }
  };
  for (let rule = 0; rule < 4; rule++) for (let split = 0; split < 3; split++) consider(packOnce(cont, items, rule, split, rand, 0, start));
  consider(packOnce(cont, items, 4, 0, rand, 0, start));
  const total = (start ? start.qty : items.map((it) => it.qty)).reduce((s, q) => s + q, 0);
  const tries = opts.tries ?? 120;
  const t0 = Date.now();
  for (let t = 0; t < tries && bestE.n < total && Date.now() - t0 < budget; t++) consider(packOnce(cont, items, t % 5, t % 3, rand, 0.3, start));
  return best;
}

// Numbers in, every box type kept (idx = position in the input list). `os` holds the orientations a
// box may use that also pass the door (width across, height up), as [along, across, up] in mm.
export function normalize(container, rawItems, opts = {}) {
  const cont = { L: +container.L, W: +container.W, H: +container.H, maxWeight: +container.maxWeight || 0,
    doorW: +container.doorW || 0, doorH: +container.doorH || 0, priority: !!opts.priority,
    minSupport: supportShare(container.minSupport) };
  const items = rawItems.map((it, i) => ({ ...it, idx: i, l: +it.l, w: +it.w, h: +it.h, weight: +it.weight || 0, qty: Math.floor(+it.qty || 0), stackable: it.stackable !== false }));
  for (const it of items) it.os = it.l > 0 && it.w > 0 && it.h > 0 ? orientations({ ...it, os: null }).filter((o) => (!cont.doorW || o[1] <= cont.doorW) && (!cont.doorH || o[2] <= cont.doorH)) : [];
  return { cont, items };
}

export function pack(container, rawItems, opts = {}) {
  const n0 = normalize(container, rawItems, opts);
  const cont = n0.cont;
  const items = n0.items.filter((it) => it.l > 0 && it.w > 0 && it.h > 0 && it.qty > 0);
  if (!(cont.L > 0 && cont.W > 0 && cont.H > 0) || !items.length) return { placed: [], items, cont, totals: { vol: 0, w: 0, n: 0 }, perItem: items.map(() => 0), cog: null, steps: null };
  const rand = rng(opts.seed ?? 12345);
  const budget = opts.timeMs ?? 1500;
  let placed, steps = null;
  if (Array.isArray(opts.steps) && opts.steps.length) ({ placed, steps } = packSteps(cont, items, opts, rand, budget));
  else {
    placed = search(cont, items, null, rand, opts, budget).placed;
    // loading order: back wall first, bottom up
    placed.sort((a, b) => a.x - b.x || a.z - b.z || a.y - b.y);
  }
  return { placed, items, cont, steps, ...summarize(placed, items) };
}

// Totals, boxes per type and the cargo's centre of gravity for a list of placed boxes.
export function summarize(placed, items) {
  const { vol, w, n } = evaluate(placed, items); const totals = { vol, w, n };
  const perItem = items.map(() => 0);
  for (const p of placed) perItem[p.k]++;
  let cx = 0, cy = 0, cz = 0;
  for (const p of placed) { const m = items[p.k].weight; cx += m * (p.x + p.dx / 2); cy += m * (p.y + p.dy / 2); cz += m * (p.z + p.dz / 2); }
  const cog = totals.w > 0 ? { x: cx / totals.w, y: cy / totals.w, z: cz / totals.w } : null;
  return { totals, perItem, cog };
}

// Semi-automatic mode: the user sets the loading steps (box type, how many, a fixed orientation or
// automatic, and whether the step starts a new section in front of everything loaded so far). Each
// step is searched on its own from the state the earlier steps left; an optional last step loads
// whatever remains automatically. Boxes keep their step number (p.s) and are listed step by step.
function packSteps(cont, items, opts, rand, budget) {
  const raw = opts.steps.slice(0, 30);
  const plan = raw.map((s) => {
    const k = items.findIndex((it) => it.idx === +s.item);
    const orient = Number.isInteger(s.orient) && s.orient >= 0 && s.orient < 6 ? s.orient : null;
    const qty = s.qty === '' || s.qty == null ? null : Math.max(0, Math.floor(+s.qty || 0));
    return { k, orient, qty, newSection: !!s.newSection, asked: 0, loaded: 0 };
  });
  if (opts.fillRest !== false) plan.push({ k: -1, orient: null, qty: null, newSection: false, auto: true, asked: 0, loaded: 0 });
  let st = { qty: items.map((it) => it.qty), wLeft: cont.maxWeight > 0 ? cont.maxWeight : Infinity, spaces: [{ x: 0, y: 0, z: 0, sx: cont.L, sy: cont.W, sz: cont.H }] };
  const placed = [];
  const per = budget / Math.max(1, plan.length);
  plan.forEach((step, si) => {
    if (step.newSection) {
      const front = placed.reduce((m, p) => Math.max(m, p.x + p.dx), 0);
      st.spaces = front < cont.L ? [{ x: front, y: 0, z: 0, sx: cont.L - front, sy: cont.W, sz: cont.H }] : [];
      step.front = front;
    }
    const qty = items.map(() => 0);
    if (step.auto) items.forEach((_, k) => { qty[k] = st.qty[k]; });
    else if (step.k >= 0) qty[step.k] = step.qty == null ? st.qty[step.k] : Math.min(step.qty, st.qty[step.k]);
    step.asked = qty.reduce((s, q) => s + q, 0);
    if (!step.asked) return;
    let its = items;
    if (step.orient != null) { // fixed orientation for this step
      const it = items[step.k]; const d = [it.l, it.w, it.h]; const p = ORIENT.any[step.orient];
      const key = [d[p[0]], d[p[1]], d[p[2]]].join('x');
      its = items.map((x, k) => (k === step.k ? { ...x, os: x.os.filter((o) => o.join('x') === key) } : x));
    }
    const sub = { ...cont, priority: step.auto ? cont.priority : false };
    const r = search(sub, its, { ...st, qty }, rand, opts, per);
    r.placed.sort((a, b) => a.x - b.x || a.z - b.z || a.y - b.y);
    for (const p of r.placed) { p.s = si; placed.push(p); st.qty[p.k]--; }
    step.loaded = r.placed.length;
    st = { qty: st.qty, wLeft: r.wLeft, spaces: r.spaces };
  });
  return { placed, steps: plan };
}

// Share of a box's base that must rest on boxes below: 1 (full support, the default) or a lower
// figure the user chose for interlocked layers (0.5 to 1). Below 1 the box's centre must also be over
// a box below, so a box may bridge a small gap but never tip into it.
export function supportShare(v) { const n = +v; return Number.isFinite(n) && n > 0 && n < 1 ? Math.max(0.5, n) : 1; }
export function centreOn(a, below, eps = 0.01) {
  const cx = a.x + a.dx / 2, cy = a.y + a.dy / 2;
  return below.some((b) => cx >= b.x - eps && cx <= b.x + b.dx + eps && cy >= b.y - eps && cy <= b.y + b.dy + eps
    && Math.min(a.x + a.dx, b.x + b.dx) - Math.max(a.x, b.x) > eps && Math.min(a.y + a.dy, b.y + b.dy) - Math.max(a.y, b.y) > eps);
}

// Independent checker used by tests and by the page before showing a plan.
export function validate(res, eps = 0.01) {
  const { placed, items, cont } = res; const errors = []; const ms = supportShare(cont.minSupport);
  let w = 0;
  for (const p of placed) {
    if (p.x < -eps || p.y < -eps || p.z < -eps || p.x + p.dx > cont.L + eps || p.y + p.dy > cont.W + eps || p.z + p.dz > cont.H + eps) errors.push('outside container');
    const it = items[p.k];
    const dims = [it.l, it.w, it.h].sort((a, b) => a - b).join(), got = [p.dx, p.dy, p.dz].sort((a, b) => a - b).join();
    if (dims !== got) errors.push('wrong box size');
    if (it.rotation === 'upright' && Math.abs(p.dz - it.h) > eps) errors.push('upright box turned');
    if (!permsOf(it, allowedPerms(it)).some((o) => same(o, p))) errors.push('orientation not allowed');
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
    if (area < ms * a.dx * a.dy - eps) errors.push(ms < 1 ? 'box not supported enough' : 'box not fully supported');
    if (ms < 1 && !centreOn(a, placed.filter((b) => Math.abs(b.z + b.dz - a.z) <= eps))) errors.push('box centre not over a box below');
  }
  // semi-automatic steps: right box type, no more than asked, fixed orientation kept, new sections in front
  if (res.steps) {
    const st = res.steps;
    const n = st.map(() => 0);
    for (const p of placed) {
      const step = st[p.s];
      if (!step) { errors.push('box without a step'); continue; }
      n[p.s]++;
      if (!step.auto && p.k !== step.k) errors.push('wrong box type in a step');
      if (step.orient != null && !same(permsOf(items[p.k], [ORIENT.any[step.orient]])[0], p)) errors.push('step orientation not kept');
    }
    st.forEach((step, si) => {
      if (n[si] > step.asked) errors.push('more boxes in a step than asked');
      if (step.newSection) {
        const front = placed.filter((p) => p.s < si).reduce((m, p) => Math.max(m, p.x + p.dx), 0);
        if (placed.some((p) => p.s >= si && p.x < front - eps)) errors.push('box behind a new section line');
      }
    });
  }
  return [...new Set(errors)];
}

function permsOf(it, perms) { const d = [it.l, it.w, it.h]; return perms.map((p) => [d[p[0]], d[p[1]], d[p[2]]]); }
function same(o, p, eps = 0.01) { return Math.abs(o[0] - p.dx) < eps && Math.abs(o[1] - p.dy) < eps && Math.abs(o[2] - p.dz) < eps; }

// Layers of a one-box-type pallet plan, for Ti-Hi (boxes per layer × layers). Every box must stand
// with the same height up and sit on a layer line (z = a whole number of box heights); otherwise
// there is no single Ti-Hi and { mixed: true } comes back. kind: 'even' (all layers the same),
// 'top' (all the same except a smaller top layer) or 'uneven'.
export function layersOf(placed, eps = 0.01) {
  if (!placed.length) return null;
  const dz = placed[0].dz;
  if (placed.some((p) => Math.abs(p.dz - dz) > eps)) return { mixed: true };
  const counts = [];
  for (const p of placed) {
    const i = Math.round(p.z / dz);
    if (Math.abs(p.z - i * dz) > eps) return { mixed: true };
    counts[i] = (counts[i] || 0) + 1;
  }
  for (let i = 0; i < counts.length; i++) counts[i] = counts[i] || 0;
  const ti = counts[0], hi = counts.length, last = counts[hi - 1];
  const body = counts.slice(0, -1).every((c) => c === ti);
  const kind = body && last === ti ? 'even' : body && last < ti ? 'top' : 'uneven';
  return { mixed: false, dz, counts, ti, hi, kind, top: last };
}

// Pallet mode with one box type: build the pallet layer by layer. A full pallet is planned without the
// weight limit (as many boxes as fit), then the plan keeps its lowest boxes (sorted by height, then
// along, then across) up to the quantity and the weight limit. Every box in such a prefix stands on
// boxes that come earlier in the list, so the prefix of a valid plan is itself valid; validate() still
// checks it. The ordinary plan is kept when it loads more. `pallet` reports the full-pallet count
// (within the weight limit) and its layers for Ti-Hi.
export function palletPack(container, rawItems, opts = {}) {
  const live = rawItems.filter((it) => +it.l > 0 && +it.w > 0 && +it.h > 0 && Math.floor(+it.qty || 0) > 0);
  const budget = opts.timeMs ?? 1500;
  if (rawItems.length !== 1 || live.length !== 1 || (Array.isArray(opts.steps) && opts.steps.length)) return { ...pack(container, rawItems, opts), pallet: null };
  const it = rawItems[0], qty = Math.floor(+it.qty || 0), wt = +it.weight || 0, maxW = +container.maxWeight || 0;
  const full = pack({ ...container, maxWeight: 0 }, [{ ...it, qty: 20000 }], { ...opts, timeMs: budget / 2 });
  const capW = wt > 0 && maxW > 0 ? Math.floor(maxW / wt + 1e-9) : Infinity;
  const byLayer = full.placed.slice().sort((a, b) => a.z - b.z || a.x - b.x || a.y - b.y);
  let per = Math.min(full.totals.n, capW);
  const prefix = byLayer.slice(0, Math.min(qty, per));
  const normal = pack(container, rawItems, { ...opts, timeMs: budget / 2 });
  let placed, layers;
  if (prefix.length >= normal.totals.n) { placed = prefix; layers = layersOf(byLayer.slice(0, per)); }
  else {
    placed = normal.placed.slice().sort((a, b) => a.z - b.z || a.x - b.x || a.y - b.y);
    if (normal.totals.n < qty) { per = Math.max(per, normal.totals.n); layers = layersOf(normal.placed); } else layers = layersOf(byLayer.slice(0, per));
  }
  return { placed, items: normal.items, cont: normal.cont, steps: null, ...summarize(placed, normal.items), pallet: { perPallet: per, layers, weightLimited: capW < full.totals.n } };
}

// ---------- Interlocked layers (one box type) ----------
// The stacking pattern is the user's choice: 'column' = the plans above (every layer the same, the
// most boxes), 'interlock' = layers that alternate between two patterns so boxes bridge the seams
// below (see interlock.js). On a pallet the whole load is one stack of layers. In a container the
// length is cut into sections (walls) of equal length, each built of interlocked layers and loaded one
// after the other from the back wall; the space left in front of the last full section is filled by
// the ordinary planner. Returns null when the load is not one stackable box type or no pair of layers
// ties together.
export function interlockPack(container, rawItems, opts = {}) {
  const live = rawItems.filter((it) => +it.l > 0 && +it.w > 0 && +it.h > 0 && Math.floor(+it.qty || 0) > 0);
  if (rawItems.length !== 1 || live.length !== 1 || (Array.isArray(opts.steps) && opts.steps.length)) return null;
  const { cont, items } = normalize(container, rawItems, opts);
  const it = items[0];
  if (!it.stackable || !it.os.length || !(cont.L > 0 && cont.W > 0 && cont.H > 0)) return null;
  const min = cont.minSupport;
  const cap = Math.min(it.qty, it.weight > 0 && cont.maxWeight > 0 ? Math.floor(cont.maxWeight / it.weight + 1e-9) : Infinity);
  const sections = !!opts.sections;
  const deadline = Date.now() + (opts.timeMs ?? 1500) * 0.6; // the column plan gets the rest of the time
  let best = null;
  for (const dz of [...new Set(it.os.map((o) => o[2]))]) {
    let nl = Math.floor(cont.H / dz + 1e-9);
    if (it.maxLayers) nl = Math.min(nl, it.maxLayers);
    if (nl < 1) continue;
    const fps = []; for (const o of it.os) if (o[2] === dz && !fps.some((f) => f[0] === o[0] && f[1] === o[1])) fps.push([o[0], o[1]]);
    const per = (pr) => Math.ceil(nl / 2) * pr.A.length + Math.floor(nl / 2) * pr.B.length;
    if (!sections) {
      const pr = nl > 1 ? bestPair(cont.L, cont.W, fps, { min, deadline }) : null;
      if (!pr) continue;
      const n = per(pr);
      if (!best || n > best.n || (n === best.n && pr.tie > best.pr.tie)) best = { n, pr, dz, nl, S: cont.L, k: 1 };
    } else {
      const lens = [...new Set(fps.map((f) => f[0]))];
      const cand = new Set();
      const maxS = Math.min(cont.L, Math.max(2500, 3 * Math.max(...lens)));
      for (let i = 0; i * lens[0] <= maxS; i++) for (let j = 0; i * lens[0] + j * (lens[1] || lens[0]) <= maxS; j++) {
        const S = i * lens[0] + j * (lens[1] || 0); if (S > 0) cand.add(S); if (!lens[1]) break;
      }
      // wall lengths that waste the least of the container length first, as many as time allows
      const order = [...cand].sort((p, q) => (cont.L - Math.floor(cont.L / p + 1e-9) * p) - (cont.L - Math.floor(cont.L / q + 1e-9) * q) || p - q).slice(0, 24);
      for (const S of order) {
        if (Date.now() > deadline) break;
        const pr = nl > 1 ? bestPair(S, cont.W, fps, { min, mirror: 'y', alignX: true, poolSize: 150, deadline }) : null;
        if (!pr) continue;
        const k = Math.floor(cont.L / S + 1e-9); const ps = per(pr);
        // boxes in full sections, plus a simple grid estimate for the space in front of them
        const R = cont.L - k * S; let rest = 0;
        for (const f of fps) rest = Math.max(rest, Math.floor(R / f[0]) * Math.floor(cont.W / f[1]) * nl);
        const n = k * ps + rest;
        if (!best || n > best.n || (n === best.n && pr.tie > best.pr.tie)) best = { n, pr, dz, nl, S, k };
      }
    }
  }
  if (!best) return null;
  const { pr, dz, nl, S, k } = best;
  const placed = [];
  for (let s = 0; s < k && placed.length < cap; s++) {
    for (let i = 0; i < nl && placed.length < cap; i++) {
      const layer = (i % 2 ? pr.B : pr.A).slice().sort((a, b) => a.x - b.x || a.y - b.y);
      for (const r of layer) { if (placed.length >= cap) break; placed.push({ k: 0, x: s * S + r.x, y: r.y, z: i * dz, dx: r.dx, dy: r.dy, dz }); }
    }
  }
  const front = sections ? k * S : cont.L;
  if (sections && placed.length < cap && cont.L - front > 0) {
    const used = placed.length * it.weight;
    const rest = pack({ L: cont.L - front, W: cont.W, H: cont.H, maxWeight: cont.maxWeight > 0 ? Math.max(0, cont.maxWeight - used) : 0, doorW: cont.doorW, doorH: cont.doorH },
      [{ ...rawItems[0], qty: cap - placed.length }], { ...opts, timeMs: (opts.timeMs ?? 1500) / 3 });
    for (const p of rest.placed) placed.push({ ...p, k: 0, x: p.x + front });
  }
  const stack = { pattern: 'interlock', perLayer: [pr.A.length, pr.B.length], tie: pr.tie, layers: nl, dz, minSupport: min, section: sections ? S : null, sections: sections ? k : null, full: best.n };
  return { placed, items, cont, steps: null, ...summarize(placed, items), stack };
}

// The plan for the stacking pattern the user chose: opts.stack = 'interlock' or 'column' (default).
// With 'interlock' the column plan is still worked out, so the page can say how many more boxes a
// column stack would take (or that the boxes cannot be interlocked).
export function stackPack(container, rawItems, opts = {}) {
  if (opts.stack !== 'interlock') return opts.pallet ? palletPack(container, rawItems, opts) : pack(container, rawItems, opts);
  const half = { ...opts, timeMs: (opts.timeMs ?? 1500) / 2 }; // time shared between the two plans
  const col = opts.pallet ? palletPack(container, rawItems, half) : pack(container, rawItems, half);
  const il = interlockPack(container, rawItems, { ...half, sections: !opts.pallet });
  if (!il || validate(il).length) return { ...col, stack: { pattern: 'column', interlock: 'none', column: col.totals.n } };
  il.stack.column = col.totals.n;
  if (opts.pallet) {
    const full = Math.min(il.stack.full, il.items[0].weight > 0 && il.cont.maxWeight > 0 ? Math.floor(il.cont.maxWeight / il.items[0].weight + 1e-9) : Infinity);
    const counts = []; let left = full;
    for (let i = 0; i < il.stack.layers && left > 0; i++) { const c = Math.min(left, il.stack.perLayer[i % 2]); counts.push(c); left -= c; }
    const [a, b] = il.stack.perLayer, hi = counts.length, top = counts[hi - 1];
    const body = counts.slice(0, -1).every((c, i) => c === il.stack.perLayer[i % 2]);
    const kind = a === b ? (body && top === a ? 'even' : body ? 'top' : 'uneven') : body && top === il.stack.perLayer[(hi - 1) % 2] ? 'alt' : 'uneven';
    il.pallet = { perPallet: full, layers: { mixed: false, dz: il.stack.dz, counts, ti: a, ti2: b, hi, kind, top }, weightLimited: col.pallet ? col.pallet.weightLimited : false, columnPerPallet: col.pallet ? col.pallet.perPallet : null };
  }
  return il;
}

// Several units of the same size: plan the first, then load whatever is left into the next one, until every
// box is loaded, a unit takes no box (what is left fits in none), or `max` units are planned. Each run is an
// ordinary plan of its own (validate() applies to each). opts.steps apply to the first unit only; the
// others are loaded fully automatically. Returns { runs, left: boxes per input type not loaded }.
export function packMany(container, rawItems, opts = {}, max = 20) {
  const runs = [];
  let left = rawItems.map((it) => Math.max(0, Math.floor(+it.qty || 0)));
  for (let i = 0; i < max && left.some((q) => q > 0); i++) {
    const o = i === 0 ? opts : { ...opts, steps: undefined, fillRest: undefined };
    const res = stackPack(container, rawItems.map((it, k) => ({ ...it, qty: left[k] })), o);
    if (!res.placed.length) break;
    runs.push(res);
    const per = left.map(() => 0);
    for (const p of res.placed) per[res.items[p.k].idx]++;
    left = left.map((q, k) => q - per[k]);
  }
  return { runs, left };
}
