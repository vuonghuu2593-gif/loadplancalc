import { pack, validate } from './packer.js';
import { fillAround } from './editor.js';

// kind "pack": automatic plan; kind "fill": keep the hand-placed boxes and load the rest.
// Boxes go back as [type (input position), x, y, z, dx, dy, dz, step] in loading order.
self.onmessage = (e) => {
  const { id, kind, container, items, opts, fixed } = e.data;
  const t = Date.now();
  const res = kind === 'fill' ? fillAround(container, items, fixed || [], opts) : pack(container, items, opts);
  const errors = validate(res);
  const n = res.placed.length;
  const buf = new Float32Array(n * 8);
  res.placed.forEach((p, i) => { buf.set([res.items[p.k].idx, p.x, p.y, p.z, p.dx, p.dy, p.dz, p.s ?? -1], i * 8); });
  self.postMessage({
    id, kind, ms: Date.now() - t, errors, buf, cont: res.cont,
    steps: res.steps ? res.steps.map((s) => ({ asked: s.asked, loaded: s.loaded, auto: !!s.auto })) : null,
  }, [buf.buffer]);
};
