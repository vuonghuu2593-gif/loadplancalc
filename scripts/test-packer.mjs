// Engine tests: hand-checked cases plus random cases checked by the independent validator.
// Usage: node scripts/test-packer.mjs
import { pack, validate, palletPack, layersOf, stackPack, packMany, stackLoads, layeredPallet, layeredPlan } from '../src/scripts/packer.js';
import { makeCtx, placeProblem, spots, nudge, fillAround, onTop, stackFrom, asResult, roomFor } from '../src/scripts/editor.js';
let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('FAIL', msg); } else console.log('ok  ', msg); };
const simple = (C, b) => { // best single-orientation grid, the obvious lower bound
  const d = [b.l, b.w, b.h]; let best = 0;
  for (const p of [[0,1,2],[1,0,2],[0,2,1],[2,0,1],[1,2,0],[2,1,0]]) {
    if (b.rotation === 'upright' && p[2] !== 2) continue;
    best = Math.max(best, Math.floor(C.L / d[p[0]]) * Math.floor(C.W / d[p[1]]) * Math.floor(C.H / d[p[2]]));
  }
  return best;
};
const run = (name, C, items, expect) => {
  const t = Date.now(); const r = pack(C, items); const ms = Date.now() - t;
  const errs = validate(r);
  ok(errs.length === 0, `${name}: valid plan (${errs.join(', ') || 'no errors'}) ${ms} ms`);
  if (expect) expect(r);
  return r;
};

// 1. Cube exact: 2x2x2
run('cubes 500 in 1000^3', { L: 1000, W: 1000, H: 1000 }, [{ l: 500, w: 500, h: 500, qty: 10, weight: 1 }], (r) => ok(r.totals.n === 8, `8 cubes placed (got ${r.totals.n})`));
// 2. Quantity smaller than capacity: all placed
run('qty limit', { L: 1000, W: 1000, H: 1000 }, [{ l: 500, w: 500, h: 500, qty: 3, weight: 1 }], (r) => ok(r.totals.n === 3, `3 placed (got ${r.totals.n})`));
// 3. Weight limit: 10 kg boxes, 45 kg limit -> 4 boxes
run('weight limit', { L: 1000, W: 1000, H: 1000, maxWeight: 45 }, [{ l: 500, w: 500, h: 500, qty: 8, weight: 10 }], (r) => ok(r.totals.n === 4, `4 placed under 45 kg (got ${r.totals.n})`));
// 4. Non-stackable: only one layer
run('non-stackable', { L: 1000, W: 1000, H: 1000 }, [{ l: 500, w: 500, h: 300, qty: 20, weight: 1, stackable: false }], (r) => ok(r.totals.n === 6 && r.placed.every((p) => p.z === 0), `6 on the floor, lying 500x300 (got ${r.totals.n})`));
// 5. Upright: 1000 x 1000 x 600 space, box 400x300x700 upright cannot fit (700 > 600); rotated could
run('upright too tall', { L: 1000, W: 1000, H: 600 }, [{ l: 400, w: 300, h: 700, qty: 5, weight: 1, rotation: 'upright' }], (r) => ok(r.totals.n === 0, `0 placed upright (got ${r.totals.n})`));
run('any rotation fits', { L: 1000, W: 1000, H: 600 }, [{ l: 400, w: 300, h: 700, qty: 5, weight: 1, rotation: 'any' }], (r) => ok(r.totals.n === 5, `5 placed lying down (got ${r.totals.n})`));
// 6. Mixed-orientation gain: 1000 x 700, box 400x300: one orientation gives 2x2=4 (1000/400=2, 700/300=2);
//    mixing gives 5 (2 rows of 400 along x use 800, 200 left; or 3x300=900 along x with 400 across... ) -> must be >= simple
const C6 = { L: 1000, W: 700, H: 100 };
run('2D mix', C6, [{ l: 400, w: 300, h: 100, qty: 99, weight: 1, rotation: 'upright' }], (r) => ok(r.totals.n >= 5, `>= 5 boxes in 1000x700 (got ${r.totals.n}; one orientation gives ${simple(C6, { l: 400, w: 300, h: 100, rotation: 'upright' })})`));
// 7. Real-size case: 40' HC style interior 12032 x 2352 x 2698 mm, carton 600x400x400
const C7 = { L: 12032, W: 2352, H: 2698 };
const b7 = { l: 600, w: 400, h: 400, qty: 5000, weight: 10 };
run('40HC 600x400x400', C7, [b7], (r) => ok(r.totals.n >= simple(C7, b7), `${r.totals.n} cartons >= single orientation ${simple(C7, b7)} (volume bound ${Math.floor(C7.L * C7.W * C7.H / (600 * 400 * 400))})`));
// 8. Odd carton
const b8 = { l: 457, w: 305, h: 254, qty: 5000, weight: 5 };
run('40HC 18x12x10 in', C7, [b8], (r) => ok(r.totals.n >= simple(C7, b8), `${r.totals.n} >= ${simple(C7, b8)} (bound ${Math.floor(C7.L * C7.W * C7.H / (457 * 305 * 254))})`));
// 9. Mixed SKUs
run('mixed SKUs 20ft', { L: 5898, W: 2352, H: 2393, maxWeight: 28000 }, [
  { l: 600, w: 400, h: 400, qty: 200, weight: 12 },
  { l: 1200, w: 800, h: 1000, qty: 6, weight: 300, stackable: false },
  { l: 300, w: 300, h: 250, qty: 500, weight: 4, rotation: 'upright' },
], (r) => console.log('     placed per SKU', r.perItem.join(' / '), 'fill', (r.totals.vol / (5898 * 2352 * 2393) * 100).toFixed(1) + '%'));
// 9b. Door: box 2350 tall fits inside height 2395 but not a 2292 door -> must lie down or be refused
run('door height', { L: 5900, W: 2352, H: 2395, doorW: 2340, doorH: 2292 }, [{ l: 1000, w: 1000, h: 2350, qty: 4, weight: 1, rotation: 'upright' }], (r) => ok(r.totals.n === 0, `upright 2350 box refused by 2292 door (got ${r.totals.n})`));
// 10. Random fuzz: every plan must pass the validator
let bad = 0;
for (let s = 1; s <= 40; s++) {
  let x = s * 7919; const R = () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648);
  const C = { L: 2000 + R() * 10000, W: 1500 + R() * 1000, H: 1500 + R() * 1200, maxWeight: R() < 0.5 ? 5000 + R() * 20000 : 0 };
  if (R() < 0.5) { C.doorW = C.W - 12; C.doorH = C.H - 100; }
  const n = 1 + Math.floor(R() * 4);
  const items = Array.from({ length: n }, () => ({ l: 150 + R() * 900, w: 150 + R() * 700, h: 100 + R() * 800, qty: 1 + Math.floor(R() * 400), weight: R() * 40, rotation: R() < 0.4 ? 'upright' : 'any', stackable: R() > 0.15 }));
  const errs = validate(pack(C, items, { tries: 30 }));
  if (errs.length) { bad++; console.log('fuzz', s, errs); }
}
ok(bad === 0, `40 random cases valid (${bad} bad)`);
// 11. Orientation chosen by the user ("custom"): only the ticked positions may be used.
//   400x300x700 box, only index 2 (width up, length along): 400 along x, 700 across, 300 up.
//   1000 x 1000 x 600 space: floor(1000/400)=2 x floor(1000/700)=1 x floor(600/300)=2 = 4, nothing else fits.
run('custom orientation only #2', { L: 1000, W: 1000, H: 600 }, [{ l: 400, w: 300, h: 700, qty: 50, weight: 1, rotation: 'custom', orients: [2] }],
  (r) => ok(r.totals.n === 4 && r.placed.every((p) => p.dx === 400 && p.dy === 700 && p.dz === 300), `4 boxes, all 400 along / 700 across / 300 up (got ${r.totals.n})`));
