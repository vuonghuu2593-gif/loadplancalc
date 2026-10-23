import { pack, packMany, palletPack, stackPack, validate } from './packer.js';
import { fillAround, roomFor } from './editor.js';

// kind "pack": automatic plan (opts.pallet: one box type is built layer by layer, see palletPack); kind "fill": keep the hand-placed boxes and load the rest;
// kind "room": for each box type, how many more fit around the plan as it is.
// kind "many": quick check of one container size for the comparison table: boxes in the first unit, units
// needed for the whole load (up to opts.max), the first unit's volume and weight used, and boxes left over.
// Boxes go back as [type (input position), x, y, z, dx, dy, dz, step] in loading order.
self.onmessage = (e) => {
  const { id, kind, container, items, opts, fixed, part, key } = e.data;
  const t = Date.now();
  if (kind === 'palletize') {
    // each box type on its own pallet: boxes per full pallet, load height (above the deck) and weight of a full
    // pallet and of the last, part pallet; every plan passes validate() or the type gets per = 0
    const out = items.map((it) => {
      const q = Math.floor(+it.qty || 0);
      if (!(+it.l > 0 && +it.w > 0 && +it.h > 0) || q < 1) return { per: 0 };
      const o = { ...opts, pallet: true };
      const full = stackPack(container, [{ ...it, qty: 20000 }], o);
      const per = full.pallet ? full.pallet.perPallet : full.totals.n;
      if (!per || validate(full).length) return { per: 0 };
      const one = (n) => { const r = stackPack(container, [{ ...it, qty: n }], o); return validate(r).length || r.totals.n !== n ? null : { n, h: r.placed.reduce((m, p) => Math.max(m, p.z + p.dz), 0), w: r.totals.w }; };
      const f = one(Math.min(per, q)); if (!f) return { per: 0 };
      const rest = q >= per ? q % per : 0;
      const last = rest ? one(rest) : null;
      if (rest && !last) return { per: 0 };
      const lay = full.pallet && full.pallet.layers;
      const tihi = lay && !lay.mixed ? (lay.kind === 'alt' ? `${lay.ti}/${lay.ti2} × ${lay.hi}` : lay.kind === 'even' ? `${lay.ti} × ${lay.hi}` : '') : '';
      return { per, full: q >= per ? Math.floor(q / per) : 0, f, last: q < per ? null : last, single: q < per ? f : null, tihi };
    });
    self.postMessage({ id, kind, out, ms: Date.now() - t });
    return;
  }
  if (kind === 'many') {
    const { runs, left } = packMany(container, items, opts, opts.max ?? 12);
    const bad = runs.some((r) => validate(r).length);
    const r0 = runs[0]; const cv = container.L * container.W * container.H;
    self.postMessage({ id, kind, key, bad, units: runs.length, first: r0 ? r0.totals.n : 0, vol: r0 && cv > 0 ? r0.totals.vol / cv : 0,
      wt: r0 ? r0.totals.w : 0, left: left.reduce((s, q) => s + q, 0), counts: runs.map((r) => r.totals.n), ms: Date.now() - t });
    return;
  }
  if (kind === 'room') {
    const room = items.map((it, k) => {
      if (!(+it.l > 0 && +it.w > 0 && +it.h > 0)) return null;
      const r = roomFor(container, items, fixed || [], k, opts);
      return validate(r.result).length ? null : { more: r.more, limit: r.limit };
    });
    self.postMessage({ id, kind, room, ms: Date.now() - t });
    return;
  }
  const res = kind === 'fill' ? fillAround(container, items, fixed || [], opts) : opts && opts.stack === 'interlock' ? stackPack(container, items, opts) : opts && opts.pallet ? palletPack(container, items, opts) : pack(container, items, opts);
  const errors = validate(res);
  const n = res.placed.length;
  const buf = new Float64Array(n * 8); // full precision: inch sizes (e.g. 304.8 mm) must come back exactly for the checks
  res.placed.forEach((p, i) => { buf.set([res.items[p.k].idx, p.x, p.y, p.z, p.dx, p.dy, p.dz, p.s ?? -1], i * 8); });
  self.postMessage({
    id, kind, part, ms: Date.now() - t, errors, buf, cont: res.cont,
    pallet: res.pallet || null,
    stack: kind === 'fill' ? null : res.stack || null,
    steps: res.steps ? res.steps.map((s) => ({ asked: s.asked, loaded: s.loaded, auto: !!s.auto })) : null,
  }, [buf.buffer]);
};
