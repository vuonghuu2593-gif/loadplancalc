// Page logic for the load planner: form state (stored in mm / kg so unit switches never drift),
// a Web Worker that runs the packing engine, results, 3D view and share links.
import { U, round, fmt } from './units.js';

const COLORS = ['#F08A24', '#3E8ED0', '#4CB782', '#D9534F', '#9B6BD3', '#E5C02E', '#2BB5B8', '#C76B98', '#8C9A3C', '#A0693B'];
const SWATCH = COLORS;

export function initPlanner(root) {
  const mode = root.dataset.mode;
  const presets = JSON.parse(root.dataset.presets || '[]');
  const defaults = JSON.parse(root.dataset.defaults || '{}');
  const $ = (s) => root.querySelector(s);
  const f = (name) => root.querySelector(`[data-f="${name}"]`);
  const R = (name) => root.querySelector(`[data-r="${name}"]`);
  const tpl = document.getElementById('box-tpl');

  let units = 'metric';
  try { units = localStorage.getItem('lpc-units') || (navigator.language === 'en-US' ? 'imperial' : 'metric'); } catch { /* storage blocked */ }
  let state = structuredClone(defaults);
  const fromHash = readHash();
  if (fromHash) state = fromHash;

  // ---------- form <-> state ----------
  const lenFields = mode === 'container' ? ['L', 'W', 'H', 'doorW', 'doorH'] : ['L', 'W', 'H', 'overhang', 'palletH'];
  const showLen = (mm) => (mm === '' || mm == null ? '' : String(round(U[units].fromMM(mm), units === 'metric' ? 1 : 2)));
  const showWt = (kg) => (kg === '' || kg == null || kg === 0 ? (kg === 0 ? '0' : '') : String(round(U[units].fromKG(kg), 2)));
  const readLen = (v) => { const n = parseFloat(String(v).replace(',', '.')); return Number.isFinite(n) && n >= 0 ? U[units].toMM(n) : null; };
  const readWt = (v) => { const n = parseFloat(String(v).replace(',', '.')); return Number.isFinite(n) && n >= 0 ? U[units].toKG(n) : null; };

  function paintUnits() {
    root.querySelectorAll('[data-ul]').forEach((e) => { e.textContent = `(${U[units].len})`; });
    root.querySelectorAll('[data-uw]').forEach((e) => { e.textContent = `(${U[units].wt})`; });
    root.querySelectorAll('[data-units]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.units === units)));
  }
  function paintContainer() {
    const c = state.cont;
    f('preset').value = c.preset || 'custom';
    for (const k of lenFields) f(k).value = showLen(c[k]);
    f('maxWeight').value = c.maxWeight ? showWt(c.maxWeight) : '';
    f('priority').checked = !!state.priority;
    const p = presets.find((x) => x.id === c.preset);
    f('srcnote').innerHTML = p && p.url ? `Preset figures from <a href="${p.url}" rel="noopener" target="_blank">${p.source || 'Hapag-Lloyd'}</a>. Containers vary by maker and series; check the CSC plate or your booking for the exact unit.` : (mode === 'container' ? 'Enter the inside dimensions of your container.' : '');
  }
  function paintBoxes() {
    const host = $('[data-boxes]'); host.innerHTML = '';
    state.items.forEach((it, i) => {
      const node = tpl.content.firstElementChild.cloneNode(true);
      node.style.setProperty('--sw', SWATCH[i % SWATCH.length]);
      node.querySelector('[data-b="name"]').value = it.name || `Box ${i + 1}`;
      node.querySelector('[data-b="qty"]').value = it.qty;
      for (const k of ['l', 'w', 'h']) node.querySelector(`[data-b="${k}"]`).value = showLen(it[k]);
      node.querySelector('[data-b="weight"]').value = showWt(it.weight);
      node.querySelector('[data-b="rotation"]').value = it.rotation || 'any';
      node.querySelector('[data-b="stackable"]').checked = it.stackable !== false;
      node.querySelector('[data-del]').hidden = state.items.length < 2;
      node.dataset.i = i;
      host.appendChild(node);
    });
    paintUnits();
  }

  root.querySelector('form').addEventListener('input', (e) => {
    const t = e.target;
    if (t.dataset.f && t.dataset.f !== 'preset' && t.dataset.f !== 'priority') {
      const k = t.dataset.f;
      if (k === 'maxWeight') state.cont.maxWeight = readWt(t.value) ?? 0;
      else { const v = readLen(t.value); if (v !== null) state.cont[k] = v; }
      if (['L', 'W', 'H', 'doorW', 'doorH', 'maxWeight'].includes(k) && mode === 'container' && state.cont.preset !== 'custom') { state.cont.preset = 'custom'; f('preset').value = 'custom'; paintContainer(); }
      schedule();
    } else if (t.dataset.b) {
      const i = +t.closest('.boxcard').dataset.i; const it = state.items[i]; const k = t.dataset.b;
      if (k === 'name') it.name = t.value;
      else if (k === 'qty') { const n = parseInt(t.value, 10); it.qty = Number.isFinite(n) && n >= 0 ? Math.min(n, 20000) : 0; }
      else if (k === 'weight') it.weight = readWt(t.value) ?? 0;
      else if (k === 'rotation') it.rotation = t.value;
      else if (k === 'stackable') it.stackable = t.checked;
      else { const v = readLen(t.value); if (v !== null) it[k] = v; }
      schedule();
    }
  });
  root.querySelector('form').addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset.f === 'preset') {
      const p = presets.find((x) => x.id === t.value);
      if (p) {
        if (mode === 'container') Object.assign(state.cont, { preset: p.id, L: p.L, W: p.W, H: p.H, doorW: p.doorW, doorH: p.doorH, maxWeight: p.payload });
        else Object.assign(state.cont, { preset: p.id, L: p.L, W: p.W });
      } else state.cont.preset = 'custom';
      paintContainer(); schedule();
    } else if (t.dataset.f === 'priority') { state.priority = t.checked; schedule(); }
  });
  root.querySelectorAll('[data-units]').forEach((b) => b.addEventListener('click', () => {
    units = b.dataset.units; try { localStorage.setItem('lpc-units', units); } catch { /* ignore */ }
    paintUnits(); paintContainer(); paintBoxes(); render(last);
  }));
  $('[data-add]').addEventListener('click', () => {
    if (state.items.length >= 10) return;
    const prev = state.items[state.items.length - 1];
    state.items.push({ name: `Box ${state.items.length + 1}`, l: prev ? prev.l : 400, w: prev ? prev.w : 300, h: prev ? prev.h : 300, weight: prev ? prev.weight : 5, qty: 50, rotation: 'any', stackable: true });
    paintBoxes(); schedule();
  });
  $('[data-boxes]').addEventListener('click', (e) => {
    const d = e.target.closest('[data-del]'); if (!d) return;
    state.items.splice(+d.closest('.boxcard').dataset.i, 1); paintBoxes(); schedule();
  });

  // ---------- engine ----------
  const worker = new Worker(new URL('./pack-worker.js', import.meta.url), { type: 'module' });
  let reqId = 0, timer = 0, last = null;
  function engineInput() {
    const c = state.cont;
    if (mode === 'pallet') {
      const oh = c.overhang || 0;
      return { container: { L: c.L + 2 * oh, W: c.W + 2 * oh, H: Math.max(0, c.H - (c.palletH || 0)), maxWeight: c.maxWeight }, offset: oh };
    }
    return { container: { L: c.L, W: c.W, H: c.H, maxWeight: c.maxWeight, doorW: c.doorW, doorH: c.doorH }, offset: 0 };
  }
  function schedule() {
    clearTimeout(timer); root.querySelector('[data-result]').classList.add('busy');
    timer = setTimeout(run, 250);
    writeHash();
  }
  function run() {
    const { container } = engineInput();
    const items = state.items.map((it) => ({ l: it.l, w: it.w, h: it.h, weight: it.weight, qty: it.qty, rotation: it.rotation, stackable: it.stackable !== false }));
    worker.postMessage({ id: ++reqId, container, items, opts: { priority: !!state.priority, timeMs: 1200 } });
  }
  worker.onmessage = (e) => { if (e.data.id !== reqId) return; last = e.data; render(last); };

  // ---------- results ----------
  let view = null, boxes = [];
  const viewHost = $('[data-view]');
  async function ensureView() {
    if (view) return view;
    const { createView } = await import('./view3d.js');
    view = createView(viewHost);
    root.querySelectorAll('[data-view-btn]').forEach((b) => b.addEventListener('click', () => {
      root.querySelectorAll('[data-view-btn]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      view.aim(b.dataset.viewBtn);
    }));
    return view;
  }
  const step = $('[data-step]');
  step.addEventListener('input', () => { view && view.setStep(+step.value); stepText(); });
  const stepText = () => { R('stepTxt').textContent = `${fmt(+step.value)} of ${fmt(boxes.length)} boxes`; };

  async function render(d) {
    if (!d) return;
    root.querySelector('[data-result]').classList.remove('busy');
    const u = U[units];
    const ordered = state.items.reduce((s, it) => s + (it.qty || 0), 0);
    const perItem = state.items.map(() => 0);
    d.itemIdx.forEach((orig, k) => { perItem[orig] = d.perItem[k] || 0; });
    const contVol = d.cont.L * d.cont.W * d.cont.H;
    const n = d.totals.n;
    $('#r-main').textContent = `${fmt(n)} of ${fmt(ordered)}`;
    R('vol').textContent = contVol > 0 ? `${fmt(d.totals.vol / contVol * 100, 1)}%` : '0%';
    const wt = u.fromKG(d.totals.w);
    R('wt').textContent = `${fmt(wt, 0)} ${u.wt}`;
    R('left').textContent = fmt(ordered - n);
    // warnings
    const w = [];
    if (d.errors.length) w.push(`The plan failed its own check (${d.errors.join(', ')}). Please report these inputs through the contact page.`);
    if (ordered - n > 0) {
      const byWeight = d.cont.maxWeight > 0 && d.totals.w > d.cont.maxWeight * 0.98;
      w.push(byWeight ? `Weight limit reached: ${fmt(ordered - n)} boxes stay out because the load would exceed ${fmt(u.fromKG(d.cont.maxWeight))} ${u.wt}.` : `${fmt(ordered - n)} boxes do not fit in this space.`);
    }
    state.items.forEach((it, i) => {
      const dims = [it.l, it.w, it.h];
      if (it.qty > 0 && perItem[i] === 0) w.push(`“${esc(it.name)}” could not be placed at all — check its size against the inside dimensions${mode === 'container' ? ' and the door opening' : ''}.`);
      if (!dims.every((x) => x > 0)) w.push(`“${esc(it.name)}” needs a length, width and height.`);
    });
    if (d.cog && n) {
      const off = (d.cog.x - d.cont.L / 2) / d.cont.L * 100;
      w.push(`Centre of gravity of the cargo: ${fmt(u.fromMM(d.cog.x), units === 'metric' ? 0 : 1)} ${u.len} from the back wall (${off >= 0 ? fmt(off, 0) + '% toward the door' : fmt(-off, 0) + '% toward the back'} from the middle). Keep heavy cargo low and the load spread evenly.`);
    }
    R('warn').innerHTML = w.map((x) => `<p class="warn">${x}</p>`).join('');
    // table
    R('table').innerHTML = state.items.map((it, i) => `<tr><td><i style="display:inline-block;width:12px;height:12px;border-radius:3px;background:${SWATCH[i % SWATCH.length]};margin-right:6px"></i>${esc(it.name)}</td><td class="num">${fmt(it.qty)}</td><td class="num">${fmt(perItem[i])}</td><td class="num">${fmt(Math.max(0, it.qty - perItem[i]))}</td><td class="num">${fmt(u.fromKG(perItem[i] * it.weight))} ${u.wt}</td></tr>`).join('');
    R('legend').innerHTML = state.items.map((it, i) => `<span><i style="background:${SWATCH[i % SWATCH.length]}"></i>${esc(it.name)}: ${fmt(perItem[i])}</span>`).join('');
    // formula steps with live numbers
    const L = u.fromMM(d.cont.L), W = u.fromMM(d.cont.W), H = u.fromMM(d.cont.H);
    const volU = units === 'metric' ? 'm³' : 'ft³';
    const toVol = (mm3) => (units === 'metric' ? mm3 / 1e9 : mm3 / (304.8 ** 3));
    R('steps').innerHTML = [
      `${mode === 'container' ? 'Container' : 'Load space'} volume = ${fmt(L, 1)} × ${fmt(W, 1)} × ${fmt(H, 1)} ${u.len} = ${fmt(toVol(contVol), 2)} ${volU}`,
      `Cargo loaded = ${fmt(n)} boxes = ${fmt(toVol(d.totals.vol), 2)} ${volU}`,
      `Volume used = ${fmt(toVol(d.totals.vol), 2)} ÷ ${fmt(toVol(contVol), 2)} = ${contVol > 0 ? fmt(d.totals.vol / contVol * 100, 1) : 0}%`,
      d.cont.maxWeight > 0 ? `Weight = ${fmt(wt)} ${u.wt} of ${fmt(u.fromKG(d.cont.maxWeight))} ${u.wt} allowed (${fmt(d.totals.w / d.cont.maxWeight * 100, 1)}%)` : `Weight = ${fmt(wt)} ${u.wt} (no limit entered)`,
    ].join('<br>');
    // 3D
    boxes = [];
    const { offset } = engineInput();
    for (let i = 0; i < d.buf.length; i += 7) boxes.push({ k: d.itemIdx[d.buf[i]], x: d.buf[i + 1], y: d.buf[i + 2], z: d.buf[i + 3], dx: d.buf[i + 4], dy: d.buf[i + 5], dz: d.buf[i + 6] });
    step.max = String(boxes.length); step.value = String(boxes.length); stepText();
    const v = await ensureView();
    v.setPlan({ cont: d.cont, boxes, colors: SWATCH, offset });
  }

  // ---------- share / print ----------
  function writeHash() {
    try { history.replaceState(null, '', '#p=' + btoa(unescape(encodeURIComponent(JSON.stringify(state)))).replace(/=+$/, '')); } catch { /* ignore */ }
  }
  function readHash() {
    const m = location.hash.match(/#p=([A-Za-z0-9+/]+)/);
    if (!m) return null;
    try {
      const s = JSON.parse(decodeURIComponent(escape(atob(m[1]))));
      if (s && s.cont && Array.isArray(s.items) && s.items.length) { s.items = s.items.slice(0, 10); return s; }
    } catch { /* bad link */ }
    return null;
  }
  $('[data-share]').addEventListener('click', async () => {
    writeHash();
    try { await navigator.clipboard.writeText(location.href); R('shareMsg').textContent = 'Link copied.'; }
    catch { R('shareMsg').textContent = 'Copy the address bar to share this plan.'; }
  });
  $('[data-print]').addEventListener('click', () => window.print());

  paintUnits(); paintContainer(); paintBoxes(); run();
}

function esc(s) { return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