//   600x400x400 in 40' HC (12032 x 2350 x 2700), only index 0: 20 x 5 x 6 = 600 (auto mixing gives 660).
const HC = { L: 12032, W: 2350, H: 2700, doorW: 2340, doorH: 2597, maxWeight: 28600 };
run('40HC 600x400x400 fixed orientation', HC, [{ l: 600, w: 400, h: 400, qty: 5000, weight: 10, rotation: 'custom', orients: [0] }],
  (r) => ok(r.totals.n === 600, `600 cartons with one fixed orientation (got ${r.totals.n})`));
//   No orientation ticked -> nothing placed, still a valid plan.
run('custom with nothing ticked', HC, [{ l: 600, w: 400, h: 400, qty: 10, weight: 10, rotation: 'custom', orients: [] }], (r) => ok(r.totals.n === 0, `0 placed (got ${r.totals.n})`));

// 12. Semi-automatic steps
const A = { l: 600, w: 400, h: 400, qty: 400, weight: 12 }, B = { l: 500, w: 300, h: 300, qty: 500, weight: 6, rotation: 'upright' };
const runS = (name, C, items, opts, expect) => {
  const r = pack(C, items, opts); const errs = validate(r);
  ok(errs.length === 0, `${name}: valid plan (${errs.join(', ') || 'no errors'})`);
  expect(r); return r;
};
runS('steps: 100 A fixed, then B in a new section, no auto fill', HC, [A, B],
  { steps: [{ item: 0, qty: 100, orient: 0 }, { item: 1, qty: null, newSection: true }], fillRest: false },
  (r) => {
    const front = Math.max(...r.placed.filter((p) => p.s === 0).map((p) => p.x + p.dx));
    ok(r.steps[0].loaded === 100 && r.placed.filter((p) => p.s === 0).every((p) => p.k === 0 && p.dx === 600 && p.dy === 400 && p.dz === 400), `step 1: 100 A, all 600 along / 400 up (got ${r.steps[0].loaded})`);
    ok(r.steps[1].loaded === 500 && r.placed.filter((p) => p.s === 1).every((p) => p.x >= front - 0.01), `step 2: all 500 B in front of x = ${front} (got ${r.steps[1].loaded})`);
    ok(r.totals.n === 600 && r.perItem[0] === 100, `no auto fill: 300 A stay out (placed ${r.totals.n})`);
  });
runS('steps: 50 B first, rest automatic', HC, [A, B], { steps: [{ item: 1, qty: 50 }] },
  (r) => ok(r.steps.length === 2 && r.steps[0].loaded === 50 && r.totals.n === 900, `50 B then auto: 900 of 900 (got ${r.steps[0].loaded} + ${r.steps[1].loaded})`));
runS('steps: orientation the box may not use', HC, [A, B], { steps: [{ item: 1, qty: 10, orient: 4 }], fillRest: false },
  (r) => ok(r.totals.n === 0, `upright box asked to lie on its length -> 0 (got ${r.totals.n})`));
//   steps must never load more than auto mode can hold in total volume, and gaps left by a step can be used by the next
runS('steps fill gaps behind (no new section)', { L: 1200, W: 800, H: 800 }, [{ l: 600, w: 800, h: 400, qty: 1, weight: 1 }, { l: 600, w: 400, h: 400, qty: 20, weight: 1 }],
  { steps: [{ item: 0, qty: 1, orient: 0 }, { item: 1 }], fillRest: false },
  // 1200x800x800 = 8 slots of 600x400x400; the first box takes 2 of them, 6 remain
  (r) => ok(r.steps[1].loaded === 6, `6 cartons fill around the first box (got ${r.steps[1].loaded})`));
let badS = 0;
for (let s = 1; s <= 30; s++) {
  let x = s * 104729; const R = () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648);
  const C = { L: 2000 + R() * 10000, W: 1500 + R() * 1000, H: 1500 + R() * 1200, maxWeight: R() < 0.5 ? 5000 + R() * 20000 : 0 };
  if (R() < 0.5) { C.doorW = C.W - 12; C.doorH = C.H - 100; }
  const n = 1 + Math.floor(R() * 4);
  const items = Array.from({ length: n }, () => {
    const it = { l: 150 + R() * 900, w: 150 + R() * 700, h: 100 + R() * 800, qty: 1 + Math.floor(R() * 300), weight: R() * 40, stackable: R() > 0.15 };
    const t = R(); it.rotation = t < 0.3 ? 'upright' : t < 0.6 ? 'custom' : 'any';
    if (it.rotation === 'custom') it.orients = [0, 1, 2, 3, 4, 5].filter(() => R() < 0.5);
    return it;
  });
  const steps = Array.from({ length: 1 + Math.floor(R() * 4) }, () => ({ item: Math.floor(R() * n), qty: R() < 0.5 ? null : Math.floor(R() * 120), orient: R() < 0.4 ? Math.floor(R() * 6) : null, newSection: R() < 0.3 }));
  const errs = validate(pack(C, items, { tries: 10, steps, fillRest: R() < 0.6, priority: R() < 0.3 }));
  if (errs.length) { badS++; console.log('fuzz steps', s, errs); }
}
ok(badS === 0, `30 random step plans valid (${badS} bad)`);

