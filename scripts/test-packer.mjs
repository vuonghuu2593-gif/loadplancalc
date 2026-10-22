// Engine tests: hand-checked cases plus random cases checked by the independent validator.
// Usage: node scripts/test-packer.mjs
import { pack, validate, palletPack, layersOf, stackPack } from '../src/scripts/packer.js';
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
console.log(fails ? `${fails} failing` : 'all engine tests pass');
process.exit(fails ? 1 : 0);
