import { pack, palletPack, validate } from './packer.js';
import { fillAround, roomFor } from './editor.js';

// kind "pack": automatic plan (opts.pallet: one box type is built layer by layer, see palletPack); kind "fill": keep the hand-placed boxes and load the rest;
// kind "room": for each box type, how many more fit around the plan as it is.
// Boxes go back as [type (input position), x, y, z, dx, dy, dz, step] in loading order.
self.onmessage = (e) => {
  const { id, kind, container, items, opts, fixed } = e.data;
  const t = Date.now();
  if (kind === 'room') {
    const room = items.map((it, k) => {
      if (!(+it.l > 0 && +it.w > 0 && +it.h > 0)) return null;
      const r = roomFor(container, items, fixed || [], k, opts);
      return validate(r.result).length ? null : { more: r.more, limit: r.limit };
    });
    self.postMessage({ id, kind, room, ms: Date.now() - t });
    return;
  }
  const res = kind === 'fill' ? fillAround(container, items, fixed || [], opts) : opts && opts.pallet ? palletPack(container, items, opts) : pack(container, items, opts);
  const errors = validate(res);
  const n = res.placed.length;
  const buf = new Float64Array(n * 8); // full precision: inch sizes (e.g. 304.8 mm) must come back exactly for the checks
  res.placed.forEach((p, i) => { buf.set([res.items[p.k].idx, p.x, p.y, p.z, p.dx, p.dy, p.dz, p.s ?? -1], i * 8); });
  self.postMessage({
    id, kind, ms: Date.now() - t, errors, buf, cont: res.cont,
    pallet: res.pallet || null,
    steps: res.steps ? res.steps.map((s) => ({ asked: s.asked, loaded: s.loaded, auto: !!s.auto })) : null,
  }, [buf.buffer]);
};