// 13. Hand editing
{
  const C = { L: 2000, W: 1000, H: 1000 };
  const its = [{ l: 500, w: 500, h: 500, qty: 20, weight: 1 }, { l: 400, w: 300, h: 200, qty: 5, weight: 1, stackable: false, rotation: 'upright' }];
  const ctx = makeCtx(C, its, [{ k: 0, x: 0, y: 0, z: 0, dx: 500, dy: 500, dz: 500 }, { k: 1, x: 500, y: 0, z: 0, dx: 400, dy: 300, dz: 200 }]);
  ok(placeProblem(ctx, { k: 0, x: 0, y: 500, z: 0, dx: 500, dy: 500, dz: 500 }) === '', 'free spot beside a box is accepted');
  ok(/hit another box/.test(placeProblem(ctx, { k: 0, x: 250, y: 0, z: 0, dx: 500, dy: 500, dz: 500 })), 'overlap refused');
  ok(/not stand fully/.test(placeProblem(ctx, { k: 0, x: 250, y: 0, z: 500, dx: 500, dy: 500, dz: 500 })), 'half-supported box refused');
  ok(/must not carry/.test(placeProblem(ctx, { k: 1, x: 500, y: 0, z: 200, dx: 400, dy: 300, dz: 200 })), 'box on a non-stackable box refused');
  ok(/turned that way/.test(placeProblem(ctx, { k: 1, x: 1000, y: 0, z: 0, dx: 400, dy: 200, dz: 300 })), 'upright box tipped refused');
  ok(/stick out/.test(placeProblem(ctx, { k: 0, x: 1600, y: 0, z: 0, dx: 500, dy: 500, dz: 500 })), 'outside refused');
  ok(placeProblem(ctx, { k: 0, x: 0, y: 0, z: 500, dx: 500, dy: 500, dz: 500 }) === '', 'box on top of a stackable box accepted');
  const ctxD = makeCtx({ L: 3000, W: 2352, H: 2395, doorW: 2340, doorH: 2292 }, [{ l: 1000, w: 1000, h: 2350, qty: 1, weight: 1 }], []);
  ok(/door/.test(placeProblem(ctxD, { k: 0, x: 0, y: 0, z: 0, dx: 1000, dy: 1000, dz: 2350 })), 'box taller than the door refused');
  const sp = spots(ctx, 0, null);
  ok(sp.length > 0 && sp.every((b) => placeProblem(ctx, b) === '') && sp[0].x === 0, `${sp.length} free spots, all valid, first at the back wall`);
  const sp1 = spots(ctx, 1, 1);
  ok(sp1.length > 0 && sp1.every((b) => b.dx === 300 && b.dy === 400 && b.dz === 200), 'fixed position: every spot uses it');
  // nudge: lone box at x = 600 slides back to the wall, then is stopped by a neighbour
  const c2 = makeCtx(C, its, [{ k: 0, x: 600, y: 0, z: 0, dx: 500, dy: 500, dz: 500 }, { k: 0, x: 1500, y: 0, z: 0, dx: 500, dy: 500, dz: 500 }]);
  ok(nudge(c2, 0, 0, -1)?.x === 0, 'nudge back: slides to the back wall');
  ok(nudge(c2, 0, 0, 1)?.x === 1000, 'nudge toward the door: stops against the next box (x = 1000)');
  ok(nudge(c2, 0, 1, 1)?.y === 500, 'nudge across: snaps to the far wall');
  ok(nudge(c2, 0, 2, 1) === null, 'nudge up with nothing below to stand on: refused');
  const c3 = makeCtx(C, its, [{ k: 0, x: 0, y: 0, z: 0, dx: 500, dy: 500, dz: 500 }, { k: 0, x: 0, y: 0, z: 500, dx: 500, dy: 500, dz: 500 }]);
  ok(onTop(c3, 0).length === 1 && stackFrom(c3, 0).length === 2, 'stack above a box is found');
  ok(validate(asResult(c3)).length === 0, 'edited plan validates');
}
// fill around kept boxes
{
  const r = fillAround({ L: 1000, W: 1000, H: 1000 }, [{ l: 500, w: 500, h: 500, qty: 10, weight: 1 }], []);
  ok(validate(r).length === 0 && r.totals.n === 8, `fill from empty: 8 cubes (got ${r.totals.n})`);
  const r2 = fillAround({ L: 1000, W: 1000, H: 1000 }, [{ l: 500, w: 500, h: 500, qty: 10, weight: 1 }], [{ k: 0, x: 500, y: 500, z: 0, dx: 500, dy: 500, dz: 500 }]);
  ok(validate(r2).length === 0 && r2.totals.n === 8, `fill around one cube in the far corner: 8 (got ${r2.totals.n})`);
  // 40' HC, 660 plan: take out 40 boxes from the middle, fill again -> back to 660
  const it = [{ l: 600, w: 400, h: 400, qty: 5000, weight: 10 }];
  const full = pack(HC, it);
  const kept = full.placed.filter((p, i) => !(p.x > 4000 && p.x < 7000 && i % 3 === 0));
  const r3 = fillAround(HC, it, kept.map((p) => ({ ...p, k: 0 })));
  ok(validate(r3).length === 0 && r3.totals.n >= 660, `removed ${full.placed.length - kept.length} of 660 from the middle, fill again: ${r3.totals.n} (>= 660)`);
  // the defaults of the page: keep the first 100 boxes, fill the rest
  const its2 = [A, B];
  const auto = pack(HC, its2);
  const r4 = fillAround(HC, its2, auto.placed.slice(0, 100));
  ok(validate(r4).length === 0 && r4.totals.n === 900, `defaults: keep 100, fill the rest -> 900 of 900 (got ${r4.totals.n})`);
  const r5 = fillAround({ ...HC, maxWeight: 2000 }, its2, []);
  ok(validate(r5).length === 0 && r5.totals.w <= 2000, `weight limit respected when filling (${r5.totals.w} kg)`);
}
let badF = 0;
for (let s = 1; s <= 25; s++) {
  let x = s * 15485863; const R = () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648);
  const C = { L: 2000 + R() * 10000, W: 1500 + R() * 1000, H: 1500 + R() * 1200, maxWeight: R() < 0.5 ? 5000 + R() * 20000 : 0 };
  if (R() < 0.5) { C.doorW = C.W - 12; C.doorH = C.H - 100; }
  const n = 1 + Math.floor(R() * 4);
  const items = Array.from({ length: n }, () => ({ l: 150 + R() * 900, w: 150 + R() * 700, h: 100 + R() * 800, qty: 1 + Math.floor(R() * 300), weight: R() * 40, rotation: R() < 0.4 ? 'upright' : 'any', stackable: R() > 0.15 }));
  const base = pack(C, items, { tries: 10 });
  // keep a random subset that still stands (drop a box only together with everything above it)
  const ctx = makeCtx(C, items, base.placed.map((p) => ({ ...p, k: base.items[p.k].idx })));
  const drop = new Set();
  ctx.boxes.forEach((_, i) => { if (R() < 0.3) for (const j of stackFrom(ctx, i)) drop.add(j); });
  const kept = ctx.boxes.filter((_, i) => !drop.has(i));
  const r = fillAround(C, items, kept, { tries: 10 });
  const errs = validate(r);
  if (errs.length || r.totals.n < kept.length) { badF++; console.log('fuzz fill', s, errs, r.totals.n, kept.length); }
}
ok(badF === 0, `25 random "remove some, fill again" plans valid (${badF} bad)`);

