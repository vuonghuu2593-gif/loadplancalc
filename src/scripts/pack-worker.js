import { pack, validate } from './packer.js';

self.onmessage = (e) => {
  const { id, container, items, opts } = e.data;
  const t = Date.now();
  const res = pack(container, items, opts);
  const errors = validate(res);
  const n = res.placed.length;
  const buf = new Float32Array(n * 7);
  res.placed.forEach((p, i) => { buf.set([p.k, p.x, p.y, p.z, p.dx, p.dy, p.dz], i * 7); });
  self.postMessage({
    id, ms: Date.now() - t, errors, buf, totals: res.totals, perItem: res.perItem || [], cog: res.cog,
    itemIdx: res.items.map((it) => it.idx), cont: res.cont,
  }, [buf.buffer]);
};
