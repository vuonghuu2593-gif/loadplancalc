// Engine tests: hand-checked cases plus random cases checked by the independent validator.
// Usage: node scripts/test-packer.mjs
import { pack, validate } from '../src/scripts/packer.js';
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
console.log(fails ? `${fails} failing` : 'all engine tests pass');
process.exit(fails ? 1 : 0);