// 14. Room for more (space left after a plan)
{
  const C = { L: 1000, W: 1000, H: 1000 }, cube = [{ l: 500, w: 500, h: 500, qty: 3, weight: 1 }];
  const plan = pack(C, cube).placed.map((p) => ({ ...p, k: 0 }));
  const r = roomFor(C, cube, plan, 0);
  ok(validate(r.result).length === 0 && r.more === 5 && r.limit === 'space', `3 cubes of 500 in a 1 m cube: room for 5 more (got ${r.more}, ${r.limit})`);
  const rw = roomFor({ ...C, maxWeight: 5 }, cube, plan, 0);
  ok(rw.more === 2 && rw.limit === 'payload', `same with a 5 kg payload and 1 kg cubes: 2 more, limited by payload (got ${rw.more}, ${rw.limit})`);
  // 40' HC, 100 cartons of 600x400x400 loaded: room for more must be at least what the empty space in front of
  // them holds on its own (the 100 fill the back 2,000 mm completely, so 100 + more <= 660)
  const it = [{ l: 600, w: 400, h: 400, qty: 100, weight: 10 }];
  const p100 = pack(HC, it).placed.map((p) => ({ ...p, k: 0 }));
  const front = Math.max(...p100.map((p) => p.x + p.dx));
  const alone = pack({ ...HC, L: HC.L - front }, [{ ...it[0], qty: 20000 }]).totals.n;
  const r2 = roomFor(HC, it, p100, 0);
  ok(validate(r2.result).length === 0 && r2.more >= alone && 100 + r2.more <= 660, `40' HC with 100 cartons: room for ${r2.more} more (>= ${alone} in the clear ${HC.L - front} mm, total <= 660)`);
  // the page defaults: everything loaded, room left for each type is valid and non-negative
  const its2 = [A, B]; const auto0 = pack(HC, its2); const auto = auto0.placed.map((p) => ({ ...p, k: auto0.items[p.k].idx }));
  const ra = roomFor(HC, its2, auto, 0), rb = roomFor(HC, its2, auto, 1);
  ok(validate(ra.result).length === 0 && validate(rb.result).length === 0 && ra.more > 0 && rb.more > 0, `defaults (900 loaded): room for ${ra.more} more A or ${rb.more} more B`);
}
// 15. Pallet mode (palletPack + layersOf): hand-checked Ti-Hi cases and random pallets
{
  const IN = 25.4, LB = 0.45359237;
  // Euro pallet 1200 x 800, 144 mm high, 1800 mm limit -> 1656 mm above the deck. 400x300x250 upright:
  // 1200/300 = 4 along x 800/400 = 2 across = 8 per layer; floor(1656/250) = 6 layers -> 48; 48 x 12 = 576 kg <= 1500
  const eu = { L: 1200, W: 800, H: 1800 - 144, maxWeight: 1500 };
  const ctn = { l: 400, w: 300, h: 250, weight: 12, rotation: 'upright' };
  const r1 = palletPack(eu, [{ ...ctn, qty: 100 }]); const l1 = r1.pallet.layers;
  ok(validate(r1).length === 0 && r1.totals.n === 48 && r1.pallet.perPallet === 48 && l1.kind === 'even' && l1.ti === 8 && l1.hi === 6, `Euro pallet 400x300x250 x100: 48 = 8 x 6 (got ${r1.totals.n} = ${l1.ti} x ${l1.hi}, ${l1.kind})`);
  // fewer than a full pallet: built layer by layer (8 + 8 + 4), full-pallet count still 48
  const r2 = palletPack(eu, [{ ...ctn, qty: 20 }]); const c2 = layersOf(r2.placed).counts.join();
  ok(validate(r2).length === 0 && r2.totals.n === 20 && c2 === '8,8,4' && r2.pallet.perPallet === 48, `20 cartons: layers 8,8,4 and 48 per full pallet (got ${c2}, ${r2.pallet.perPallet})`);
  // 48 x 40 in, 141 mm high, 60 in limit -> 1383 mm; 12x10x8 in: 4 x 4 = 16 per layer, floor(1383/203.2) = 6 layers = 96,
  // but 2800 lb / 30 lb = 93.3 -> 93 = 16 x 5 + 13
  const us = { L: 48 * IN, W: 40 * IN, H: 60 * IN - 141, maxWeight: 2800 * LB };
  const r3 = palletPack(us, [{ l: 12 * IN, w: 10 * IN, h: 8 * IN, weight: 30 * LB, qty: 200, rotation: 'upright' }]); const l3 = r3.pallet.layers;
  ok(validate(r3).length === 0 && r3.totals.n === 93 && l3.kind === 'top' && l3.ti === 16 && l3.hi === 6 && l3.top === 13 && r3.pallet.weightLimited, `48x40 in, 12x10x8 in at 30 lb, 60 in: 93 = 16 x 5 + 13 (got ${r3.totals.n}, ${l3.ti} x ${l3.hi - 1} + ${l3.top})`);
  // same at 20 lb: 96 = 16 x 6, not weight limited
  const r4 = palletPack(us, [{ l: 12 * IN, w: 10 * IN, h: 8 * IN, weight: 20 * LB, qty: 200, rotation: 'upright' }]);
  ok(validate(r4).length === 0 && r4.totals.n === 96 && r4.pallet.layers.kind === 'even' && !r4.pallet.weightLimited, `same at 20 lb: 96 = 16 x 6 (got ${r4.totals.n})`);
  // any orientation: no single Ti-Hi, never fewer than upright
  const r5 = palletPack(eu, [{ ...ctn, rotation: 'any', qty: 100 }]);
  ok(validate(r5).length === 0 && r5.totals.n >= 48, `any orientation: ${r5.totals.n} >= 48, layers ${r5.pallet.layers.mixed ? 'mixed' : r5.pallet.layers.kind}`);
  // overhang 25 mm per side (1250 x 850): still 8 per layer (area bound 8.85)
  const r6 = palletPack({ ...eu, L: 1250, W: 850 }, [{ ...ctn, qty: 100 }]);
  ok(validate(r6).length === 0 && r6.totals.n === 48, `25 mm overhang: 48 (got ${r6.totals.n})`);
  // layersOf rejects boxes off a layer line
  ok(layersOf([{ z: 0, dz: 100 }, { z: 50, dz: 100 }]).mixed === true && layersOf([{ z: 0, dz: 100 }, { z: 0, dz: 200 }]).mixed === true, 'layersOf: off-line or mixed heights give no Ti-Hi');
  // random pallets: every plan valid, never fewer boxes than the ordinary plan
  let badP = 0;
  for (let s = 1; s <= 20; s++) {
    let x = s * 104729; const R = () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648);
    const C = { L: 600 + R() * 700, W: 500 + R() * 600, H: 400 + R() * 1600, maxWeight: R() < 0.6 ? 200 + R() * 1300 : 0 };
    const it = { l: 100 + R() * 500, w: 100 + R() * 400, h: 80 + R() * 400, weight: R() * 30, qty: 1 + Math.floor(R() * 150), rotation: R() < 0.6 ? 'upright' : 'any', stackable: R() > 0.1 };
    const r = palletPack(C, [it], { timeMs: 300 }); const e = validate(r); const plain = pack(C, [it], { timeMs: 300 }).totals.n;
    if (e.length || r.totals.n < plain || r.pallet.perPallet < r.totals.n) { badP++; console.log('pallet fuzz', s, e, r.totals.n, plain, r.pallet.perPallet); }
  }
  ok(badP === 0, `20 random pallets valid and not below the ordinary plan (${badP} bad)`);
}
// Pallets in containers (/how-many-pallets-fit-in-a-container/): hand-checked lane counts, Hapag-Lloyd inside sizes.
// Euro 1200 x 800 in 40' DV (12032 x 2352): 15 crosswise (15 x 800) + 10 lengthwise (10 x 1200), 1200 + 800 = 2000 wide;
// 20' (5900): 7 + 4 = 11; 45' (13556): 16 + 11 = 27. 48 x 40 in (1219.2 x 1016) in 40' HC (12032 x 2350): 11 + 9 = 20,
// two high at 50 in (2 x 1270 = 2540 <= 2700) = 40, but 2540 > 2395 in a 40' DV -> 20. Door 2292 mm: a 2300 mm pallet stays out.
{
  const IN = 25.4, eur = { l: 1200, w: 800, h: 1100, weight: 0, qty: 500, rotation: 'upright', stackable: false };
  const dv40 = { L: 12032, W: 2352, H: 2395, doorW: 2340, doorH: 2292 }, dv20 = { ...dv40, L: 5900 }, hc45 = { L: 13556, W: 2352, H: 2700, doorW: 2340, doorH: 2597 }, hc40 = { L: 12032, W: 2350, H: 2700, doorW: 2340, doorH: 2597 };
  for (const [nm, C, it, want] of [
    ["Euro pallets one high, 40' DV", dv40, eur, 25], ["Euro pallets one high, 20' DV", dv20, eur, 11], ["Euro pallets one high, 45' HC", hc45, eur, 27],
    ["Euro pallets two high (1100 mm), 40' DV", dv40, { ...eur, stackable: true }, 50],
    ["48 x 40 in one high, 40' HC", hc40, { ...eur, l: 48 * IN, w: 40 * IN }, 20],
    ["48 x 40 in two high at 50 in, 40' HC", hc40, { ...eur, l: 48 * IN, w: 40 * IN, h: 50 * IN, stackable: true }, 40],
    ["48 x 40 in at 50 in, 40' DV: no room for two high", dv40, { ...eur, l: 48 * IN, w: 40 * IN, h: 50 * IN, stackable: true }, 20],
    ["EPAL 6 800 x 600, 20' DV: 9 + 9 + 7", dv20, { ...eur, l: 800, w: 600 }, 25],
    ['loaded pallet 2300 mm high: taller than the 2292 mm door', dv40, { ...eur, h: 2300 }, 0],
  ]) run(nm, C, [it], (r) => ok(r.totals.n === want, `${want} pallets (got ${r.totals.n})`));
  // payload: 25 Euro pallets possible, 28,750 kg / 1,200 kg = 23.96 -> 23
  run("Euro pallets 1200 kg each, 40' DV payload 28,750 kg", { ...dv40, maxWeight: 28750 }, [{ ...eur, weight: 1200 }], (r) => ok(r.totals.n === 23, `23 pallets (got ${r.totals.n})`));
}
// Pallets in a 53' trailer (/how-many-pallets-fit-in-a-53-foot-trailer/): Hyundai Translead interiors, 630 in long, 110 in high,
// 101.5 in (Composite) and 98.5 in (Original) wide; no door, no payload. 48 x 40 in: 48 in side across, two side by side
// (96 in), 15 rows of 40 in (600 of 630 in) = 30; 48 in side along only: 13 rows (624 in) x 2 = 26; two high at 50 in
// (100 <= 110 in) = 60. Euro 1200 x 800: two crosswise (2400 mm of 2578.1), 20 rows of 800 (16,000 of 16,002 mm) = 40;
// 1200 x 805: 13 rows of three lengthwise (3 x 805 = 2415 mm, 13 x 1200 = 15,600 mm) = 39.
{
  const IN = 25.4, comp = { L: 630 * IN, W: 101.5 * IN, H: 110 * IN }, orig = { ...comp, W: 98.5 * IN };
  const p48 = { l: 48 * IN, w: 40 * IN, h: 50 * IN, weight: 0, qty: 500, rotation: 'upright', stackable: false };
  const eur = { ...p48, l: 1200, w: 800 };
  for (const [nm, C, it, want] of [
    ["48 x 40 in one high, 53' Composite", comp, p48, 30], ["48 x 40 in one high, 53' Original (98.5 in)", orig, p48, 30],
    ["48 x 40 in, 48 in side along only, 53' Composite", comp, { ...p48, rotation: 'custom', orients: [0] }, 26],
    ["48 x 40 in two high at 50 in, 53' Composite", comp, { ...p48, stackable: true }, 60],
    ["Euro pallets one high, 53' Composite", comp, eur, 40], ["Euro pallets one high, 53' Original", orig, eur, 40],
    ["Euro 1200 x 805 one high, 53' Composite", comp, { ...eur, w: 805 }, 39],
  ]) run(nm, C, [it], (r) => ok(r.totals.n === want, `${want} pallets (got ${r.totals.n})`));
}
// Rental box trucks (/box-truck-dimensions/, box-trucks.json): inside sizes as U-Haul and Penske print them, U-Haul's door opening.
// U-Haul 26' 314 x 97 x 99 in, door 93 x 82 in: 48 x 40 in with the 48 in side across, two side by side (96 <= 97 in),
// 7 rows of 40 in (280 <= 314; 8 rows = 320) = 14. Euro in 7975.6 x 2463.8 mm: 8 rows of two crosswise (6400 mm) + 1 row of
// three lengthwise (1200 mm; 3 x 800 = 2400 <= 2463.8) = 19 (9 rows of two = 18). U-Haul 15' 180 x 92 in (96 > 92): one lane
// 48 in wide with 4 x 40 = 160 in + one lane 40 in wide with 3 x 48 = 144 in (48 + 40 = 88 <= 92) = 7. Penske 12' 144 x 78 in
// (78 < 80: one lane) 3 x 48 = 144 -> 3. 600 x 400 x 400 mm in the U-Haul 26': 13 x 6 x 6 = 468 (all pass the 2362.2 x 2082.8 door).
// Max load 12,859 lb with 1,000 lb pallets: 12 (13 x 1,000 lb = 13,000 lb is over).
{
  const IN = 25.4, LB = 0.45359237;
  const u26 = { L: 314 * IN, W: 97 * IN, H: 99 * IN, doorW: 93 * IN, doorH: 82 * IN }, u15 = { L: 180 * IN, W: 92 * IN, H: 86 * IN, doorW: 87 * IN, doorH: 77 * IN };
  const p12 = { L: 144 * IN, W: 78 * IN, H: 73 * IN };
  const p48 = { l: 48 * IN, w: 40 * IN, h: 50 * IN, weight: 0, qty: 500, rotation: 'upright', stackable: false };
  for (const [nm, C, it, want] of [
    ["48 x 40 in one high, U-Haul 26' truck", u26, p48, 14], ["Euro pallets one high, U-Haul 26' truck", u26, { ...p48, l: 1200, w: 800 }, 19],
    ["48 x 40 in one high, U-Haul 15' truck (92 in wide)", u15, p48, 7], ["48 x 40 in one high, Penske 12' truck (78 in wide)", p12, p48, 3],
    ["600 x 400 x 400 mm cartons, U-Haul 26' truck with door", u26, { l: 600, w: 400, h: 400, weight: 0, qty: 5000, rotation: 'any', stackable: true }, 468],
    ["48 x 40 in at 1,000 lb, U-Haul 26' max load 12,859 lb", { ...u26, maxWeight: 12859 * LB }, { ...p48, weight: 1000 * LB }, 12],
  ]) run(nm, C, [it], (r) => ok(r.totals.n === want, `${want} (got ${r.totals.n})`));
}

// Interlocked layers (stackPack with stack: 'interlock'). Independent count of tied boxes: a box above the
// first layer that rests on two or more boxes below, each under at least 10% of its base.
{
  const tiedShare = (placed) => {
    let up = 0, tied = 0;
    for (const a of placed) {
      if (a.z < 0.01) continue; up++;
      let m = 0;
      for (const b of placed) {
        if (Math.abs(b.z + b.dz - a.z) > 0.01) continue;
        const ox = Math.min(a.x + a.dx, b.x + b.dx) - Math.max(a.x, b.x), oy = Math.min(a.y + a.dy, b.y + b.dy) - Math.max(a.y, b.y);
        if (ox > 0 && oy > 0 && ox * oy >= 0.1 * a.dx * a.dy) m++;
      }
      if (m >= 2) tied++;
    }
    return up ? tied / up : 0;
  };
  const runI = (name, C, it, opts, expect) => {
    const r = stackPack(C, [it], { stack: 'interlock', timeMs: 1200, ...opts });
    const errs = validate(r);
    ok(errs.length === 0, `${name}: valid plan (${errs.join(', ') || 'no errors'})`);
    if (expect) expect(r);
    return r;
  };
  const euro = { L: 1200, W: 800, H: 1500, maxWeight: 1500 };
  // 400 x 300 carton on a Euro pallet, 6 layers of 250 mm. Full support: one row of three cartons 400 along x 300 across
  // (1200 x 300) and one row of four 300 along x 400 across (1200 x 400) = 7 per layer in 700 of the 800 mm, mirrored
  // every other layer, so each 400 mm carton bridges two 300 mm cartons below: 6 x 7 = 42 (column stacks: 4 x 2 = 8 x 6 = 48).
  const c4 = { l: 400, w: 300, h: 250, weight: 12, qty: 500, rotation: 'upright' };
  runI('Euro 400x300, 100% support', euro, c4, { pallet: true }, (r) => {
    ok(r.stack.pattern === 'interlock' && r.totals.n === 42 && r.stack.perLayer.join() === '7,7', `42 = 7 + 7 alternating, 6 layers (got ${r.totals.n}, ${r.stack.perLayer})`);
    ok(r.stack.column === 48, `column stacks would load 48 (got ${r.stack.column})`);
    ok(tiedShare(r.placed) === 1, `every carton above the first layer bridges two below (got ${tiedShare(r.placed)})`);
  });
  // 80% support: the full 8-carton grid alternates with the 7-carton layer (centred, 50 mm in from each long edge).
  // Grid on the 7-layer: a 400 mm deep carton has 350 mm on cartons below = 87.5% >= 80%, centre over a carton: 3 x 8 + 3 x 7 = 45.
  runI('Euro 400x300, 80% support', { ...euro, minSupport: 0.8 }, c4, { pallet: true }, (r) => {
    ok(r.stack.pattern === 'interlock' && r.totals.n === 45 && r.stack.perLayer.join() === '8,7', `45 = 8 + 7 alternating (got ${r.totals.n}, ${r.stack.perLayer})`);
    ok(r.pallet.perPallet === 45 && r.pallet.layers.kind === 'alt', `pallet: 45 per pallet, alternating layers (got ${r.pallet.perPallet}, ${r.pallet.layers.kind})`);
  });
  // 300 x 200 x 200 on a Euro pallet, 1000 mm: 16 per layer either way (4 x 4 of 300 x 200 = 1200 x 800), 5 layers = 80;
  // interlocking loses nothing.
  runI('Euro 300x200, 5 layers', { ...euro, H: 1000 }, { l: 300, w: 200, h: 200, weight: 5, qty: 500, rotation: 'upright' }, { pallet: true },
    (r) => ok(r.stack.pattern === 'interlock' && r.totals.n === 80 && r.stack.column === 80 && tiedShare(r.placed) > 0.5, `80 interlocked = 80 in columns, ${Math.round(tiedShare(r.placed) * 100)}% tied (got ${r.totals.n})`));
  // quantity and weight: 30 cartons -> 4 full layers of 7 + 2 on the fifth; 12 kg cartons, 300 kg limit -> 25
  runI('Euro 400x300, qty 30', euro, { ...c4, qty: 30 }, { pallet: true }, (r) => ok(r.totals.n === 30, `30 placed (got ${r.totals.n})`));
  runI('Euro 400x300, 300 kg', { ...euro, maxWeight: 300 }, c4, { pallet: true }, (r) => ok(r.totals.n === 25 && r.pallet.perPallet === 25, `25 placed under 300 kg (got ${r.totals.n})`));
  // 40' HC 12032 x 2352 x 2698, 600 x 400 x 400: walls 1200 mm long, one column of 600-along cartons (2) and three of
  // 400-along cartons (3 each) = 11 per layer in 2200 mm of width, mirrored across every other layer; 10 walls
  // (12,000 mm) x 6 layers (2,400 mm) = 660, the same as column stacks.
  runI("40' HC 600x400x400 in walls", { L: 12032, W: 2352, H: 2698, doorW: 2340, doorH: 2585, maxWeight: 28600 }, { l: 600, w: 400, h: 400, weight: 10, qty: 5000 }, {},
    (r) => ok(r.totals.n === 660 && r.stack.section === 1200 && r.stack.sections === 10 && r.stack.perLayer.join() === '11,11', `660 in 10 walls of 1200 mm, 11 per layer (got ${r.totals.n}, ${r.stack.section}, ${r.stack.perLayer})`));
  // mixed box types: no interlocked plan, column stacks with a note
  { const r = stackPack({ L: 5898, W: 2352, H: 2393 }, [{ l: 600, w: 400, h: 400, qty: 50, weight: 1 }, { l: 500, w: 300, h: 300, qty: 50, weight: 1 }], { stack: 'interlock', timeMs: 600 });
    ok(!r.stack || r.stack.pattern !== 'interlock', 'two box types: no interlocked plan'); }
  // the checker refuses boxes that bridge too much: a 400 mm box on one 300 mm box (75%) with an 80% rule; its centre
  // over a gap; and any bridging at all under the default full-support rule
  const base = (ms) => ({ items: [{ l: 400, w: 300, h: 100, qty: 9, weight: 1, rotation: 'any', stackable: true }], cont: { L: 1000, W: 1000, H: 1000, minSupport: ms } });
  const two = [{ k: 0, x: 0, y: 0, z: 0, dx: 300, dy: 400, dz: 100 }, { k: 0, x: 350, y: 0, z: 0, dx: 300, dy: 400, dz: 100 }];
  ok(validate({ ...base(0.8), placed: [two[0], { k: 0, x: 0, y: 0, z: 100, dx: 400, dy: 300, dz: 100 }] }).includes('box not supported enough'), 'checker: 75% support refused under an 80% rule');
  ok(validate({ ...base(0.7), placed: [...two, { k: 0, x: 125, y: 0, z: 100, dx: 400, dy: 300, dz: 100 }] }).includes('box centre not over a box below'), 'checker: centre over the 50 mm gap refused (87.5% supported)');
  ok(validate({ ...base(0.7), placed: [...two, { k: 0, x: 100, y: 0, z: 100, dx: 400, dy: 300, dz: 100 }] }).length === 0, 'checker: 75% support, centre over a box, accepted under a 70% rule');
  ok(validate({ ...base(1), placed: [...two, { k: 0, x: 100, y: 0, z: 100, dx: 400, dy: 300, dz: 100 }] }).includes('box not fully supported'), 'checker: bridging refused under full support');
  // random single-type cases, pallets and containers, every support rule: every plan must pass the checker
  let badI = 0, found = 0;
  for (let s = 1; s <= 40; s++) {
    let x = s * 104729; const R = () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648);
    const pallet = R() < 0.5;
    const C = pallet ? { L: 800 + R() * 600, W: 600 + R() * 600, H: 600 + R() * 1400, maxWeight: R() < 0.5 ? 300 + R() * 1000 : 0 }
      : { L: 2000 + R() * 10000, W: 2200 + R() * 300, H: 2200 + R() * 500, maxWeight: R() < 0.5 ? 5000 + R() * 20000 : 0, doorW: 2290, doorH: 2250 };
    C.minSupport = [1, 0.9, 0.8, 0.7][Math.floor(R() * 4)];
    const it = { l: 150 + R() * 500, w: 120 + R() * 400, h: 100 + R() * 400, weight: R() * 20, qty: 1 + Math.floor(R() * 2000), rotation: R() < 0.6 ? 'upright' : 'any', stackable: R() > 0.1 };
    const r = stackPack(C, [it], { stack: 'interlock', pallet, timeMs: 400, tries: 20 });
    const errs = validate(r);
    if (r.stack && r.stack.pattern === 'interlock') found++;
    if (errs.length || r.totals.n > it.qty) { badI++; console.log('interlock fuzz', s, errs); }
  }
  ok(badI === 0, `40 random interlock cases valid (${badI} bad, ${found} interlocked)`);
}
// Several units of the same size (packMany)
{
  // hand-checked: 5 x 2 x 2 m space, 1 m cubes: 5 x 2 x 2 = 20 per unit; 100 cubes -> 5 units of 20
  let r = packMany({ L: 5000, W: 2000, H: 2000 }, [{ l: 1000, w: 1000, h: 1000, qty: 100 }], { timeMs: 200 });
  ok(r.runs.length === 5 && r.runs.every((x) => x.totals.n === 20 && !validate(x).length) && r.left[0] === 0, 'packMany: 100 cubes of 1 m in a 5 x 2 x 2 m space -> 5 units of 20 (' + r.runs.map((x) => x.totals.n).join('+') + ')');
  // weight: 1,000 kg payload, 30 kg boxes -> 33 per unit (33 x 30 = 990); 100 boxes -> 33 + 33 + 33 + 1
  r = packMany({ L: 5000, W: 2000, H: 2000, maxWeight: 1000 }, [{ l: 500, w: 500, h: 500, weight: 30, qty: 100 }], { timeMs: 200 });
  ok(r.runs.map((x) => x.totals.n).join('+') === '33+33+33+1' && r.runs.every((x) => !validate(x).length), 'packMany: payload 1,000 kg / 30 kg = 33 per unit -> 33+33+33+1 (' + r.runs.map((x) => x.totals.n).join('+') + ')');
  // a box that fits in no unit stays left; the others are loaded
  r = packMany({ L: 5000, W: 2000, H: 2000 }, [{ l: 1000, w: 1000, h: 1000, qty: 30 }, { l: 6000, w: 100, h: 100, qty: 3 }], { timeMs: 200 });
  ok(r.runs.map((x) => x.totals.n).join('+') === '20+10' && r.left.join() === '0,3', 'packMany: a 6 m box in a 5 m space stays left (' + r.left.join() + ')');
  // the cap
  r = packMany({ L: 5000, W: 2000, H: 2000 }, [{ l: 1000, w: 1000, h: 1000, qty: 1000 }], { timeMs: 50 }, 3);
  ok(r.runs.length === 3 && r.left[0] === 940, 'packMany: stops at the cap (3 units, 940 left)');
  // random: every unit passes the check and the counts add up
  let bad = 0;
  for (let s = 1; s <= 12; s++) {
    let x = s * 7919; const R = () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648);
    const C = { L: 2000 + R() * 6000, W: 1500 + R() * 900, H: 1500 + R() * 1000, maxWeight: R() < 0.5 ? 2000 + R() * 8000 : 0, doorW: 0, doorH: 0 };
    const items = [0, 1].map(() => ({ l: 200 + R() * 600, w: 200 + R() * 500, h: 150 + R() * 500, weight: R() * 40, qty: 50 + Math.floor(R() * 600), rotation: R() < 0.5 ? 'upright' : 'any', stackable: R() > 0.1 }));
    const m = packMany(C, items, { timeMs: 60, stack: R() < 0.5 ? 'interlock' : 'column' });
    const per = items.map(() => 0);
    for (const run of m.runs) { if (validate(run).length) bad++; for (const p of run.placed) per[run.items[p.k].idx]++; }
    if (items.some((it, k) => per[k] + m.left[k] !== it.qty)) { bad++; console.log('packMany count', s, per, m.left); }
  }
  ok(bad === 0, `packMany: 12 random loads, every unit valid and counts add up (${bad} bad)`);
}
// Stacking limits per box type: max boxes on top (maxOnTop) and max weight on top (maxLoad, kg)
{
  const C = { L: 2000, W: 1000, H: 4000 };
  const cube = (o) => ({ l: 1000, w: 1000, h: 1000, weight: 10, qty: 8, rotation: 'upright', ...o });
  // hand-checked: 2 columns on a 2 x 1 m floor; at most 1 box on top -> 2 high -> 4 boxes
  let r = pack(C, [cube({ maxOnTop: 1 })], { timeMs: 200 });
  ok(r.totals.n === 4 && !validate(r).length, 'max 1 box on top: 2 columns x 2 high = 4 (' + r.totals.n + ')');
  // 10 kg boxes, at most 25 kg on top: 2 on top (20 kg) -> 3 high -> 6
  r = pack(C, [cube({ maxLoad: 25 })], { timeMs: 200 });
  ok(r.totals.n === 6 && !validate(r).length, 'max 25 kg on 10 kg boxes: 3 high x 2 = 6 (' + r.totals.n + ')');
  // without limits: 4 high x 2 = 8
  ok(pack(C, [cube({})], { timeMs: 200 }).totals.n === 8, 'no limit: 8');
  // one column 1 x 1 x 4 m: two 50 kg boxes (no limit) and two 5 kg boxes that take at most 10 kg:
  // the light ones must go on top (A, A, B, B; the lower B carries 5 kg) -> all 4
  r = pack({ L: 1000, W: 1000, H: 4000 }, [cube({ weight: 50, qty: 2 }), cube({ weight: 5, qty: 2, maxLoad: 10 })], { timeMs: 300 });
  const top2 = r.placed.slice().sort((a, b) => b.z - a.z).slice(0, 2).every((p) => r.items[p.k].weight === 5);
  ok(r.totals.n === 4 && top2 && !validate(r).length, 'heavy boxes below, light boxes (max 10 kg on top) above: all 4 (' + r.totals.n + ')');
  // the checker: a 20 kg box of 2 x 1 m on two 1 x 1 m boxes rests half on each -> 10 kg each
  const items = [{ l: 1000, w: 1000, h: 1000, weight: 10, qty: 2, maxLoad: 10, stackable: true, idx: 0 }, { l: 2000, w: 1000, h: 500, weight: 20, qty: 1, stackable: true, idx: 1 }];
  const placed = [{ k: 0, x: 0, y: 0, z: 0, dx: 1000, dy: 1000, dz: 1000 }, { k: 0, x: 1000, y: 0, z: 0, dx: 1000, dy: 1000, dz: 1000 }, { k: 1, x: 0, y: 0, z: 1000, dx: 2000, dy: 1000, dz: 500 }];
  const L = stackLoads(placed, items);
  ok(L.load[0] === 10 && L.load[1] === 10 && L.above[0] === 1, 'shared by contact area: 20 kg on two boxes = 10 kg each');
  const res = (its) => ({ placed, items: its, cont: { L: 2000, W: 1000, H: 2000 } });
  ok(!validate(res(items)).length, 'checker: 10 kg on a box that takes 10 kg passes');
  ok(validate(res([{ ...items[0], maxLoad: 9 }, items[1]])).includes('too much weight on a box'), 'checker: 10 kg on a box that takes 9 kg fails');
  ok(validate(res([{ ...items[0], maxOnTop: 0 }, items[1]])).includes('too many boxes stacked on a box'), 'checker: a box on a box that takes none fails');
  // three high with at most one on top fails at the bottom box
  const p3 = [0, 1, 2].map((m) => ({ k: 0, x: 0, y: 0, z: m * 1000, dx: 1000, dy: 1000, dz: 1000 }));
  ok(validate({ placed: p3, items: [{ ...items[0], qty: 3, maxLoad: null, maxOnTop: 1 }], cont: { L: 1000, W: 1000, H: 3000 } }).includes('too many boxes stacked on a box'), 'checker: 3 high with max 1 on top fails');
  // random loads with limits: every plan (column, interlocked, pallet) passes the checker
  let bad = 0, limited = 0;
  for (let s2 = 1; s2 <= 30; s2++) {
    let x = s2 * 15485863; const R = () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648);
    const pallet = R() < 0.3;
    const Cr = pallet ? { L: 1200, W: 800, H: 1600 } : { L: 3000 + R() * 6000, W: 2300, H: 2400, maxWeight: R() < 0.5 ? 10000 : 0 };
    const its = [0, 1].slice(0, pallet ? 1 : 1 + Math.floor(R() * 2)).map(() => ({ l: 250 + R() * 500, w: 200 + R() * 400, h: 150 + R() * 400, weight: 2 + R() * 30, qty: 100 + Math.floor(R() * 900), rotation: R() < 0.6 ? 'upright' : 'any', stackable: true, maxOnTop: R() < 0.5 ? Math.floor(R() * 4) : null, maxLoad: R() < 0.6 ? Math.round(R() * 120) : null }));
    const stack = R() < 0.5 ? 'interlock' : 'column';
    const rr = stackPack(Cr, its, { timeMs: 150, pallet, stack });
    if (rr.items.some((it) => it.maxOnTop != null || it.maxLoad != null)) limited++;
    const e = validate(rr); if (e.length) { bad++; console.log('limits fuzz', s2, e, JSON.stringify(its)); }
  }
  ok(bad === 0, `30 random loads with stacking limits pass the checker (${bad} bad, ${limited} limited)`);
  // hand editing with limits: placeProblem refuses a box that would overload the one below
  {
    const its = [{ l: 1000, w: 1000, h: 1000, weight: 30, qty: 3, rotation: 'upright', maxLoad: 40, name: 'Crate' }];
    const ctx = makeCtx({ L: 1000, W: 1000, H: 3000 }, its, [{ k: 0, x: 0, y: 0, z: 0, dx: 1000, dy: 1000, dz: 1000 }, { k: 0, x: 0, y: 0, z: 1000, dx: 1000, dy: 1000, dz: 1000 }]);
    // bottom crate already carries 30 kg; a third would put 60 kg on it (max 40)
    const why = placeProblem(ctx, { k: 0, x: 0, y: 0, z: 2000, dx: 1000, dy: 1000, dz: 1000 });
    ok(why.includes('may carry only 40 kg'), 'hand edit: a third 30 kg crate on a crate that takes 40 kg is refused (' + why + ')');
    ok(spots(ctx, 0, null).length === 0, 'hand edit: no free spot offered on top');
    const its2 = [{ ...its[0], maxLoad: null, maxOnTop: 1 }];
    const ctx2 = makeCtx({ L: 1000, W: 1000, H: 3000 }, its2, ctx.boxes);
    ok(placeProblem(ctx2, { k: 0, x: 0, y: 0, z: 2000, dx: 1000, dy: 1000, dz: 1000 }).includes('only 1 box on top'), 'hand edit: max 1 box on top refuses a third');
  }
  // fill the rest with limits keeps them (gaps behind fixed boxes)
  {
    let badF = 0;
    for (let s3 = 1; s3 <= 12; s3++) {
      let x = s3 * 32452843; const R = () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648);
      const Cf = { L: 4000 + R() * 4000, W: 2300, H: 2400 };
      const its = [0, 1].map(() => ({ l: 300 + R() * 500, w: 300 + R() * 400, h: 200 + R() * 400, weight: 5 + R() * 40, qty: 200 + Math.floor(R() * 400), rotation: 'upright', maxOnTop: R() < 0.5 ? Math.floor(R() * 3) + 1 : null, maxLoad: R() < 0.7 ? Math.round(20 + R() * 80) : null }));
      const base = pack(Cf, its, { timeMs: 100 });
      const keep = base.placed.filter((_, i) => i % 3 === 0).map((p) => ({ k: base.items[p.k].idx, x: p.x, y: p.y, z: p.z, dx: p.dx, dy: p.dy, dz: p.dz }));
      const keepOk = keep.filter((b, i, arr) => b.z < 0.01 || arr.some((o) => Math.abs(o.z + o.dz - b.z) < 0.01 && o.x < b.x + b.dx && b.x < o.x + o.dx && o.y < b.y + b.dy && b.y < o.y + o.dy));
      const ctx0 = makeCtx(Cf, its, []); const fixed = [];
      for (const b of keepOk.sort((a, c) => a.z - c.z)) { const c = makeCtx(Cf, its, fixed); if (!placeProblem(c, b)) fixed.push(b); }
      const r = fillAround(Cf, its, fixed, { timeMs: 100 });
      const e = validate(r); if (e.length) { badF++; console.log('fill limits', s3, e); }
    }
    ok(badF === 0, `fill the rest: 12 random cases with limits pass the checker (${badF} bad)`);
  }
}
// Layered pallets (cartons on pallets first): even layers, hand-checked on a Euro pallet 1200 x 800, 1,800 mm incl. 144 mm deck
{
  const P = { L: 1200, W: 800, H: 1656, maxWeight: 1500, minSupport: 0.8 };
  const Bx = { l: 500, w: 300, h: 300, weight: 6, rotation: 'upright', stackable: true };
  // 50 x 30 cm: 6 per layer (most cartons), 1656 / 300 = 5 layers -> 30; plain grid 2 x 2 = 4 per layer -> 20
  let lp = layeredPallet(P, Bx, { stack: 'column' });
  let r = layeredPlan(P, Bx, lp, lp.per);
  const layerSets = [0, 1, 2, 3, 4].map((i) => r.placed.filter((p) => p.z === i * 300).map((p) => `${p.x},${p.y},${p.dx}`).sort().join(';'));
  ok(lp.per === 30 && lp.tihi === '6 × 5' && !validate(r).length && layerSets.every((x) => x === layerSets[0]), 'layered pallet, columns: 6 × 5 = 30, every layer the same (' + lp.tihi + ')');
  lp = layeredPallet(P, Bx, { stack: 'column', grid: true }); r = layeredPlan(P, Bx, lp, lp.per);
  ok(lp.per === 20 && lp.tihi === '4 × 5' && new Set(r.placed.map((p) => p.dx)).size === 1 && !validate(r).length, 'plain grid: every carton the same way, 4 × 5 = 20');
  lp = layeredPallet(P, Bx, { stack: 'interlock' }); r = layeredPlan(P, Bx, lp, lp.per);
  ok(lp.per === 30 && !validate(r).length, 'interlocked layers: 30, plan passes the check (' + lp.tihi + ')');
  // last pallet: 20 of 30 = 3 full layers of 6 + 2 on top
  lp = layeredPallet(P, Bx, { stack: 'column' }); r = layeredPlan(P, Bx, lp, 20);
  const byZ = [0, 300, 600, 900].map((z) => r.placed.filter((p) => p.z === z).length);
  ok(byZ.join() === '6,6,6,2' && !validate(r).length, 'part pallet of 20: layers 6, 6, 6, 2 (' + byZ.join() + ')');
  // 60 x 40 x 40 cm, any side down: 4 per layer, 4 layers of 400 = 16 (vs 6 x 2 = 12 with 60 up)
  lp = layeredPallet(P, { l: 600, w: 400, h: 400, weight: 12, rotation: 'any', stackable: true }, { stack: 'column' });
  ok(lp.per === 16 && lp.up === 400, '60 × 40 × 40 any side down: 4 × 4 = 16 with 40 cm up');
  // limits: max 2 on top -> 3 layers; pallet max load 100 kg with 6 kg cartons -> 16
  lp = layeredPallet(P, { ...Bx, maxOnTop: 2 }, { stack: 'column' });
  ok(lp.per === 18 && lp.hi === 3, 'max 2 on top: 3 layers of 6 = 18');
  lp = layeredPallet({ ...P, maxWeight: 100 }, Bx, { stack: 'column' });
  ok(lp.per === 16, 'pallet max load 100 kg / 6 kg = 16');
}
// ---------- weight distribution (balance.js) ----------
{
  const { cog, offsets, longVerdict, vertOk, axleSplit } = await import('../src/scripts/balance.js');
  const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;
  // CTU Code annex 7 appendix 4 section 3 example: 3.5, 4.2, 3.7, 2.2, 4.9 t at 0.7, 1.4, 3.0, 3.8, 5.1 m -> 52.78 / 18.5 = 2.853 m
  const ex = [[3.5, 0.7], [4.2, 1.4], [3.7, 3.0], [2.2, 3.8], [4.9, 5.1]];
  const items = ex.map(([t]) => ({ weight: t * 1000 }));
  const bx = ex.map(([, d], k) => ({ k, x: d * 1000 - 50, dx: 100, y: 1126, dy: 100, z: 0, dz: 400 }));
  let c = cog(bx, items);
  ok(near(c.m, 18500) && near(c.x, 52780 / 18.5, 1e-6), `CTU Code example: CG ${(c.x / 1000).toFixed(3)} m from the front (52.78 / 18.5 = 2.853)`);
  // symmetric: four 500 kg boxes in the corners of a 20' (5898 x 2352 x 2393) -> CG at the middle, 0% off
  const C20 = { L: 5898, W: 2352, H: 2393 };
  const sym = [[0, 0], [5898 - 1000, 0], [0, 2352 - 800], [5898 - 1000, 2352 - 800]].map(([x, y]) => ({ k: 0, x, y, z: 0, dx: 1000, dy: 800, dz: 600 }));
  c = cog(sym, [{ weight: 500 }]); let e = offsets(c, C20);
  ok(near(c.x, 2949) && near(c.y, 1176) && near(c.z, 300) && near(e.long, 0) && near(e.trans, 0) && longVerdict(e.long) === 'ok' && vertOk(e.vert), 'symmetric corners: CG = middle (2949, 1176), 300 mm high');
  // one-sided: 1000 kg centred 500 mm from the back wall + 1000 kg at mid-length -> x = (500 + 2949) / 2 = 1724.5,
  // (1724.5 - 2949) / 5898 = -20.76% -> over 10%; a box twice as heavy on one side across: y = (2 x 400 + 1 x 1176)/3
  c = cog([{ k: 0, x: 0, dx: 1000, y: 776, dy: 800, z: 0, dz: 600 }, { k: 0, x: 2449, dx: 1000, y: 776, dy: 800, z: 0, dz: 600 }], [{ weight: 1000 }]); e = offsets(c, C20);
  ok(near(c.x, 1724.5) && near(e.long, (1724.5 - 2949) / 5898) && longVerdict(e.long) === 'over', `one-sided: CG 1724.5 mm, ${(e.long * 100).toFixed(2)}% -> over 10%`);
  c = cog([{ k: 0, x: 0, dx: 1000, y: 0, dy: 800, z: 0, dz: 600 }, { k: 1, x: 0, dx: 1000, y: 776, dy: 800, z: 0, dz: 600 }], [{ weight: 2000 }, { weight: 1000 }]);
  ok(near(c.y, (2 * 400 + 1176) / 3), `heavier box on the right: y = (2 x 400 + 1176) / 3 = ${c.y.toFixed(1)} mm`);
  ok(longVerdict(0.05) === 'ok' && longVerdict(-0.0501) === 'tolerated' && longVerdict(0.1) === 'tolerated' && longVerdict(0.1001) === 'over', 'eccentricity bands: 5% ok, 10% tolerated, above 10% over');
  ok(vertOk(0.49) && !vertOk(0.5), 'vertical: below half the height');
  ok(cog([], []) === null && cog([{ k: 0, x: 0, dx: 1, y: 0, dy: 1, z: 0, dz: 1 }], [{ weight: 0 }]) === null, 'no weight: no CG');
  // axle split by moment balance: 20,000 kg at 6000 mm, kingpin 900, rear axles 11000:
  // rear = 20000 x 5100 / 10100 = 10,099.01 kg, front = 9,900.99 kg
  let sp = axleSplit(20000, 6000, 900, 11000);
  ok(near(sp.rear, 20000 * 5100 / 10100) && near(sp.front + sp.rear, 20000) && near(sp.rear * (11000 - 900), 20000 * (6000 - 900), 1e-6) && !sp.outside, `axle split: rear ${sp.rear.toFixed(2)} kg, front ${sp.front.toFixed(2)} kg, moments balance`);
  sp = axleSplit(1000, 500, -300, 2700); // front support ahead of the back wall: rear = 1000 x 800 / 3000
  ok(near(sp.rear, 800 / 3) && near(sp.front, 1000 - 800 / 3), 'negative front position: rear 266.67 kg');
  ok(axleSplit(1000, 500, 900, 900) === null && axleSplit(1000, 500, 900, 100) === null, 'rear not behind front: no split');
  ok(axleSplit(1000, 12000, 900, 11000).outside && axleSplit(1000, 12000, 900, 11000).front < 0, 'CG behind the rear axles: flagged, front load negative');
}
console.log(fails ? `${fails} failing` : 'all engine tests pass');
process.exit(fails ? 1 : 0);
