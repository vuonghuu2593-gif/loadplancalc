// Page logic for the load planner: form state (stored in mm / kg so unit switches never drift),
// a Web Worker that runs the packing engine, results, 3D view and share links.
import { U, round, fmt } from './units.js';
import { readBoxFile, readDelimited, rowsToItems } from './importer.js';
import { ORIENT, ORIENT_NAMES, layersOf } from './packer.js';
import { loadList, loadListCsv } from './loadlist.js';
import { makeCtx, placeProblem, spots as freeSpots, nudge as nudgeBox, onTop, stackFrom, asResult, orientIndex, validate } from './editor.js';

const COLORS = ['#F08A24', '#3E8ED0', '#4CB782', '#D9534F', '#9B6BD3', '#E5C02E', '#2BB5B8', '#C76B98', '#8C9A3C', '#A0693B'];
const SWATCH = COLORS;
const SHORT = ['H up · L along', 'H up · L across', 'W up · L along', 'W up · L across', 'L up · W along', 'L up · W across'];
const AUTO_HELP = 'The planner chooses the order, place and position of every box (within the positions you allow) to load as much as possible.';
const SEMI_HELP = 'You set the loading steps: which box type goes in first, how many, and in which position. The planner works out the exact place of every box, step by step, and checks the result.';

// [along, across, up] for orientation i of a box
const dimsOf = (it, i) => { const d = [it.l, it.w, it.h]; const p = ORIENT.any[i]; return [d[p[0]], d[p[1]], d[p[2]]]; };
// orientation indices a box type may use (mirrors allowedPerms in the engine)
const allowedIdx = (it) => (it.rotation === 'upright' ? [0, 1] : it.rotation === 'custom' && Array.isArray(it.orients) ? it.orients.slice().sort() : [0, 1, 2, 3, 4, 5]);
// which orientation a placed box uses (first allowed match)
const orientOf = (it, b) => {
  const near = (o) => Math.abs(o[0] - b.dx) < 0.5 && Math.abs(o[1] - b.dy) < 0.5 && Math.abs(o[2] - b.dz) < 0.5;
  const list = allowedIdx(it);
  return list.find((i) => near(dimsOf(it, i))) ?? [0, 1, 2, 3, 4, 5].find((i) => near(dimsOf(it, i))) ?? -1;
};

// small isometric drawing of a box in one orientation; the arrow shows the container length
function iso(o, color) {
  const m = Math.max(...o) || 1; const [a, b, c] = o.map((v) => (v / m) * 26);
  const P = (x, y, z) => [(x - y) * 0.866, (x + y) * 0.5 - z];
  const poly = (pts, fill, op) => `<polygon points="${pts.map((q) => P(...q).map((v) => v.toFixed(1)).join(',')).join(' ')}" fill="${fill}"${op ? ` fill-opacity="${op}"` : ''} stroke="currentColor" stroke-opacity=".7" stroke-width=".8" stroke-linejoin="round"/>`;
  const top = [[0, 0, c], [a, 0, c], [a, b, c], [0, b, c]];
  const fx = [[a, 0, 0], [a, b, 0], [a, b, c], [a, 0, c]];
  const fy = [[0, b, 0], [a, b, 0], [a, b, c], [0, b, c]];
  const y0 = b + 7; const s0 = P(0, y0, 0), s1 = P(a + 8, y0, 0), h1 = P(a + 3, y0 - 3, 0), h2 = P(a + 3, y0 + 3, 0);
  const pts = [...top, ...fx, ...fy, [0, y0, 0], [a + 8, y0, 0], [a + 3, y0 + 3, 0]].map((q) => P(...q));
  const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
  const x0 = Math.min(...xs) - 2, yy0 = Math.min(...ys) - 2, w = Math.max(...xs) - x0 + 2, h = Math.max(...ys) - yy0 + 2;
  return `<svg viewBox="${x0.toFixed(1)} ${yy0.toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)}" aria-hidden="true">`
    + poly(top, color) + poly(fx, color) + poly(fx, '#000', 0.28) + poly(fy, color) + poly(fy, '#000', 0.14)
    + `<path d="M${s0.join(',')} L${s1.join(',')} M${h1.join(',')} L${s1.join(',')} L${h2.join(',')}" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>`;
}

export function initPlanner(root) {
  const mode = root.dataset.mode;
  const presets = JSON.parse(root.dataset.presets || '[]');
  const defaults = JSON.parse(root.dataset.defaults || '{}');
  // optional pallet footprints for boxes that are whole pallets; the picker shows the footprint that matches
  // the box length and width (either way round), else "Custom size", so nothing extra is stored or shared
  const boxPresets = JSON.parse(root.dataset.boxpresets || '[]');
  const bpOf = (it) => (boxPresets.find((p) => (Math.abs(it.l - p.L) < 0.05 && Math.abs(it.w - p.W) < 0.05) || (Math.abs(it.l - p.W) < 0.05 && Math.abs(it.w - p.L) < 0.05))?.id) || 'custom';
  const $ = (s) => root.querySelector(s);
  const f = (name) => root.querySelector(`[data-f="${name}"]`);
  const R = (name) => root.querySelector(`[data-r="${name}"]`);
  const tpl = document.getElementById('box-tpl');

  let units = 'metric';
  try { units = localStorage.getItem('lpc-units') || (navigator.language === 'en-US' ? 'imperial' : 'metric'); } catch { /* storage blocked */ }
  let state = structuredClone(defaults);
  const fromHash = readHash();
  if (fromHash) state = fromHash;
  if (state.mode !== 'semi') state.mode = 'auto';
  if (!Array.isArray(state.steps)) state.steps = [];
  if (state.fillRest === undefined) state.fillRest = true;
  // stacking pattern: links made before this option existed keep column stacks
  if (state.stack !== 'interlock' && state.stack !== 'column') state.stack = 'column';
  state.support = [1, 0.9, 0.8, 0.7].includes(+state.support) ? +state.support : 0.8;
  // pallet's own weight (kg, null = not entered = 0): links made before this field existed take the preset's published weight
  if (mode === 'pallet' && state.cont.palletWt === undefined) state.cont.palletWt = presets.find((x) => x.id === state.cont.preset)?.weightKg ?? null;
  if (mode === 'pallet' && state.cont.palletWt != null && !(Number.isFinite(+state.cont.palletWt) && +state.cont.palletWt >= 0)) state.cont.palletWt = null;
  const stepTpl = document.getElementById('step-tpl');

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
    if (mode === 'pallet') f('palletWt').value = c.palletWt == null ? '' : showWt(c.palletWt);
    f('priority').checked = !!state.priority;
    const p = presets.find((x) => x.id === c.preset);
    if (!p && $('[data-specs]')) $('[data-specs]').open = true; // custom size: show the fields to type into
    paintSummaries();
    if (mode === 'pallet') {
      const u = U[units];
      const pw = !p ? '' : p.weightKg ? ` The pallet weight filled in is ${esc(p.source)}'s approximate figure (about ${fmt(u.fromKG(p.weightKg), 1)} ${u.wt}); it is added to the boxes for the gross weight.` : ` ${esc(p.source)} does not publish this pallet's own weight on that page: enter it as the pallet weight to see the gross weight.`;
      f('srcnote').innerHTML = p && p.url ? `Pallet length, width and height from <a href="${p.url}" rel="noopener" target="_blank">${esc(p.source)}</a>, and its safe working load (${fmt(u.fromKG(p.maxWeight), 0)} ${u.wt}) as the starting max load weight. The max height is your own limit (racking, trailer, customer or warehouse rule); the ${fmt(u.fromMM(1800), units === 'metric' ? 0 : 1)} ${u.len} filled in is only an example.${pw}` : 'Enter your pallet size, height and own weight (leave it empty to count 0), how far the load may overhang each side, the max height of the loaded pallet and the max load weight.';
    } else f('srcnote').innerHTML = p && p.url ? `Preset figures from <a href="${p.url}" rel="noopener" target="_blank">${esc(p.source || 'Hapag-Lloyd')}</a>. ${p.note ? esc(p.note) : 'Containers vary by maker and series; check the CSC plate or your booking for the exact unit.'}` : 'Enter the inside dimensions of your container or trailer.';
  }
  // folded groups: their summary line shows the current values, so nothing is hidden from view
  function paintSummaries() {
    const u = U[units]; const d = units === 'metric' ? 1 : 2; const c = state.cont;
    const L = (mm) => (mm ? fmt(u.fromMM(mm), d) : '–');
    const specs = $('[data-specsum]');
    if (specs) specs.textContent = `${L(c.L)} × ${L(c.W)} × ${L(c.H)} ${u.len} · ${c.maxWeight ? fmt(u.fromKG(c.maxWeight), 0) + ' ' + u.wt : 'no payload limit'} · door ${L(c.doorW)} × ${L(c.doorH)}`;
    const il = state.stack === 'interlock' && canInterlock();
    $('[data-moresum]').textContent = `${state.mode === 'semi' ? `Semi-automatic (${state.steps.length} step${state.steps.length === 1 ? '' : 's'})` : 'Fully automatic'} · ${il ? 'interlocked' : 'column stacks'}${il && state.support < 1 ? ` (${fmt(state.support * 100)}%)` : ''}${state.priority ? ' · list order' : ''}${stopSteps() ? ' · by delivery stop' : ''}`;
  }
  function paintBoxes() {
    paintPzOn();
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
      node.querySelector('[data-b="maxOnTop"]').value = it.maxOnTop == null ? '' : String(it.maxOnTop);
      const sf = node.querySelector('[data-b="stop"]'); if (sf) sf.value = it.stop == null ? '' : String(it.stop);
      node.querySelector('[data-b="maxLoad"]').value = it.maxLoad == null ? '' : showWt(it.maxLoad);
      node.querySelectorAll('[data-lim]').forEach((x) => { x.hidden = it.stackable === false; });
      node.querySelector('[data-boxmore]').open = it.rotation === 'custom' || openMore.has(i);
      boxSum(node, it);
      if (boxPresets.length) {
        node.querySelector('.bpre').hidden = false;
        const sel = node.querySelector('[data-b="bpreset"]');
        sel.innerHTML = boxPresets.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('') + '<option value="custom">Custom size</option>';
        sel.value = bpOf(it);
      }
      node.querySelector('[data-del]').hidden = state.items.length < 2;
      node.dataset.i = i;
      paintOrients(node, it, i);
      host.appendChild(node);
    });
    paintUnits();
  }
  // one line for the folded part of a box card: orientation, stacking limits, delivery stop
  const openMore = new Set();
  function boxSum(node, it) {
    const u = U[units];
    const rot = it.rotation === 'upright' ? 'this side up' : it.rotation === 'custom' ? `${allowedIdx(it).length} position${allowedIdx(it).length === 1 ? '' : 's'}` : 'any side down';
    const lim = it.stackable === false ? 'nothing on top' : [it.maxOnTop != null && it.maxOnTop !== '' ? `max ${fmt(+it.maxOnTop)} on top` : '', it.maxLoad != null && it.maxLoad !== '' ? `max ${fmt(u.fromKG(+it.maxLoad), 1)} ${u.wt} on top` : ''].filter(Boolean).join(', ') || 'no stacking limit';
    const st = mode === 'container' && it.stop != null && it.stop !== '' ? ` · stop ${it.stop}` : '';
    node.querySelector('[data-boxsum]').textContent = `${rot} · ${lim}${st}`;
  }
  function paintOrients(node, it, i) {
    const box = node.querySelector('[data-orients]');
    box.hidden = it.rotation !== 'custom';
    if (box.hidden) return;
    const on = allowedIdx(it); const u = U[units];
    box.querySelector('.ogrid').innerHTML = [0, 1, 2, 3, 4, 5].map((k) => {
      const o = dimsOf(it, k);
      const t = `${ORIENT_NAMES[k]}: ${o.map((v) => fmt(u.fromMM(v), units === 'metric' ? 1 : 2)).join(' × ')} ${u.len} (along × across × up)`;
      return `<button type="button" class="ochip" data-o="${k}" aria-pressed="${on.includes(k)}" title="${t}" aria-label="${t}">${iso(o, SWATCH[i % SWATCH.length])}<span>${SHORT[k]}</span></button>`;
    }).join('');
  }
  function paintMode() {
    const semi = state.mode === 'semi';
    root.querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === state.mode)));
    $('[data-modehelp]').textContent = semi ? SEMI_HELP : AUTO_HELP;
    $('[data-steps]').hidden = !semi; $('[data-semirow]').hidden = !semi;
    f('fillRest').checked = state.fillRest !== false;
    f('priority').closest('label').hidden = semi && state.fillRest === false;
    $('[data-prioritytxt]').textContent = semi ? 'Boxes loaded automatically go in list order (first type first)' : 'Load in list order (first type has priority)';
    if (semi) paintSteps();
    paintStack();
  }
  // Interlocked layers are planned for one stackable box type in fully automatic mode.
  const canInterlock = () => state.mode !== 'semi' && state.items.length === 1 && state.items[0].stackable !== false;
  function paintStack() {
    root.querySelectorAll('[data-stack]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.stack === state.stack)));
    f('support').value = String(state.support);
    paintSummaries();
    const il = state.stack === 'interlock';
    $('[data-supportrow]').hidden = !il;
    $('[data-stackhelp]').textContent = !il
      ? 'Every layer is the same, so boxes stand in columns: the most boxes, but the columns are not tied together and the load has to be held with wrapping or straps.'
      : canInterlock()
        ? `Layers alternate between two patterns, so boxes bridge the joints of the layer below and tie the load together. It may fit fewer boxes than column stacks. Below 100%, a box may bridge a small gap, but at least ${fmt(state.support * 100)}% of its base and its centre must rest on boxes below.${mode === 'container' ? ' In a container the load is built in walls of equal length from the back wall, so it can be loaded wall by wall.' : ''}`
        : 'Interlocked layers are planned for one box type that can carry boxes on top, in fully automatic mode. This load uses column stacks.';
  }
  function stepOrientOptions(it) {
    const u = U[units]; const seen = new Set(); const out = ['<option value="">Automatic (best allowed)</option>'];
    for (const k of allowedIdx(it)) {
      const o = dimsOf(it, k); const key = o.join('x');
      if (seen.has(key)) continue; seen.add(key);
      out.push(`<option value="${k}" title="${ORIENT_NAMES[k]}">${SHORT[k]} · ${o.map((v) => fmt(u.fromMM(v), units === 'metric' ? 1 : 2)).join('×')} ${u.len}</option>`);
    }
    return out.join('');
  }
  function paintSteps() {
    const host = $('[data-steps]'); host.innerHTML = '';
    state.steps.forEach((st, si) => {
      const node = stepTpl.content.firstElementChild.cloneNode(true);
      const it = state.items[st.item] || state.items[0];
      node.style.setProperty('--sw', SWATCH[(state.items[st.item] ? st.item : 0) % SWATCH.length]);
      node.dataset.si = si;
      node.querySelector('[data-s="title"]').textContent = `Step ${si + 1}`;
      const sel = node.querySelector('[data-s="item"]');
      sel.innerHTML = state.items.map((x, i) => `<option value="${i}">${esc(x.name || `Box ${i + 1}`)}</option>`).join('');
      sel.value = String(state.items[st.item] ? st.item : 0);
      node.querySelector('[data-s="qty"]').value = st.qty == null ? '' : String(st.qty);
      const os = node.querySelector('[data-s="orient"]'); os.innerHTML = stepOrientOptions(it);
      os.value = st.orient == null ? '' : String(st.orient);
      if (os.value !== (st.orient == null ? '' : String(st.orient))) { st.orient = null; os.value = ''; }
      node.querySelector('[data-s="newSection"]').checked = !!st.newSection;
      node.querySelector('[data-move="-1"]').disabled = si === 0;
      node.querySelector('[data-move="1"]').disabled = si === state.steps.length - 1;
      host.appendChild(node);
    });
    if (!state.steps.length) host.innerHTML = '<p class="small" style="margin:0">No steps yet. Add a step, or everything is loaded automatically.</p>';
  }

  root.querySelector('form').addEventListener('input', (e) => {
    const t = e.target;
    if (t.dataset.f === 'fillRest') { state.fillRest = t.checked; paintMode(); schedule(); return; }
    if (t.dataset.f === 'support') { state.support = +t.value; paintStack(); schedule(); return; }
    if (t.dataset.f && t.dataset.f !== 'preset' && t.dataset.f !== 'priority') {
      const k = t.dataset.f;
      if (k === 'maxWeight') state.cont.maxWeight = readWt(t.value) ?? 0;
      else if (k === 'palletWt') { state.cont.palletWt = t.value.trim() === '' ? null : readWt(t.value); if (ed) writeEditHash(); else writeHash(); render(ed ? edView() : last); return; } // the pallet's weight changes no box: keep the plan and any hand edits
      else { const v = readLen(t.value); if (v !== null) state.cont[k] = v; }
      const presetKeys = mode === 'container' ? ['L', 'W', 'H', 'doorW', 'doorH', 'maxWeight'] : ['L', 'W', 'palletH'];
      if (presetKeys.includes(k) && state.cont.preset !== 'custom') { state.cont.preset = 'custom'; f('preset').value = 'custom'; paintContainer(); }
      schedule();
    } else if (t.dataset.b) {
      const i = +t.closest('.boxcard').dataset.i; const it = state.items[i]; const k = t.dataset.b;
      if (k === 'name') it.name = t.value;
      else if (k === 'qty') { const n = parseInt(t.value, 10); it.qty = Number.isFinite(n) && n >= 0 ? Math.min(n, 20000) : 0; }
      else if (k === 'weight') it.weight = readWt(t.value) ?? 0;
      else if (k === 'rotation') {
        if (t.value === 'custom' && !Array.isArray(it.orients)) it.orients = it.rotation === 'upright' ? [0, 1] : [0, 1, 2, 3, 4, 5];
        it.rotation = t.value; paintOrients(t.closest('.boxcard'), it, i);
      } else if (k === 'stackable') { it.stackable = t.checked; t.closest('.boxcard').querySelectorAll('[data-lim]').forEach((x) => { x.hidden = !t.checked; }); }
      else if (k === 'maxOnTop') { const n = parseInt(t.value, 10); it.maxOnTop = t.value.trim() === '' || !(n >= 0) ? null : Math.min(n, 999); }
      else if (k === 'maxLoad') it.maxLoad = t.value.trim() === '' ? null : readWt(t.value);
      else if (k === 'stop') { const n = parseInt(t.value, 10); it.stop = t.value.trim() === '' || !(n >= 1) ? null : Math.min(n, 99); }
      else if (k === 'bpreset') {
        const p = boxPresets.find((x) => x.id === t.value); if (!p) return;
        const card = t.closest('.boxcard'); it.l = p.L; it.w = p.W;
        card.querySelector('[data-b="l"]').value = showLen(it.l); card.querySelector('[data-b="w"]').value = showLen(it.w);
        if (it.rotation === 'custom') paintOrients(card, it, i);
      } else {
        const v = readLen(t.value);
        if (v !== null) { it[k] = v; if (it.rotation === 'custom') paintOrients(t.closest('.boxcard'), it, i); }
        const bp = t.closest('.boxcard').querySelector('[data-b="bpreset"]'); if (boxPresets.length && bp) bp.value = bpOf(it);
      }
      boxSum(t.closest('.boxcard'), it);
      if (state.mode === 'semi' && k !== 'qty' && k !== 'weight' && k !== 'stackable') paintSteps();
      schedule();
    } else if (t.dataset.s) {
      const si = +t.closest('.stepcard').dataset.si; const st = state.steps[si]; const k = t.dataset.s;
      if (k === 'item') { st.item = +t.value; st.orient = null; paintSteps(); }
      else if (k === 'qty') { const n = parseInt(t.value, 10); st.qty = t.value.trim() === '' ? null : Number.isFinite(n) && n >= 0 ? Math.min(n, 20000) : 0; }
      else if (k === 'orient') st.orient = t.value === '' ? null : +t.value;
      else if (k === 'newSection') st.newSection = t.checked;
      schedule();
    }
  });
  root.querySelector('form').addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset.f === 'preset') {
      const p = presets.find((x) => x.id === t.value);
      if (p) {
        if (mode === 'container') Object.assign(state.cont, { preset: p.id, L: p.L, W: p.W, H: p.H, doorW: p.doorW, doorH: p.doorH, maxWeight: p.payload });
        else Object.assign(state.cont, { preset: p.id, L: p.L, W: p.W, palletH: p.H, maxWeight: p.maxWeight, palletWt: p.weightKg ?? null });
      } else state.cont.preset = 'custom';
      paintContainer(); schedule();
    } else if (t.dataset.f === 'priority') { state.priority = t.checked; schedule(); }
  });
  root.querySelectorAll('[data-units]').forEach((b) => b.addEventListener('click', () => {
    units = b.dataset.units; try { localStorage.setItem('lpc-units', units); } catch { /* ignore */ }
    paintUnits(); paintContainer(); paintBoxes(); paintMode(); paintPz(); render(ed ? edView() : plans[shown] || last); paintFit();
  }));
  root.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => {
    state.mode = b.dataset.mode;
    if (state.mode === 'semi' && !state.steps.length) state.steps = state.items.map((_, i) => ({ item: i, qty: null, orient: null, newSection: false }));
    paintMode(); schedule();
  }));
  root.querySelectorAll('[data-stack]').forEach((b) => b.addEventListener('click', () => {
    state.stack = b.dataset.stack; paintStack(); schedule();
  }));
  $('[data-addstep]').addEventListener('click', () => {
    if (state.steps.length >= 20) return;
    state.steps.push({ item: 0, qty: null, orient: null, newSection: false }); paintSteps(); schedule();
  });
  $('[data-steps]').addEventListener('click', (e) => {
    const card = e.target.closest('.stepcard'); if (!card) return;
    const si = +card.dataset.si;
    const mv = e.target.closest('[data-move]');
    if (mv) { const j = si + +mv.dataset.move; if (j < 0 || j >= state.steps.length) return; [state.steps[si], state.steps[j]] = [state.steps[j], state.steps[si]]; paintSteps(); schedule(); }
    else if (e.target.closest('[data-sdel]')) { state.steps.splice(si, 1); paintSteps(); schedule(); }
  });
  $('[data-add]').addEventListener('click', () => {
    if (state.items.length >= 10) return;
    const prev = state.items[state.items.length - 1];
    state.items.push({ name: `Box ${state.items.length + 1}`, l: prev ? prev.l : 400, w: prev ? prev.w : 300, h: prev ? prev.h : 300, weight: prev ? prev.weight : 5, qty: 50, rotation: 'any', stackable: true });
    paintBoxes(); paintMode(); schedule();
  });
  // ---------- import a box list (Excel .xlsx, CSV/TSV, or cells pasted from a spreadsheet) ----------
  const importMsg = $('[data-importmsg]');
  function applyImport(res, source) {
    const lines = [];
    if (!res.items.length) {
      lines.push(`Nothing was imported from ${esc(source)}: no row had a length, width and height. Check that the first sheet has a header row (Name, Length, Width, Height, Weight, Quantity) or use the template.`);
    } else {
      state.items = res.items; state.cartons = null; state.pzOn = null;
      state.steps = state.mode === 'semi' ? state.items.map((_, i) => ({ item: i, qty: null, orient: null, newSection: false })) : [];
      const total = res.items.reduce((t, it) => t + it.qty, 0);
      lines.push(`Imported ${res.items.length} box type${res.items.length === 1 ? '' : 's'} (${fmt(total)} boxes) from ${esc(source)}: ${res.items.map((it) => `${esc(it.name)} × ${fmt(it.qty)}`).join(', ')}. Check the sizes below.`);
      paintBoxes(); paintMode(); schedule();
    }
    for (const n of res.notes) lines.push(esc(n));
    if (res.skipped.length) lines.push(`Skipped ${res.skipped.map(esc).join('; ')}.`);
    importMsg.innerHTML = lines.map((x) => `<p class="warn">${x}</p>`).join('');
    importMsg.hidden = false;
  }
  const fileIn = $('[data-importfile]');
  $('[data-import]').addEventListener('click', () => fileIn.click());
  fileIn.addEventListener('change', async () => {
    const file = fileIn.files && fileIn.files[0]; if (!file) return;
    try { applyImport(await readBoxFile(file, units), file.name); }
    catch (err) { importMsg.innerHTML = `<p class="warn">${esc(file.name)} could not be read. ${esc(err && /\.xls|Excel/.test(err.message) ? err.message : 'Save it as an Excel workbook (.xlsx) or CSV and try again.')}</p>`; importMsg.hidden = false; }
    fileIn.value = '';
  });
  const pasteBtn = $('[data-paste]'), pasteBox = $('[data-pastebox]');
  pasteBtn.addEventListener('click', () => { pasteBox.hidden = !pasteBox.hidden; pasteBtn.setAttribute('aria-expanded', String(!pasteBox.hidden)); if (!pasteBox.hidden) $('[data-pastetext]').focus(); });
  $('[data-pasteuse]').addEventListener('click', () => {
    const text = $('[data-pastetext]').value;
    if (!text.trim()) return;
    applyImport(rowsToItems(readDelimited(text).rows, units), 'the pasted rows');
  });

  $('[data-boxes]').addEventListener('toggle', (e) => {
    if (!e.target.matches || !e.target.matches('[data-boxmore]')) return;
    const c = e.target.closest('.boxcard'); if (!c) return;
    if (e.target.open) openMore.add(+c.dataset.i); else openMore.delete(+c.dataset.i);
  }, true);
  $('[data-boxes]').addEventListener('click', (e) => {
    setTimeout(() => { const c = e.target.closest && e.target.closest('.boxcard'); if (c && c.isConnected && state.items[+c.dataset.i]) boxSum(c, state.items[+c.dataset.i]); }, 0);
    const chip = e.target.closest('[data-o]');
    if (chip) {
      const i = +chip.closest('.boxcard').dataset.i; const it = state.items[i]; const k = +chip.dataset.o;
      const on = allowedIdx(it);
      if (on.includes(k)) { if (on.length === 1) return; it.orients = on.filter((x) => x !== k); } else it.orients = [...on, k].sort();
      paintOrients(chip.closest('.boxcard'), it, i);
      if (state.mode === 'semi') paintSteps();
      schedule(); return;
    }
    const d = e.target.closest('[data-del]'); if (!d) return;
    const di = +d.closest('.boxcard').dataset.i;
    state.items.splice(di, 1);
    state.steps = state.steps.filter((st) => st.item !== di).map((st) => (st.item > di ? { ...st, item: st.item - 1 } : st));
    paintBoxes(); paintMode(); schedule();
  });

  // ---------- engine ----------
  const worker = new Worker(new URL('./pack-worker.js', import.meta.url), { type: 'module' });
  let reqId = 0, timer = 0, last = null;
  function engineInput() {
    const c = state.cont;
    const ms = state.stack === 'interlock' ? state.support : 1; // support rule for the plan, its check and hand edits
    if (mode === 'pallet') {
      const oh = c.overhang || 0;
      return { container: { L: c.L + 2 * oh, W: c.W + 2 * oh, H: Math.max(0, c.H - (c.palletH || 0)), maxWeight: c.maxWeight, minSupport: ms }, offset: oh };
    }
    return { container: { L: c.L, W: c.W, H: c.H, maxWeight: c.maxWeight, doorW: c.doorW, doorH: c.doorH, minSupport: ms }, offset: 0 };
  }
  const engineItems = () => state.items.map((it) => ({ l: it.l, w: it.w, h: it.h, weight: it.weight, qty: it.qty, rotation: it.rotation, orients: it.rotation === 'custom' ? allowedIdx(it) : undefined, stackable: it.stackable !== false,
    maxOnTop: it.stackable !== false && Number.isFinite(+it.maxOnTop) && it.maxOnTop !== null && it.maxOnTop !== '' ? Math.max(0, Math.floor(+it.maxOnTop)) : null,
    maxLoad: it.stackable !== false && it.maxLoad !== null && it.maxLoad !== '' && Number.isFinite(+it.maxLoad) && +it.maxLoad >= 0 ? +it.maxLoad : null, name: it.name }));
  function schedule() {
    if (ed) { ed = null; edNotice = 'Your hand edits were cleared because the inputs changed.'; clearEditView(); }
    clearTimeout(timer); root.querySelector('[data-result]').classList.add('busy'); paintStack();
    timer = setTimeout(run, 250);
    writeHash();
  }
  function run() {
    const { container } = engineInput();
    const opts = { priority: !!state.priority, timeMs: 1200, pallet: mode === 'pallet', stack: state.stack };
    if (state.mode === 'semi') { opts.steps = state.steps.map((st) => ({ item: st.item, qty: st.qty, orient: st.orient, newSection: !!st.newSection })); opts.fillRest = state.fillRest !== false; }
    curStops = stopSteps();
    if (curStops) { opts.steps = curStops.map(({ stop, ...x }) => x); opts.fillRest = false; }
    worker.postMessage({ id: ++reqId, kind: 'pack', container, items: engineItems(), opts });
  }
  // ---------- delivery stops (container mode, fully automatic): the last stop is loaded first, at the back,
  // and each stop starts a new section in front of the one before, so stop 1 ends up at the door ----------
  let curStops = null;
  const stopOf = (it) => (it.stop != null && it.stop !== '' && Number.isInteger(+it.stop) && +it.stop >= 1 ? +it.stop : Infinity);
  const stopLabel = (s) => (s === Infinity ? 'No stop' : `Stop ${s}`);
  function stopSteps() {
    if (mode !== 'container' || state.mode === 'semi') return null;
    const live = state.items.map((it, i) => ({ i, s: stopOf(it) })).filter((x) => (state.items[x.i].qty || 0) > 0);
    const keys = [...new Set(live.map((x) => x.s))].sort((a, b) => b - a); // no stop (delivered last) first, then the highest number
    if (keys.length < 2) return null;
    const out = [];
    keys.forEach((s, g) => live.filter((x) => x.s === s).forEach((x, j) => out.push({ item: x.i, qty: null, orient: null, newSection: g > 0 && j === 0, stop: s })));
    return out;
  }
  const toView = (d) => {
    const list = [];
    for (let i = 0; i < d.buf.length; i += 8) list.push({ k: d.buf[i], x: d.buf[i + 1], y: d.buf[i + 2], z: d.buf[i + 3], dx: d.buf[i + 4], dy: d.buf[i + 5], dz: d.buf[i + 6], s: d.buf[i + 7] });
    return { cont: d.cont, boxes: list, steps: d.steps, errors: d.errors, pallet: d.pallet || null, stack: d.stack || null };
  };
  worker.onmessage = (e) => {
    if (e.data.id !== reqId) return;
    if (e.data.kind === 'fill') { fillDone(toView(e.data)); return; }
    last = toView(e.data); last.part = 0; last.stops = curStops;
    plans = [last]; shown = 0; multiDone = false;
    if (!ed) render(last); else root.querySelector('[data-result]').classList.remove('busy');
    nextPart(); paintMulti(); compare();
  };

  // ---------- several units of the same size (container mode) ----------
  // What one container cannot take is planned into the next one of the same size, one at a time in the
  // worker, until everything is loaded, a unit takes nothing more, or MAX_UNITS. Semi-automatic steps apply
  // to the first unit; the others are loaded automatically. Hand editing works on the first unit.
  const MAX_UNITS = 20;
  // a worker of its own, so a new plan never waits behind the later units
  const partWorker = mode === 'container' ? new Worker(new URL('./pack-worker.js', import.meta.url), { type: 'module' }) : null;
  if (partWorker) partWorker.onmessage = (e) => { if (e.data.id === reqId && e.data.part === plans.length) partDone(toView(e.data)); };
  let plans = [], shown = 0, multiDone = true;
  const multiOn = () => mode === 'container' && !(state.mode === 'semi' && state.fillRest === false);
  const qtyOf = () => state.items.map((it) => Math.max(0, it.qty || 0));
  const leftBefore = (i) => { const q = qtyOf(); for (const p of plans.slice(0, i)) for (const b of p.boxes) q[b.k]--; return q.map((x) => Math.max(0, x)); };
  const nounOf = (id) => { const p = presets.find((x) => x.id === id); const t = p ? p.name : ''; return /truck/i.test(t) ? 'truck' : /trailer|dry van|reefer/i.test(t) ? 'trailer' : 'container'; };
  const unitName = () => presets.find((x) => x.id === state.cont.preset)?.name || 'this size';
  function nextPart() {
    const left = leftBefore(plans.length);
    if (!multiOn() || plans.length >= MAX_UNITS || !left.some((q) => q > 0) || plans.some((p) => p.errors.length)) { multiDone = true; return; }
    const items = engineItems().map((it, k) => ({ ...it, qty: left[k] }));
    const opts = { priority: !!state.priority, timeMs: 800, pallet: false, stack: state.stack };
    if (curStops) { opts.steps = curStops.map(({ stop, ...x }) => x); opts.fillRest = false; }
    partWorker.postMessage({ id: reqId, kind: 'pack', part: plans.length, container: engineInput().container, items, opts });
  }
  function partDone(v) {
    if (v.boxes.length) { v.part = plans.length; v.stops = curStops; plans.push(v); nextPart(); }
    else { multiDone = true; if (!ed && shown === plans.length - 1) render({ ...plans[shown], keep: true }); } // what is left fits in none: say so on the last unit
    paintMulti(); paintFit(); mixCheck();
  }
  function mixLine() {
    if (!mix || !mix.hit || plans.length < 2) return '';
    const p = presets.find((x) => x.id === mix.hit); if (!p) return '';
    const n = plans[plans.length - 1].boxes.length;
    return ` <span class="mixline">Or <strong>${plans.length - 1} × ${esc(unitName())} + 1 × ${esc(p.name)}</strong>: the last ${fmt(n)} box${n === 1 ? '' : 'es'} also fit in a ${esc(p.name)} (quick check; choose it to plan the rest on its own).</span>`;
  }
  function paintMulti() {
    const bar = $('[data-multi]'); if (!bar) return;
    const total = qtyOf().reduce((a, b) => a + b, 0);
    const pending = !multiDone;
    const many = !ed && (plans.length > 1 || (pending && plans.length === 1));
    bar.hidden = !many;
    const noun = nounOf(state.cont.preset);
    R('mainK').textContent = many ? `Boxes in ${noun} ${shown + 1} of ${pending ? plans.length + '+' : plans.length}` : 'Boxes loaded';
    if (!many) { R('leftK').textContent = 'Boxes left over'; return; }
    const left = leftBefore(plans.length).reduce((a, b) => a + b, 0);
    R('leftK').textContent = pending ? 'Boxes for the next one' : `Left after ${plans.length} ${noun}s`;
    R('left').textContent = fmt(left);
    const counts = plans.map((p) => fmt(p.boxes.length)).join(' + ');
    $('[data-multitxt]').innerHTML = pending
      ? `More than one ${noun} is needed. Planning ${noun} ${plans.length + 1}… (${counts} so far)`
      : left === 0
        ? `All ${fmt(total)} boxes need <strong>${plans.length} × ${esc(unitName())}</strong>: ${counts}. Tap a number to see that ${noun}.${mixLine()}`
        : plans.length >= MAX_UNITS
          ? `${fmt(total - left)} of ${fmt(total)} boxes in ${plans.length} × ${esc(unitName())} (${counts}); the planner stops at ${MAX_UNITS}. Choose a bigger size or split the order.`
          : `${fmt(total - left)} of ${fmt(total)} boxes in ${plans.length} × ${esc(unitName())} (${counts}); ${nBoxes(left)} fit in none of them (see the notes).`;
    $('[data-multibtns]').innerHTML = plans.map((p, i) => `<button type="button" data-unit="${i}" aria-pressed="${i === shown}" aria-label="Show ${noun} ${i + 1}">${i + 1}</button>`).join('') + (pending ? '<button type="button" disabled aria-label="Planning the next one">…</button>' : '');
  }
  if ($('[data-multi]')) $('[data-multibtns]').addEventListener('click', (e) => {
    const b = e.target.closest('[data-unit]'); if (!b || ed) return;
    shown = +b.dataset.unit; render(plans[shown]);
  });

  // ---------- which size fits: a quick check of every preset with the same boxes (container mode) ----------
  const fitBox = $('[data-fit]');
  const cmpWorker = fitBox ? new Worker(new URL('./pack-worker.js', import.meta.url), { type: 'module' }) : null;
  let cmpId = 0, cmpKey = '', cmpRes = {}, cmpQueue = [];
  const CMP_MAX = 12; const rid = Math.random().toString(36).slice(2, 7);
  function compare() {
    if (!cmpWorker) return;
    const items = engineItems(); const ms = engineInput().container.minSupport;
    const key = JSON.stringify([items, state.stack, ms, !!state.priority]);
    if (key === cmpKey) { paintFit(); return; }
    cmpKey = key; cmpRes = {}; cmpId++; cmpQueue = presets.slice(); paintFit(); cmpNext();
  }
  function cmpNext() {
    const p = cmpQueue.shift(); if (!p) return;
    const items = engineItems();
    cmpWorker.postMessage({ id: cmpId, kind: 'many', key: p.id, container: { L: p.L, W: p.W, H: p.H, maxWeight: p.payload, doorW: p.doorW, doorH: p.doorH, minSupport: engineInput().container.minSupport }, items, opts: { priority: !!state.priority, timeMs: 150, stack: state.stack, max: CMP_MAX } });
  }
  if (cmpWorker) cmpWorker.onmessage = (e) => {
    if (e.data.kind === 'fitone') { if (e.data.id === mixId) { mix = { key: mixKey, hit: e.data.hit }; paintMulti(); } return; }
    if (e.data.id !== cmpId) return; cmpRes[e.data.key] = e.data; paintFit(); cmpNext();
  };
  // several units: could the last one be a smaller size of the same kind? (e.g. 3 × 40' HC + 1 × 20')
  let mixId = 0, mixKey = '', mix = null;
  function mixCheck() {
    if (!cmpWorker || plans.length < 2 || !multiDone || ed) return;
    const lastQ = leftBefore(plans.length - 1); const left = leftBefore(plans.length).reduce((a, b) => a + b, 0);
    if (left) return;
    const sel = presets.find((x) => x.id === state.cont.preset); if (!sel) return;
    const vol = (p) => p.L * p.W * p.H; const noun = nounOf(sel.id);
    const smaller = presets.filter((p) => p.id !== sel.id && nounOf(p.id) === noun && vol(p) < vol(sel)).sort((a, b) => vol(a) - vol(b));
    if (!smaller.length) return;
    const key = JSON.stringify([state.cont.preset, lastQ, engineItems().map((it) => [it.l, it.w, it.h, it.weight, it.rotation, it.maxOnTop, it.maxLoad]), state.stack, curStops ? 1 : 0]);
    if (key === mixKey) return;
    mixKey = key; mix = null;
    const ms = engineInput().container.minSupport;
    const opts = { priority: !!state.priority, timeMs: 300, stack: state.stack, containers: smaller.map((p) => ({ id: p.id, L: p.L, W: p.W, H: p.H, maxWeight: p.payload, doorW: p.doorW, doorH: p.doorH, minSupport: ms })) };
    if (curStops) { opts.steps = curStops.map(({ stop, ...x }) => x); opts.fillRest = false; }
    cmpWorker.postMessage({ id: ++mixId, kind: 'fitone', key, items: engineItems().map((it, k) => ({ ...it, qty: lastQ[k] })), opts });
  }
  // the selected size shows the full plan above (fully automatic, not hand-edited), so its row matches the result
  function mainRow() {
    if (state.mode !== 'auto' || !multiDone || !plans.length) return null;
    const c = plans[0].cont; const cv = c.L * c.W * c.H;
    const vol = plans[0].boxes.reduce((t, b) => t + b.dx * b.dy * b.dz, 0);
    const wt = plans[0].boxes.reduce((t, b) => t + (state.items[b.k]?.weight || 0), 0);
    return { units: plans.length, first: plans[0].boxes.length, vol: cv > 0 ? vol / cv : 0, wt, left: leftBefore(plans.length).reduce((a, b) => a + b, 0), full: true, max: MAX_UNITS };
  }
  // the size's payload (not its space) is what stops the first unit: say so, or a bigger size taking fewer boxes looks wrong
  const payFull = (p, r) => { const cap = p.id === 'custom' ? state.cont.maxWeight : p.payload; return cap > 0 && r.wt > 0 && r.wt >= cap * 0.97; };
  function paintFit() {
    if (!fitBox) return;
    const total = qtyOf().reduce((a, b) => a + b, 0);
    const sel = state.cont.preset;
    const rows = presets.map((p) => ({ p, r: p.id === sel ? mainRow() || cmpRes[p.id] : cmpRes[p.id] }));
    if (!presets.some((p) => p.id === sel)) { const r = mainRow(); if (r) rows.unshift({ p: { id: 'custom', name: 'Your size', L: state.cont.L, W: state.cont.W, H: state.cont.H }, r }); }
    const done = rows.filter((x) => x.r && !x.r.bad);
    const vol = (p) => p.L * p.W * p.H;
    const one = done.filter((x) => x.r.units === 1 && x.r.left === 0).sort((a, b) => vol(a.p) - vol(b.p))[0];
    const fewest = done.filter((x) => x.r.left === 0).sort((a, b) => a.r.units - b.r.units || a.r.units * vol(a.p) - b.r.units * vol(b.p))[0];
    const best = one || fewest;
    const checking = rows.some((x) => !x.r);
    $('[data-fittxt]').innerHTML = !total ? 'Enter your boxes to compare sizes.'
      : one ? `Smallest that takes all ${fmt(total)} boxes: <strong>${esc(one.p.name)}</strong> (${fmt(one.r.vol * 100, 0)}% of its volume used).${checking ? ' Still checking the other sizes…' : ''}`
        : fewest ? `None of these takes all ${fmt(total)} boxes in one. Fewest: <strong>${fewest.r.units} × ${esc(fewest.p.name)}</strong>.${checking ? ' Still checking…' : ''}`
          : checking ? 'Checking each size…' : `None of these takes all ${fmt(total)} boxes in ${CMP_MAX} or fewer.`;
    $('[data-fittable]').innerHTML = rows.map(({ p, r }) => {
      const isSel = p.id === sel || p.id === 'custom';
      const name = `${esc(p.name)}${isSel ? ' <span class="small">(selected)</span>' : ''}`;
      const pick = p.id === 'custom' ? '<td class="selcol"><span class="selmark" aria-hidden="true">●</span></td>' : `<td class="selcol"><label class="selradio"><input type="radio" name="fitsel-${rid}" data-usepreset="${esc(p.id)}"${isSel ? ' checked' : ''} aria-label="Select ${esc(p.name)} and plan it"></label></td>`;
      const cls = [p.id === sel || p.id === 'custom' ? 'sel' : '', best && best.p.id === p.id ? 'best' : ''].join(' ').trim();
      if (!r) return `<tr class="${cls}">${pick}<td>${name}</td><td class="num">…</td><td class="num">…</td></tr>`;
      if (r.bad) return `<tr class="${cls}">${pick}<td>${name}</td><td class="num" colspan="2">check failed</td></tr>`;
      const need = r.left === 0 ? fmt(r.units) : r.units >= (r.max || CMP_MAX) ? `${fmt(r.units)}+` : `${fmt(r.units)}<div class="small">${fmt(r.left)} never fit</div>`;
      return `<tr class="${cls}">${pick}<td>${name}</td><td class="num">${fmt(r.first)}<div class="small">${fmt(r.vol * 100, 0)}% full${payFull(p, r) ? '<br><span class="payfull">payload max</span>' : ''}</div></td><td class="num">${r.first ? need : '–'}</td></tr>`;
    }).join('');
    const selP = presets.find((x) => x.id === sel); const mr = mainRow();
    $('[data-fitsel]').innerHTML = !total ? '' : !mr || root.querySelector('[data-result]').classList.contains('busy')
      ? `Planning ${esc(selP ? selP.name : 'your size')}…`
      : `<strong>${esc(selP ? selP.name : 'Your size')}</strong> is selected: ${fmt(mr.first)} of ${fmt(total)} boxes in one${mr.units > 1 ? `, ${mr.left ? `${fmt(mr.units)}${mr.units >= MAX_UNITS ? '+' : ''}` : fmt(mr.units)} needed for all` : ''}, ${fmt(mr.vol * 100, 0)}% of its volume used. The result, 3D plan and loading list above show this size. <a href="#" data-goresult>See the plan ↑</a>`;
    $('[data-fitnote]').innerHTML = `Same boxes, ${state.stack === 'interlock' ? 'stacking pattern' : 'column stacks'} and rules in each size, fully automatic${state.mode === 'semi' ? ' (your loading steps are not used here)' : ''}. Other sizes get a quick plan of a fraction of a second each; tap a size to plan it fully above, where the count can come out a little higher. ★ marks the suggestion. “One takes”: boxes in one, and how full that one is by volume; <strong>payload max</strong> means that size's payload, not its space, stops it, so a bigger truck with a lower payload can take fewer boxes; “Needed”: how many of that size take the whole load (12+ = more than 12). Payload and door limits are the presets' own.`;
  }
  if (fitBox) fitBox.addEventListener('click', (e) => {
    if (e.target.closest('[data-goresult]')) { e.preventDefault(); root.querySelector('[data-result]').scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
    const b = e.target.closest('[data-usepreset]'); if (!b) return;
    if (b.dataset.usepreset === state.cont.preset) return;
    // plan the chosen size at once and stay here: the selected row and the line under the table show its full plan
    const sel = f('preset'); sel.value = b.dataset.usepreset; sel.dispatchEvent(new Event('change', { bubbles: true }));
    paintFit();
  });

  // ---------- results ----------
  let view = null, boxes = [];
  const viewHost = $('[data-view]');
  async function ensureView() {
    if (view) return view;
    const { createView } = await import('./view3d.js');
    view = createView(viewHost);
    view.onPick(onPick);
    root.querySelectorAll('[data-view-btn]').forEach((b) => b.addEventListener('click', () => {
      root.querySelectorAll('[data-view-btn]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      view.aim(b.dataset.viewBtn);
    }));
    return view;
  }
  const step = $('[data-step]');
  // the step being looked at: show boxes up to it and outline the last one (only while stepping, not at the full plan)
  const showStep = () => {
    const v = +step.value;
    if (view) { view.setStep(v); view.setStepBox(v > 0 && v < boxes.length ? boxes[v - 1] : null); }
    stepText();
  };
  step.addEventListener('input', showStep);
  root.querySelectorAll('[data-stepbtn]').forEach((b) => b.addEventListener('click', () => {
    const v = Math.max(0, Math.min(boxes.length, +step.value + +b.dataset.stepbtn));
    if (v === +step.value) return;
    step.value = String(v); showStep();
  }));
  const stepText = () => {
    const v = +step.value; const b = boxes[v - 1];
    const dd = lastList && lastList.d;
    const stTxt = !ed && b && b.s >= 0 && dd && dd.steps ? (dd.steps[b.s].auto ? ' · automatic part' : dd.stops ? ` · ${stopLabel(dd.stops[b.s].stop).toLowerCase()}` : ` · step ${b.s + 1}`) : '';
    const it = b ? state.items[b.k] : null; const o = it ? orientOf(it, b) : -1;
    const what = b && it && v < boxes.length ? ` · last: ${it.name || 'box'}${o >= 0 ? ` (${SHORT[o]})` : ''}` : '';
    R('stepTxt').textContent = `${fmt(v)} of ${fmt(boxes.length)} boxes${stTxt}${what}`;
    root.querySelectorAll('[data-stepbtn]').forEach((x) => { x.disabled = +x.dataset.stepbtn < 0 ? v <= 0 : v >= boxes.length; });
  };

  async function render(d) {
    if (!d) return;
    root.querySelector('[data-result]').classList.remove('busy');
    const u = U[units];
    const ordQ = d.part ? leftBefore(d.part) : qtyOf(); // boxes still to load when this unit starts
    const ordered = ordQ.reduce((s, q) => s + q, 0);
    const totalOrdered = qtyOf().reduce((s, q) => s + q, 0);
    // loading list: sections from the back wall, layers from the floor; its order is the slider's order
    const il = d.stack && d.stack.pattern === 'interlock' && d.stack.section && !d.edited ? { S: d.stack.section, k: d.stack.sections } : null;
    const ll = loadList(d.boxes, state.items, { pallet: mode === 'pallet', wall: il, orientOf });
    d.boxes = ll.order; boxes = d.boxes; lastList = { ll, d };
    const perItem = state.items.map(() => 0);
    let tv = 0, tw = 0, cxs = 0, cys = 0, czs = 0;
    for (const b of boxes) { perItem[b.k]++; tv += b.dx * b.dy * b.dz; const m = state.items[b.k]?.weight || 0; tw += m; cxs += m * (b.x + b.dx / 2); cys += m * (b.y + b.dy / 2); czs += m * (b.z + b.dz / 2); }
    const totals = { n: boxes.length, vol: tv, w: tw };
    const cog = tw > 0 ? { x: cxs / tw, y: cys / tw, z: czs / tw } : null;
    const contVol = d.cont.L * d.cont.W * d.cont.H;
    const n = totals.n;
    $('#r-main').textContent = `${fmt(n)} of ${fmt(totalOrdered)}`;
    R('vol').textContent = contVol > 0 ? `${fmt(totals.vol / contVol * 100, 1)}%` : '0%';
    const wt = u.fromKG(totals.w);
    R('wt').textContent = `${fmt(wt, 0)} ${u.wt}`;
    R('left').textContent = fmt(ordered - n);
    const volLeft = Math.max(0, contVol - totals.vol);
    const vU = units === 'metric' ? 'm³' : 'ft³', toV = (mm3) => (units === 'metric' ? mm3 / 1e9 : mm3 / (304.8 ** 3));
    R('spaceLeft').textContent = `${fmt(toV(volLeft), 2)} ${vU}`;
    const palKg = mode === 'pallet' ? +state.cont.palletWt || 0 : 0;
    if (mode === 'pallet') {
      R('gross').textContent = `${fmt(u.fromKG(totals.w + palKg), 0)} ${u.wt}`;
      R('grossSub').textContent = state.cont.palletWt == null ? 'Boxes only: no pallet weight entered (counted as 0)' : `${fmt(u.fromKG(totals.w), 1)} ${u.wt} boxes + ${fmt(u.fromKG(palKg), 1)} ${u.wt} pallet`;
    }
    R('wtLeft').textContent = d.cont.maxWeight > 0 ? `${fmt(u.fromKG(Math.max(0, d.cont.maxWeight - totals.w)), 0)} ${u.wt}` : 'No limit set';
    // warnings
    const w = [];
    if (edNotice && !d.edited) { w.push(edNotice); edNotice = ''; }
    if (d.errors.length) w.push(`The plan failed its own check (${d.errors.join(', ')}). Please report these inputs through the contact page.`);
    const semi = !!d.steps;
    const asked = semi ? d.steps.reduce((t, st) => t + st.asked, 0) : ordered;
    // boxes no step asked for (only when the automatic last step is off)
    const hasAuto = !semi || d.steps.some((st) => st.auto);
    const unasked = semi ? Math.max(0, ordered - asked) : 0;
    if (!hasAuto && unasked > 0) w.push(`${nBoxes(unasked)} ${unasked === 1 ? 'is' : 'are'} not in any step. Add a step for them, or tick “Then load whatever is left automatically”.`);
    const notFit = d.edited ? 0 : hasAuto ? ordered - n : asked - n;
    if (d.edited && ordered - n > 0) w.push(`${nBoxes(ordered - n)} ${ordered - n === 1 ? 'is' : 'are'} not loaded yet. Place them by hand, or tap “Fill the rest automatically”.`);
    const nextOne = !d.edited && multiOn() && notFit > 0 && (d.part < plans.length - 1 || !multiDone);
    if (nextOne) w.push(`${nBoxes(notFit)} ${notFit === 1 ? 'does' : 'do'} not fit in this ${nounOf(state.cont.preset)}: ${notFit === 1 ? 'it goes' : 'they go'} into the next one (numbers above the 3D view).`);
    else if (notFit > 0) {
      const byWeight = d.cont.maxWeight > 0 && totals.w > d.cont.maxWeight * 0.98;
      w.push(byWeight ? `Weight limit reached: ${nBoxes(notFit)} stay${notFit === 1 ? 's' : ''} out because the load would exceed ${fmt(u.fromKG(d.cont.maxWeight))} ${u.wt}.` : `${nBoxes(notFit)} ${notFit === 1 ? 'does' : 'do'} not fit ${mode === 'pallet' ? 'on this pallet' : 'in this space'}${semi ? ' with these steps' : ''}${mode === 'pallet' && !semi && state.items.length === 1 ? ' (see “Pallets for your quantity”)' : ''}.`);
    }
    if (semi) d.steps.forEach((st, si) => {
      if (st.auto) return;
      const cfg = (d.stops || state.steps)[si]; const name = esc(state.items[cfg?.item]?.name || 'this box type');
      const sl = d.stops ? stopLabel(d.stops[si].stop) : `Step ${si + 1}`;
      if (st.asked === 0) { if (!d.stops) w.push(`${sl} has nothing to load: no “${name}” are left for it.`); }
      else if (st.loaded < st.asked) w.push(`${sl} loaded ${fmt(st.loaded)} of ${fmt(st.asked)} “${name}”: the rest do not fit in the space left${cfg?.orient != null ? ' in the position chosen' : ''}.`);
    });
    state.items.forEach((it, i) => {
      const dims = [it.l, it.w, it.h];
      if (hasAuto && !d.edited && ordQ[i] > 0 && perItem[i] === 0 && !(d.part < plans.length - 1 || !multiDone)) w.push(`“${esc(it.name)}” could not be placed at all — check its size against the ${mode === 'container' ? 'inside dimensions and the door opening' : 'pallet size, overhang and max height'}.`);
      if (!dims.every((x) => x > 0)) w.push(`“${esc(it.name)}” needs a length, width and height.`);
    });
    if (cog && n && mode === 'pallet') {
      const ln = (mm) => `${fmt(u.fromMM(mm), units === 'metric' ? 1 : 2)} ${u.len}`;
      w.push(`Centre of gravity of the load: ${ln(Math.abs(cog.x - d.cont.L / 2))} off the middle along the length, ${ln(Math.abs(cog.y - d.cont.W / 2))} across the width, ${ln(cog.z)} above the pallet deck. Keep heavy boxes low and the load centred.`);
    } else if (cog && n) {
      const off = (cog.x - d.cont.L / 2) / d.cont.L * 100;
      w.push(`Centre of gravity of the cargo: ${fmt(u.fromMM(cog.x), units === 'metric' ? 0 : 1)} ${u.len} from the back wall (${off >= 0 ? fmt(off, 0) + '% toward the door' : fmt(-off, 0) + '% toward the back'} from the middle). Keep heavy cargo low and the load spread evenly.`);
    }
    const lims = state.items.filter((it) => it.stackable !== false && ((it.maxOnTop != null && it.maxOnTop !== '') || (it.maxLoad != null && it.maxLoad !== '')));
    if (lims.length && !d.errors.length) w.push(`Stacking limits kept: ${lims.map((it) => `“${esc(it.name)}” ${[it.maxOnTop != null && it.maxOnTop !== '' ? `at most ${fmt(+it.maxOnTop)} box${+it.maxOnTop === 1 ? '' : 'es'} on top` : '', it.maxLoad != null && it.maxLoad !== '' ? `at most ${fmt(u.fromKG(+it.maxLoad), 1)} ${u.wt} on top` : ''].filter(Boolean).join(' and ')}`).join('; ')}. Boxes that would break a limit are left out or placed elsewhere.`);
    R('warn').innerHTML = w.map((x) => `<p class="warn">${x}</p>`).join('');
    paintStackResult(d, n);
    // table
    const used = (list) => { // "H up · L along: 540, L up · W across: 120"
      const c = new Map();
      for (const b of list) { const o = orientOf(state.items[b.k], b); c.set(o, (c.get(o) || 0) + 1); }
      return [...c.entries()].sort((a, b) => b[1] - a[1]).map(([o, m]) => `${o >= 0 ? SHORT[o] : '?'}: ${fmt(m)}`).join('<br>') || '–';
    };
    R('table').innerHTML = state.items.map((it, i) => `<tr><td><i style="display:inline-block;width:12px;height:12px;border-radius:3px;background:${SWATCH[i % SWATCH.length]};margin-right:6px"></i>${esc(it.name)}</td><td class="num">${fmt(ordQ[i])}</td><td class="num">${fmt(perItem[i])}</td><td class="num">${fmt(Math.max(0, ordQ[i] - perItem[i]))}</td><td class="num">${fmt(u.fromKG(perItem[i] * it.weight))} ${u.wt}</td><td style="white-space:nowrap">${used(boxes.filter((b) => b.k === i))}</td></tr>`).join('');
    R('stepbox').hidden = !semi || !!d.edited;
    R('stepTh').textContent = d.stops ? 'Stop' : 'Step';
    if (d.stops && !d.edited) {
      const ord = [...new Set(d.stops.map((x) => x.stop))];
      w.splice(w.length - (w.length && /^Centre of gravity/.test(w[w.length - 1]) ? 1 : 0), 0, `Loaded by delivery stop: ${ord.map(stopLabel).join(', then ')}, from the back wall toward the door, each stop in its own section, so the first stop is unloaded first at the door.`);
      R('warn').innerHTML = w.map((x) => `<p class="warn">${x}</p>`).join('');
    }
    R('steptable').innerHTML = semi ? d.steps.map((st, si) => {
      const cfg = st.auto ? null : (d.stops || state.steps)[si];
      const label = st.auto ? 'Rest' : d.stops ? stopLabel(d.stops[si].stop) : String(si + 1);
      const type = st.auto ? 'Everything left' : esc(state.items[cfg?.item]?.name || '');
      const pos = cfg && cfg.orient != null ? SHORT[cfg.orient] : `Automatic${st.loaded ? '<br><span class="small">' + used(boxes.filter((b) => b.s === si)) + '</span>' : ''}`;
      return `<tr><td>${label}${cfg?.newSection ? ' <span class="small">(new section)</span>' : ''}</td><td>${type}</td><td style="white-space:nowrap">${pos}</td><td class="num">${fmt(st.asked)}</td><td class="num">${fmt(st.loaded)}</td></tr>`;
    }).join('') : '';
    R('legend').innerHTML = state.items.map((it, i) => `<span><i style="background:${SWATCH[i % SWATCH.length]}"></i>${esc(it.name)}: ${fmt(perItem[i])}</span>`).join('');
    // formula steps with live numbers
    const L = u.fromMM(d.cont.L), W = u.fromMM(d.cont.W), H = u.fromMM(d.cont.H);
    const volU = units === 'metric' ? 'm³' : 'ft³';
    const toVol = (mm3) => (units === 'metric' ? mm3 / 1e9 : mm3 / (304.8 ** 3));
    const c0 = state.cont; const lnF = (mm) => fmt(u.fromMM(mm), units === 'metric' ? 1 : 2);
    const stk = d.stack && d.stack.pattern === 'interlock' && !d.edited ? d.stack : null;
    R('steps').innerHTML = [
      ...(mode === 'pallet' ? [`Load space = (${lnF(c0.L)} + 2 × ${lnF(c0.overhang || 0)}) × (${lnF(c0.W)} + 2 × ${lnF(c0.overhang || 0)}) ${u.len} footprint, ${lnF(c0.H)} − ${lnF(c0.palletH || 0)} = ${lnF(d.cont.H)} ${u.len} high above the pallet deck`] : []),
      `${mode === 'container' ? 'Container' : 'Load space'} volume = ${fmt(L, 1)} × ${fmt(W, 1)} × ${fmt(H, 1)} ${u.len} = ${fmt(toVol(contVol), 2)} ${volU}`,
      ...(stk ? [`Interlocked layers: ${fmt(stk.perLayer[0])} and ${fmt(stk.perLayer[1])} boxes alternating, ${fmt(stk.layers)} layers of ${lnF(stk.dz)} ${u.len}${stk.section ? `, in walls ${lnF(stk.section)} ${u.len} long (${fmt(stk.sections)} full wall${stk.sections === 1 ? '' : 's'}, then the space in front filled automatically)` : ''}`] : []),
      `Cargo loaded = ${fmt(n)} boxes = ${fmt(toVol(totals.vol), 2)} ${volU}`,
      `Volume used = ${fmt(toVol(totals.vol), 2)} ÷ ${fmt(toVol(contVol), 2)} = ${contVol > 0 ? fmt(totals.vol / contVol * 100, 1) : 0}%`,
      `Space left = ${fmt(toVol(contVol), 2)} − ${fmt(toVol(totals.vol), 2)} = ${fmt(toVol(Math.max(0, contVol - totals.vol)), 2)} ${volU} (${contVol > 0 ? fmt((contVol - totals.vol) / contVol * 100, 1) : 0}% of the ${mode === 'container' ? 'container' : 'load space'})`,
      d.cont.maxWeight > 0 ? `Weight = ${fmt(wt)} ${u.wt} of ${fmt(u.fromKG(d.cont.maxWeight))} ${u.wt} allowed (${fmt(totals.w / d.cont.maxWeight * 100, 1)}%), ${fmt(u.fromKG(Math.max(0, d.cont.maxWeight - totals.w)))} ${u.wt} left` : `Weight = ${fmt(wt)} ${u.wt} (no limit entered)`,
      ...(mode === 'pallet' ? [`Gross weight incl. pallet = ${fmt(wt, 1)} ${u.wt} boxes + ${fmt(u.fromKG(palKg), 1)} ${u.wt} pallet = ${fmt(u.fromKG(totals.w + palKg), 1)} ${u.wt}${state.cont.palletWt == null ? ' (no pallet weight entered)' : ''}`] : []),
    ].join('<br>');
    roomFor(d);
    paintLoadList();
    if (mode === 'pallet') paintPallet(d);
    // 3D
    const { offset } = engineInput();
    step.max = String(boxes.length); step.value = String(boxes.length); stepText();
    const v = await ensureView();
    v.setPlan({ cont: d.cont, boxes, colors: SWATCH, offset, inner: innerOf, vehicle: mode === 'container' && nounOf(state.cont.preset) === 'truck' ? 'truck' : 'tractor', keepCamera: !!d.edited || !!d.keep, pallet: mode === 'pallet' ? { L: state.cont.L, W: state.cont.W, H: state.cont.palletH || 0 } : null });
    paintEditor();
    drawnPlan = d; if (picsOn) paintPics();
    R('ordTh').textContent = d.part ? 'Still to load' : 'Ordered';
    $('[data-editor]').hidden = !!d.part; // hand editing works on the first unit
    paintMulti();
  }


  // ---------- loading list (sections along the length, layers from the floor up; see loadlist.js) ----------
  let lastList = null, llAll = false;
  const LL_FEW = 2; // sections shown before "Show all" on long lists
  const stepName = (s) => (s < 0 || !lastList?.d.steps ? '' : lastList.d.steps[s]?.auto ? 'Automatic part' : lastList.d.stops ? stopLabel(lastList.d.stops[s]?.stop) : `Step ${s + 1}`);
  function paintLoadList() {
    if (!lastList) return;
    const { ll, d } = lastList; const u = U[units];
    const off = engineInput().offset; const dp = units === 'metric' ? 1 : 2;
    const ln = (mm) => fmt(u.fromMM(mm), dp);
    const wt = (kg) => `${fmt(u.fromKG(kg), 0)} ${u.wt}`;
    const pal = mode === 'pallet';
    R('llAlong').textContent = `From back ${pal ? 'edge' : 'wall'} (${u.len})`;
    R('llAcross').textContent = `From right ${pal ? 'edge' : 'wall'} (${u.len})`;
    const il = d.stack && d.stack.pattern === 'interlock' && d.stack.section && !d.edited;
    R('llnote').textContent = !ll.n ? 'Nothing is loaded yet.' : pal
      ? `Load the pallet layer by layer from the deck up. In each layer place the groups in the order listed, each from the back edge and from the right-hand edge as seen from the front (the Front view). Distances in ${u.len} from the pallet edges. The loading step slider shows the same order.${state.cont.palletWt != null ? ` With the pallet (${fmt(u.fromKG(+state.cont.palletWt || 0), 1)} ${u.wt}), the loaded pallet weighs ${wt(d.boxes.reduce((t, b) => t + (state.items[b.k]?.weight || 0), 0) + (+state.cont.palletWt || 0))}.` : ''}`
      : `Load section by section from the back wall toward the door, each section layer by layer from the floor up, and in each layer the groups in the order listed, starting at the back of the section and at the right-hand wall as seen from the door. ${il ? `The sections are the interlocked walls of ${ln(d.stack.section)} ${u.len}${ll.sections.length > d.stack.sections ? '; the boxes in front of the last wall follow' : ''}.` : 'A section ends where no box crosses the line across the load; where boxes of different lengths overlap, a section is about 120 cm long or more.'} Distances in ${u.len}. The loading step slider shows the same order.`;
    const many = ll.sections.length > LL_FEW + 1 && ll.sections.reduce((t, s) => t + s.layers.reduce((a, l) => a + l.groups.length, 0), 0) > 30;
    let html = ''; picList = [];
    const pics = picsOn || picsPrint;
    const picRow = (hide, alt, n, x0, x1) => { picList.push({ n, x0, x1 }); return `<tr class="llpic"${hide}><td colspan="7"><div class="llsecin"><img data-pic="${picList.length - 1}" alt="${esc(alt)}" width="640" height="400"></div></td></tr>`; };
    ll.sections.forEach((s, si) => {
      const hide = many && !llAll && si >= LL_FEW ? ' hidden' : '';
      const where = pal ? (ll.sections.length > 1 ? `Part ${si + 1}` : 'Pallet') : `Section ${si + 1} · ${ln(s.x0)}–${ln(s.x1)} ${u.len} from the back wall`;
      const stp = stepName(s.step);
      html += `<tr class="llsec"${hide}><th colspan="7"><div class="llsecin">${where}${stp ? ` · ${stp}` : ''} · ${fmt(s.n)} ${s.n === 1 ? 'box' : 'boxes'}, ${wt(s.w)}<span class="small"> · loaded so far: ${fmt(s.soFar)} ${s.soFar === 1 ? 'box' : 'boxes'}, ${wt(s.wSoFar)}</span></div></th></tr>`;
      if (pics && !pal) html += picRow(hide, `${where}: the load when this section is done, seen from the door side, the section framed in orange`, s.soFar, s.x0, s.x1);
      s.layers.forEach((l, li) => l.groups.forEach((g, gi) => {
        const lay = gi ? '' : `<td rowspan="${l.groups.length}"><strong>${fmt(li + 1)}</strong> <span class="small">${l.z < 0.5 ? (pal ? 'deck' : 'floor') : `${ln(l.z)} ${u.len} up`}</span></td>`;
        html += `<tr${hide}>${lay}<td><i class="sw" style="background:${SWATCH[g.k % SWATCH.length]}"></i>${esc(state.items[g.k]?.name)}</td><td style="white-space:nowrap">${g.o >= 0 ? SHORT[g.o] : '?'}</td><td class="num">${fmt(g.n)}</td><td class="num">${ln(g.x0 - off)}–${ln(g.x1 - off)}</td><td class="num">${ln(g.y0 - off)}–${ln(g.y1 - off)}</td><td class="num">${fmt(g.soFar)}</td></tr>`;
        if (pics && pal && gi === l.groups.length - 1) html += picRow(hide, `Layer ${li + 1}: the pallet when this layer is done`, g.soFar, null, null);
      }));
    });
    R('lltable').innerHTML = html || '<tr><td colspan="7">No boxes in the plan.</td></tr>';
    const more = $('[data-llmore]');
    more.hidden = !many;
    more.textContent = llAll ? `Show the first ${LL_FEW} sections only` : `Show all ${fmt(ll.sections.length)} ${pal ? 'parts' : 'sections'}`;
    more.setAttribute('aria-expanded', String(llAll));
    $('[data-llcsv]').disabled = !ll.n;
    const pb = $('[data-llpics]'); pb.setAttribute('aria-pressed', String(picsOn)); pb.textContent = picsOn ? 'Hide pictures' : 'Show pictures';
    if (pics) paintPics();
  }
  // ---------- pictures for the loading list (one per container section, or per pallet layer) ----------
  let picsOn = false, picsPrint = false, picList = [], picCache = { key: null, urls: [] }, drawnPlan = null;
  try { picsOn = localStorage.getItem('lpc-llpics') === '1'; } catch { /* storage blocked */ }
  function paintPics() {
    if (!view || !picList.length || !lastList || drawnPlan !== lastList.d) return; // only once the 3D view holds this plan
    const key = JSON.stringify(picList) + '|' + lastList.d.boxes.length + '|' + (lastList.d.part || 0) + '|' + (lastList.d.edited ? JSON.stringify(lastList.d.boxes.map((b) => [b.x, b.y, b.z])) : '');
    if (picCache.key !== key) picCache = { key, urls: view.shots(picList) };
    root.querySelectorAll('[data-pic]').forEach((img) => { img.src = picCache.urls[+img.dataset.pic] || ''; });
  }
  $('[data-llpics]').addEventListener('click', () => {
    picsOn = !picsOn; try { localStorage.setItem('lpc-llpics', picsOn ? '1' : '0'); } catch { /* ignore */ }
    paintLoadList();
  });
  // printed plans always carry the pictures
  window.addEventListener('beforeprint', () => { if (!picsOn && lastList) { picsPrint = true; paintLoadList(); } });
  window.addEventListener('afterprint', () => { if (picsPrint) { picsPrint = false; paintLoadList(); } });
  $('[data-llmore]').addEventListener('click', () => { llAll = !llAll; paintLoadList(); });
  $('[data-llcsv]').addEventListener('click', () => {
    if (!lastList || !lastList.ll.n) return;
    const u = U[units];
    const csv = loadListCsv(lastList.ll, {
      lenU: u.len, wtU: u.wt, pallet: mode === 'pallet', offset: engineInput().offset, stepName,
      fmtLen: (mm) => round(u.fromMM(mm), units === 'metric' ? 1 : 2), fmtWt: (kg) => round(u.fromKG(kg), 1),
      names: state.items.map((it, i) => it.name || `Box ${i + 1}`), pos: (o) => (o >= 0 ? SHORT[o] : '?'),
    });
    const url = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = 'loading-list.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  });

  // ---------- stacking: interlocked or column, and how well the layers are tied ----------
  // "Tied" = a box above the first layer that rests on two or more boxes below (each carrying at least
  // 10% of its base), so it holds those boxes together.
  function tiedShare(list) {
    const byTop = new Map();
    for (const b of list) { const k = Math.round((b.z + b.dz) * 100); if (!byTop.has(k)) byTop.set(k, []); byTop.get(k).push(b); }
    let up = 0, tied = 0;
    for (const a of list) {
      if (a.z < 0.01) continue;
      up++;
      const below = byTop.get(Math.round(a.z * 100)) || []; let m = 0;
      for (const b of below) {
        const ox = Math.min(a.x + a.dx, b.x + b.dx) - Math.max(a.x, b.x), oy = Math.min(a.y + a.dy, b.y + b.dy) - Math.max(a.y, b.y);
        if (ox > 0 && oy > 0 && ox * oy >= 0.1 * a.dx * a.dy) m++;
      }
      if (m >= 2) tied++;
    }
    return up ? tied / up : null;
  }
  function paintStackResult(d, n) {
    const set = (v, sub) => { R('stack').textContent = v; R('stackSub').textContent = sub; };
    const share = n ? tiedShare(d.boxes) : null;
    const tiedTxt = share == null ? 'All boxes stand on the floor.' : `${fmt(share * 100, 0)}% of the boxes above the first layer bridge two or more boxes below.`;
    const st = d.stack;
    if (d.edited) { set('Edited by hand', tiedTxt); return; }
    if (st && st.pattern === 'interlock') {
      const more = st.column > n ? ` Column stacks would load ${fmt(st.column - n)} more.` : '';
      set('Interlocked', `Layers alternate ${fmt(st.perLayer[0])} and ${fmt(st.perLayer[1])} boxes. ${tiedTxt}${more}`);
    } else if (st && st.interlock === 'none') {
      set('Column stacks', `These boxes cannot be interlocked here with ${fmt(state.support * 100)}% support${state.support === 1 ? ' (try 90% or 80%)' : ''}, so they stand in columns. ${tiedTxt}`);
    } else if (state.stack === 'interlock' && !canInterlock()) {
      set('Column stacks', `Interlocking is planned for one stackable box type in fully automatic mode. ${tiedTxt}`);
    } else set('Column stacks', `${tiedTxt} Hold column stacks together with wrapping or straps.`);
  }

  // ---------- pallet mode: Ti-Hi and pallets needed (one box type only) ----------
  // The engine (palletPack) builds a one-type pallet layer by layer and reports the full-pallet count
  // within the weight limit and its layers. Ti-Hi is only shown when every box sits on a clean layer line.
  function paintPallet(d) {
    const set = (k, v, sub = '') => { R(k).textContent = v; R(k + 'Sub').textContent = sub; };
    if (state.items.length !== 1) { set('tihi', '–', 'Shown for one box type. With mixed boxes, read the plan layer by layer in the Side view.'); set('pallets', '–', 'Shown for one box type.'); return; }
    if (d.edited) { set('tihi', '–', 'Not shown while you edit by hand.'); set('pallets', '–', ''); return; }
    const P = d.pallet; const qty = state.items[0].qty;
    if (state.mode === 'semi') { set('tihi', '–', 'Shown in fully automatic mode.'); set('pallets', '–', ''); return; }
    if (!P || !qty) { set('tihi', '–', 'Enter a box size and quantity.'); set('pallets', '–', ''); return; }
    const per = P.perPallet, lay = P.layers;
    if (!per) { set('tihi', '0', 'The box does not fit on this pallet.'); set('pallets', '–', ''); return; }
    const cap = P.weightLimited ? ' (max load weight reached)' : '';
    if (!lay || lay.mixed) set('tihi', '–', `No single Ti-Hi: the boxes stand in different positions (${fmt(per)} per pallet${cap}). Choose “this side up” for even layers.`);
    else if (lay.kind === 'alt') set('tihi', `${fmt(lay.ti)} / ${fmt(lay.ti2)} × ${fmt(lay.hi)}`, `${fmt(lay.hi)} interlocked layers alternating ${fmt(lay.ti)} and ${fmt(lay.ti2)} boxes = ${fmt(per)} per pallet${cap}`);
    else if (lay.kind === 'even') set('tihi', `${fmt(lay.ti)} × ${fmt(lay.hi)}`, `${fmt(lay.ti)} per layer, ${fmt(lay.hi)} layer${lay.hi === 1 ? '' : 's'} = ${fmt(per)} per pallet${cap}`);
    else if (lay.kind === 'top') set('tihi', `${fmt(lay.ti)} × ${fmt(lay.hi - 1)} + ${fmt(lay.top)}`, `${fmt(lay.hi - 1)} full layer${lay.hi === 2 ? '' : 's'} of ${fmt(lay.ti)} and ${fmt(lay.top)} on top = ${fmt(per)} per pallet${cap}`);
    else set('tihi', '–', `Layers differ (${lay.counts.map((c) => fmt(c)).join(', ')} from the bottom up) = ${fmt(per)} per pallet${cap}.`);
    const nP = Math.ceil(qty / per), rest = qty - (nP - 1) * per;
    set('pallets', fmt(nP), nP === 1 ? `${fmt(qty)} of up to ${fmt(per)} boxes on one pallet` : rest === per ? `${fmt(nP)} full pallets of ${fmt(per)}` : `${fmt(nP - 1)} full of ${fmt(per)} + 1 with ${fmt(rest)}`);
  }

  // ---------- room left: how many more of each box type fit around the plan as it is ----------
  const roomWorker = new Worker(new URL('./pack-worker.js', import.meta.url), { type: 'module' });
  let roomId = 0, roomKey = '', roomData = null, roomTimer = 0;
  function paintRoom() {
    const u = U[units];
    R('room').innerHTML = state.items.map((it, i) => {
      const r = roomData ? roomData[i] : undefined;
      const more = r === undefined ? '…' : r === null ? '–' : fmt(r.more);
      const lim = !r ? '' : r.limit === 'payload' ? `Payload (${fmt(u.fromKG(it.weight), 1)} ${u.wt} each)` : 'Space';
      return `<tr><td><i style="display:inline-block;width:12px;height:12px;border-radius:3px;background:${SWATCH[i % SWATCH.length]};margin-right:6px"></i>${esc(it.name)}</td><td class="num">${more}</td><td>${lim}</td></tr>`;
    }).join('');
  }
  function roomFor(d) {
    const fixed = d.boxes.map((b) => ({ k: b.k, x: b.x, y: b.y, z: b.z, dx: b.dx, dy: b.dy, dz: b.dz }));
    const container = engineInput().container, items = engineItems();
    const key = JSON.stringify([container, items.map((it) => [it.l, it.w, it.h, it.weight, it.rotation, it.orients, it.stackable]), fixed]);
    if (key === roomKey) { paintRoom(); return; }
    roomKey = key; roomData = null; paintRoom();
    clearTimeout(roomTimer);
    roomTimer = setTimeout(() => roomWorker.postMessage({ id: ++roomId, kind: 'room', container, items, fixed, opts: { tries: 15, timeMs: 250 } }), 200);
  }
  roomWorker.onmessage = (e) => { if (e.data.id !== roomId) return; roomData = e.data.room; paintRoom(); };

  // ---------- hand editing (semi-automatic) ----------
  // ed: { boxes (plan order kept for undo), sel (index into boxes), placing: null | { kind: 'new' | 'move',
  // k, idx, orient }, spots, undo, redo, msg, bad }. Every change is checked before it is made.
  let ed = null, edNotice = '', edBusy = false;
  const E = (n) => root.querySelector(`[data-ed="${n}"]`);
  const edCtx = () => makeCtx(engineInput().container, engineItems(), ed.boxes);
  const strip = (b) => ({ k: b.k, x: b.x, y: b.y, z: b.z, dx: b.dx, dy: b.dy, dz: b.dz });
  function edView() {
    const ctx = edCtx();
    const list = ed.boxes.map((b, i) => ({ ...b, s: -1, _i: i })).sort((a, b) => a.x - b.x || a.z - b.z || a.y - b.y);
    return { cont: ctx.cont, boxes: list, steps: null, errors: validate(asResult(ctx)), edited: true };
  }
  const edRender = () => { render(edView()); writeEditHash(); };
  const say = (msg, bad = false) => { if (ed) { ed.msg = msg; ed.bad = bad; } };
  const leftOf = (k) => (state.items[k]?.qty || 0) - ed.boxes.filter((b) => b.k === k).length;
  const lenTxt = (mm) => `${fmt(U[units].fromMM(mm), units === 'metric' ? 1 : 2)}`;
  function clearEditView() { if (view) { view.setSpots([]); view.setSelected(null); } paintEditor(); }
  function snapshot() { ed.undo.push(ed.boxes.map(strip)); if (ed.undo.length > 60) ed.undo.shift(); ed.redo = []; }
  function startEdit(empty) {
    if (!last) return;
    ed = { boxes: empty ? [] : last.boxes.map(strip), sel: null, placing: null, spots: [], undo: [], redo: [], msg: '', bad: false };
    say(empty ? `Empty ${mode === 'container' ? 'container' : 'pallet'}. Pick a box type under “Not loaded” and place it, or tap “Fill the rest automatically”.` : 'Tap a box in the 3D view (or use ‹ ›) to select it.');
    edRender();
  }
  function select(i) { if (!ed) return; ed.sel = i; ed.placing = null; ed.spots = []; say(''); paintEditor(); }
  function spotsNow() {
    const p = ed.placing; if (!p) { ed.spots = []; return; }
    const ctx = edCtx();
    const it = ctx.items[p.k];
    if (p.kind === 'new') {
      const w = ed.boxes.reduce((t, b) => t + (state.items[b.k]?.weight || 0), 0) + it.weight;
      if (ctx.cont.maxWeight > 0 && w > ctx.cont.maxWeight + 1e-6) { ed.spots = []; say(`One more “${esc(state.items[p.k].name)}” would go over the payload of ${fmt(U[units].fromKG(ctx.cont.maxWeight))} ${U[units].wt}.`, true); return; }
    }
    const prefer = p.kind === 'move' ? [ed.boxes[p.idx].dx, ed.boxes[p.idx].dy, ed.boxes[p.idx].dz] : undefined;
    ed.spots = freeSpots(ctx, p.k, p.orient, { ignore: p.kind === 'move' ? new Set([p.idx]) : undefined, prefer, limit: 1500 });
    if (!ed.spots.length) say(p.orient != null ? 'No free spot for this box in that position. Try “Automatic”.' : 'No free spot left for this box.', true);
  }
  function placeAt(b) {
    const p = ed.placing; if (!p || !b) return;
    snapshot();
    if (p.kind === 'move') { ed.boxes[p.idx] = strip(b); ed.sel = p.idx; ed.placing = null; ed.spots = []; say('Box moved.'); }
    else {
      ed.boxes.push(strip(b)); ed.sel = ed.boxes.length - 1;
      if (leftOf(p.k) > 0) { spotsNow(); if (ed.spots.length) say(`Placed. ${fmt(leftOf(p.k))} “${esc(state.items[p.k].name)}” left: tap another green spot, or Stop.`); }
      else { ed.placing = null; ed.spots = []; say(`All “${esc(state.items[p.k].name)}” are loaded.`); }
    }
    edRender();
  }
  function onPick(hit) {
    if (!ed) return;
    if (hit && hit.kind === 'spot' && ed.placing) placeAt(ed.spots[hit.index]);
    else if (hit && hit.kind === 'box') select(boxes[hit.index]._i);
    else if (!ed.placing) select(null);
  }
  function guardStack(ctx, i) {
    const n = onTop(ctx, i).length;
    if (n) { say(`${n === 1 ? 'A box stands' : n + ' boxes stand'} on this box. Move or remove ${n === 1 ? 'it' : 'them'} first.`, true); return false; }
    return true;
  }
  function turnTo(o) {
    const i = ed.sel; if (i == null) return;
    const ctx = edCtx(); if (!guardStack(ctx, i)) return paintEditor();
    const b = ed.boxes[i]; const d = dimsOf(state.items[b.k], o);
    const c = { ...b, dx: d[0], dy: d[1], dz: d[2] };
    const why = placeProblem(ctx, c, new Set([i]));
    if (why) { say(`Cannot turn it here: ${why}. Use “Pick a new spot” to put it somewhere else in that position.`, true); return paintEditor(); }
    snapshot(); ed.boxes[i] = c; say(`Turned: ${ORIENT_NAMES[o].toLowerCase()}.`); edRender();
  }
  function push(axis, dir) {
    const i = ed.sel; if (i == null) return;
    const ctx = edCtx(); if (!guardStack(ctx, i)) return paintEditor();
    const c = nudgeBox(ctx, i, axis, dir);
    if (!c) { say('No free place in that direction.', true); return paintEditor(); }
    snapshot(); ed.boxes[i] = strip(c); say('Box moved.'); edRender();
  }
  function removeSel() {
    const i = ed.sel; if (i == null) return;
    const ctx = edCtx(); const st = stackFrom(ctx, i);
    snapshot();
    const drop = new Set(st); ed.boxes = ed.boxes.filter((_, j) => !drop.has(j));
    ed.sel = null; ed.placing = null; ed.spots = [];
    say(st.length === 1 ? 'Box removed. It is listed under “Not loaded”.' : `Removed the box and the ${st.length - 1} standing on it. They are listed under “Not loaded”.`);
    edRender();
  }
  function fillRest() {
    if (edBusy) return;
    edBusy = true; root.querySelector('[data-result]').classList.add('busy');
    ed.placing = null; ed.spots = [];
    worker.postMessage({ id: ++reqId, kind: 'fill', container: engineInput().container, items: engineItems(), fixed: ed.boxes.map(strip), opts: { priority: !!state.priority, timeMs: 1200 } });
  }
  function fillDone(v) {
    edBusy = false; if (!ed) return;
    if (v.errors.length) { say('The automatic fill did not pass the check, so it was not used.', true); render(edView()); return; }
    const before = ed.boxes.length;
    snapshot(); ed.boxes = v.boxes.map(strip); ed.sel = null;
    const added = ed.boxes.length - before;
    say(added > 0 ? `Added ${nBoxes(added)} automatically around your boxes.` : 'Nothing more fits around your boxes.', added <= 0);
    edRender();
  }
  function paintEditor() {
    const on = !!ed;
    root.querySelector('[data-ed-off]').hidden = on; root.querySelector('[data-ed-on]').hidden = !on;
    if (!on) { if (view) { view.setSpots([]); view.setSelected(null); } return; }
    const u = U[units];
    const msg = root.querySelector('[data-ed-msg]'); msg.innerHTML = ed.msg || ''; msg.classList.toggle('bad', !!ed.bad); msg.hidden = !ed.msg;
    E('undo').disabled = !ed.undo.length; E('redo').disabled = !ed.redo.length;
    // selection
    const pos = boxes.findIndex((b) => b._i === ed.sel);
    const b = ed.sel != null ? ed.boxes[ed.sel] : null;
    root.querySelector('[data-ed-seltxt]').innerHTML = b ? `<strong>Box ${fmt(pos + 1)} of ${fmt(boxes.length)}</strong> · ${esc(state.items[b.k]?.name)}` : (boxes.length ? 'No box selected: tap one in the 3D view or use ‹ ›.' : 'No boxes loaded yet.');
    const body = root.querySelector('[data-ed-selbody]'); body.hidden = !b;
    if (b) {
      const it = state.items[b.k]; const cur = orientIndex(it, b);
      root.querySelector('[data-ed-selinfo]').textContent = `${lenTxt(b.dx)} × ${lenTxt(b.dy)} × ${lenTxt(b.dz)} ${u.len} (along × across × up), ${lenTxt(b.x)} ${u.len} from the back wall, ${lenTxt(b.y)} ${u.len} from the side, ${lenTxt(b.z)} ${u.len} up`;
      const seen = new Set();
      root.querySelector('[data-ed-turn]').innerHTML = allowedIdx(it).filter((k) => { const key = dimsOf(it, k).join('x'); if (seen.has(key)) return false; seen.add(key); return true; })
        .map((k) => `<button type="button" class="ochip" data-turn="${k}" aria-pressed="${dimsOf(it, k).join() === [b.dx, b.dy, b.dz].join() || k === cur}" title="${ORIENT_NAMES[k]}">${iso(dimsOf(it, k), SWATCH[b.k % SWATCH.length])}<span>${SHORT[k]}</span></button>`).join('');
    }
    // not loaded
    const rows = state.items.map((it, k) => ({ it, k, left: leftOf(k) })).filter((r) => r.left > 0);
    root.querySelector('[data-ed-left]').innerHTML = rows.length ? rows.map((r) => `<div class="edleftrow"><span><i style="background:${SWATCH[r.k % SWATCH.length]}"></i>${esc(r.it.name)}: <strong>${fmt(r.left)}</strong></span><button type="button" class="btn ghost" data-place="${r.k}">Place by hand</button></div>`).join('') : '<p class="small">Every box is loaded.</p>';
    E('fill').disabled = !rows.length;
    // placing
    const pl = root.querySelector('[data-ed-placing]'); pl.hidden = !ed.placing;
    if (ed.placing) {
      const p = ed.placing; const it = state.items[p.k];
      root.querySelector('[data-ed-pltxt]').innerHTML = p.kind === 'move' ? `Moving box ${fmt(pos + 1)}: tap a green spot in the 3D view.` : `Placing “${esc(it.name)}” (${fmt(leftOf(p.k))} left): tap a green spot in the 3D view, or use the next free spot.`;
      const sel = root.querySelector('[data-ed-plorient]');
      sel.innerHTML = stepOrientOptions(it).replace('Automatic (best allowed)', 'Automatic (best fit at each spot)');
      sel.value = p.orient == null ? '' : String(p.orient);
      E('nextspot').disabled = !ed.spots.length;
    }
    if (view) { view.setSelected(b && !(ed.placing && ed.placing.kind === 'move') ? b : null); view.setSpots(ed.spots); }
  }
  root.querySelector('[data-editor]').addEventListener('click', (e) => {
    const t = e.target.closest('button'); if (!t) return;
    const a = t.dataset.ed;
    if (a === 'start' || a === 'empty') return startEdit(a === 'empty');
    if (!ed) return;
    if (a === 'exit') { ed = null; shown = 0; clearEditView(); render(last); writeHash(); return; }
    if (a === 'undo' || a === 'redo') {
      const from = a === 'undo' ? ed.undo : ed.redo, to = a === 'undo' ? ed.redo : ed.undo;
      if (!from.length) return;
      to.push(ed.boxes.map(strip)); ed.boxes = from.pop(); ed.sel = null; ed.placing = null; ed.spots = [];
      say(a === 'undo' ? 'Undone.' : 'Redone.'); return edRender();
    }
    if (a === 'fill') return fillRest();
    if (a === 'prev' || a === 'next') {
      if (!boxes.length) return;
      const pos = boxes.findIndex((b) => b._i === ed.sel);
      const j = pos < 0 ? (a === 'next' ? 0 : boxes.length - 1) : (pos + (a === 'next' ? 1 : -1) + boxes.length) % boxes.length;
      return select(boxes[j]._i);
    }
    if (a === 'remove') return removeSel();
    if (a === 'move') {
      const ctx = edCtx(); if (ed.sel == null) return; if (!guardStack(ctx, ed.sel)) return paintEditor();
      const b = ed.boxes[ed.sel];
      ed.placing = { kind: 'move', k: b.k, idx: ed.sel, orient: orientIndex(state.items[b.k], b) };
      say(''); spotsNow(); return paintEditor();
    }
    if (a === 'stop') { ed.placing = null; ed.spots = []; say(''); return paintEditor(); }
    if (a === 'nextspot') return placeAt(ed.spots[0]);
    if (t.dataset.place != null) { ed.placing = { kind: 'new', k: +t.dataset.place, orient: null }; ed.sel = null; say(''); spotsNow(); return paintEditor(); }
    if (t.dataset.turn != null) return turnTo(+t.dataset.turn);
    if (t.dataset.push) { const [ax, dir] = t.dataset.push.split(','); return push(+ax, +dir); }
  });
  root.querySelector('[data-ed-plorient]').addEventListener('change', (e) => {
    if (!ed || !ed.placing) return;
    ed.placing.orient = e.target.value === '' ? null : +e.target.value; say(''); spotsNow(); paintEditor();
  });

  // hand edits in share links: [type, orientation, x, y, z (µm)] deflated, base64url
  async function packEdits(list) {
    const flat = [];
    for (const b of list) flat.push(b.k, orientIndex(state.items[b.k], b), Math.round(b.x * 1000), Math.round(b.y * 1000), Math.round(b.z * 1000));
    const stream = new Blob([flat.join(',')]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
    let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  async function unpackEdits(str) {
    const bin = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    const text = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text();
    const n = text ? text.split(',').map(Number) : []; const out = [];
    for (let i = 0; i + 4 < n.length + 0; i += 5) {
      const it = state.items[n[i]]; if (!it || n[i + 1] < 0 || n[i + 1] > 5) throw new Error('bad edit');
      const d = dimsOf(it, n[i + 1]);
      out.push({ k: n[i], x: n[i + 2] / 1000, y: n[i + 3] / 1000, z: n[i + 4] / 1000, dx: d[0], dy: d[1], dz: d[2] });
    }
    return out;
  }
  let hashTimer = 0;
  function writeEditHash() {
    clearTimeout(hashTimer);
    hashTimer = setTimeout(async () => {
      if (!ed || typeof CompressionStream === 'undefined') return;
      try { const e = await packEdits(ed.boxes); if (ed) history.replaceState(null, '', '#p=' + btoa(unescape(encodeURIComponent(JSON.stringify(state)))).replace(/=+$/, '') + '&e=' + e); } catch { /* ignore */ }
    }, 300);
  }
  async function readEditHash() {
    const m = location.hash.match(/&e=([A-Za-z0-9_-]*)/);
    if (!m || typeof DecompressionStream === 'undefined') return;
    try {
      const list = await unpackEdits(m[1]);
      ed = { boxes: list, sel: null, placing: null, spots: [], undo: [], redo: [], msg: '', bad: false };
      if (edView().errors.length) { ed = null; edNotice = 'The hand edits in this link do not match these boxes, so the automatic plan is shown.'; if (last) render(last); return; }
      say('Hand-edited plan from a shared link.'); edRender();
    } catch { ed = null; }
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
      if (s && s.cont && Array.isArray(s.items) && s.items.length) {
        s.items = s.items.slice(0, 10);
        s.steps = Array.isArray(s.steps) ? s.steps.slice(0, 20).filter((st) => st && Number.isInteger(st.item) && st.item >= 0 && st.item < s.items.length) : [];
        return s;
      }
    } catch { /* bad link */ }
    return null;
  }
  $('[data-share]').addEventListener('click', async () => {
    if (ed) { clearTimeout(hashTimer); try { const e = await packEdits(ed.boxes); history.replaceState(null, '', '#p=' + btoa(unescape(encodeURIComponent(JSON.stringify(state)))).replace(/=+$/, '') + '&e=' + e); } catch { /* ignore */ } }
    else writeHash();
    try { await navigator.clipboard.writeText(location.href); R('shareMsg').textContent = 'Link copied.'; }
    catch { R('shareMsg').textContent = 'Copy the address bar to share this plan.'; }
  });
  // ---------- printed plans carry a QR code of the plan's link (qrcode-generator, MIT), loaded when idle ----------
  let qrLib = null;
  const loadQr = () => (qrLib ? Promise.resolve(qrLib) : import('qrcode-generator').then((m) => { qrLib = m.default || m; return qrLib; }));
  try { (window.requestIdleCallback || ((f) => setTimeout(f, 1500)))(() => { loadQr().catch(() => {}); }); } catch { /* ignore */ }
  function paintQr() {
    const box = $('[data-qr]'); if (!box) return;
    const url = location.href;
    if (!qrLib) { box.hidden = true; return; }
    try {
      const qr = qrLib(0, 'L'); qr.addData(url, 'Byte'); qr.make();
      const n = qr.getModuleCount(); let d = '';
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + 4} ${r + 4}h1v1h-1z`;
      $('[data-qrsvg]').innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n + 8} ${n + 8}" shape-rendering="crispEdges" role="img" aria-label="QR code of the link to this plan"><rect width="100%" height="100%" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
      // about 0.5 mm per module on paper, so a phone camera can read it; very long links stop at version 40
      $('[data-qrsvg]').style.setProperty('--qrw', `${Math.max(30, Math.min(95, (n + 8) * 0.5))}mm`);
      box.dataset.url = url; box.hidden = false;
      $('[data-qrtxt]').textContent = 'Scan to open this plan on a phone: turn it in 3D and step through the loading box by box.';
    } catch { // too long for a QR code (very large hand-edited plans)
      $('[data-qrsvg]').innerHTML = ''; box.hidden = false; box.dataset.url = '';
      $('[data-qrtxt]').textContent = 'This plan’s link is too long for a QR code; use Copy link to share it.';
    }
  }
  window.addEventListener('beforeprint', paintQr);
  $('[data-print]').addEventListener('click', async () => {
    try { if (ed) await currentHash(); else writeHash(); await loadQr(); } catch { /* print anyway */ }
    paintQr(); window.print();
  });

  // the cartons on a pallet type of the box list, for the 3D view (null: draw it as one block)
  function innerOf(k) {
    const it = state.items[k]; if (!it || !it.pz || !state.pzs) return null;
    const boxes = pzLay.get(`${it.pz.k}:${it.pz.n}`); if (!boxes) return null;
    const ph = state.pzs.palletH || 0;
    if (Math.abs(it.l - state.pzs.L) > 1 || Math.abs(it.w - state.pzs.W) > 1) return null; // pallet card edited by hand
    return { L: state.pzs.L, W: state.pzs.W, ph, boxes };
  }
  // ---------- cartons on pallets first (container mode): each box type is built into pallets in the worker
  // (pallet planner, same stacking pattern and limits), then the loaded pallets become the box list ----------
  const pzPresets = JSON.parse(root.dataset.pzpresets || '[]');
  const pzBox = $('[data-pz]');
  let pzWorker = null, pzId = 0, pzOnlyLay = false, pzRequest = () => {};
  const pzLay = new Map(); // `${carton type}:${cartons}` -> carton positions on that pallet, for the 3D views
  if (pzBox) {
    const ex = pzPresets[0];
    if (!state.pzs || typeof state.pzs !== 'object') state.pzs = { preset: ex.id, L: ex.L, W: ex.W, palletH: ex.H, H: 1800, palletWt: ex.weightKg, maxWeight: ex.maxWeight, stack2: false };
  }
  const P = (n) => root.querySelector(`[data-pzf="${n}"]`);
  function paintPz() {
    if (!pzBox) return;
    const z = state.pzs, u = U[units], p = pzPresets.find((x) => x.id === z.preset);
    P('preset').value = p ? p.id : 'custom';
    for (const k of ['L', 'W', 'palletH', 'H']) P(k).value = showLen(z[k]);
    P('palletWt').value = z.palletWt == null ? '' : showWt(z.palletWt);
    P('maxWeight').value = z.maxWeight ? showWt(z.maxWeight) : '';
    P('stack2').checked = !!z.stack2;
    P('layer').value = z.layer === 'grid' ? 'grid' : 'most'; P('pstack').value = z.pstack === 'interlock' ? 'interlock' : 'column';
    $('[data-pznote]').innerHTML = (p ? `Pallet size, height and safe working load from <a href="${p.url}" rel="noopener" target="_blank">${esc(p.source)}</a>${p.weightKg ? `; the pallet weight is ${esc(p.source)}'s approximate figure` : `; ${esc(p.source)} prints no pallet weight there, so enter your own`}. ` : 'Enter your pallet size, height, own weight and max load. ')
      + `The max height is your own limit (racking, door, customer or warehouse rule); ${fmt(u.fromMM(1800), units === 'metric' ? 0 : 1)} ${u.len} is only an example.`
      + (z.stack2 ? ` Two high, each loaded pallet may carry one more on top${p && p.stackNote ? `; ${esc(p.source)}: “${esc(p.stackNote)}”` : ''}. Check your cartons can take it.` : '');
    $('[data-pzsum]').textContent = state.pzOn ? `On: ${fmt(state.pzOn.pallets)} pallets` : 'Off: the cartons are loaded loose';
  }
  function paintPzOn() {
    const on = $('[data-pzon]'); if (!on) return;
    const z = state.pzOn; on.hidden = !z || !Array.isArray(state.cartons);
    if (on.hidden) return;
    const u = U[units]; const dp = units === 'metric' ? 1 : 2;
    $('[data-pzhh]').textContent = `Loaded height (${u.len})`; $('[data-pzwh]').textContent = `Gross weight (${u.wt})`;
    $('[data-pztxt]').innerHTML = `Your ${fmt(z.cartons)} cartons are on <strong>${fmt(z.pallets)} pallets</strong> (${esc(z.palletName)}, at most ${fmt(u.fromMM(z.H), dp)} ${u.len} high including the pallet${z.stack2 ? ', two high allowed' : ''}). The box list below now holds the loaded pallets, and the plan loads them.${z.loose ? ` ${esc(z.loose)} could not go on this pallet and stay${z.looseN === 1 ? 's' : ''} loose.` : ''}${z.merged ? ' The last part pallets are counted as full pallets to keep within 10 box types.' : ''}`;
    $('[data-pztable]').innerHTML = z.rows.map((r) => `<tr><td>${esc(r.name)}${r.tihi ? ` <span class="small">(${esc(r.tihi)})</span>` : ''}</td><td class="num">${r.per ? fmt(r.per) : '–'}</td><td class="num">${r.per ? r.desc : 'loose'}</td><td class="num">${r.per ? r.h.map((h) => fmt(u.fromMM(h), dp)).join(' / ') : '–'}</td><td class="num">${r.per ? r.w.map((w) => fmt(u.fromKG(w), 0)).join(' / ') : '–'}</td><td>${r.per ? `<button type="button" class="btn line pzvbtn" data-pzv="${r.k}" aria-pressed="${pzView && pzView.k === r.k}">View</button>` : ''}</td></tr>`).join('');
    if (pzView) paintPzView();
  }
  // ---------- one pallet in 3D: how the cartons stand on it, with the cartons-per-pallet cap ----------
  let pzView = null, pzv = null; // pzView = { k: carton type, i: 0 full / 1 last }
  async function paintPzView() {
    const box = $('[data-pzview]'); if (!box) return;
    const z = state.pzOn; const row = z && z.rows.find((r) => r.k === pzView?.k && r.per);
    if (!row) { box.hidden = true; pzView = null; return; }
    box.hidden = false;
    const u = U[units], dp = units === 'metric' ? 1 : 2;
    const i = Math.min(pzView.i, row.ns.length - 1); const n = row.ns[i];
    const lay = pzLay.get(`${row.k}:${n}`) || [];
    const ci = Math.max(0, state.items.findIndex((it) => it.pz && it.pz.k === row.k));
    $('[data-pzvtitle]').textContent = `${row.name} on ${state.pzOn.palletName}`;
    $('[data-pzvseg]').style.gridTemplateColumns = `repeat(${row.ns.length},minmax(0,1fr))`;
    $('[data-pzvseg]').innerHTML = row.ns.map((m, j) => `<button type="button" data-pzvi="${j}" aria-pressed="${j === i}">${row.ns.length > 1 ? (j ? 'Last pallet' : 'Full pallet') : 'Pallet'} (${fmt(m)})</button>`).join('');
    $('[data-pzvinfo]').textContent = `${fmt(n)} carton${n === 1 ? '' : 's'}${row.tihi && i === 0 ? ` (${row.tihi}: per layer × layers)` : ''}, ${fmt(u.fromMM(row.h[i]), dp)} ${u.len} high and ${fmt(u.fromKG(row.w[i]), 0)} ${u.wt} including the pallet. ${state.pzs.layer === 'grid' ? 'Every carton stands the same way' : 'Each layer holds the most cartons'}, ${state.pzs.pstack === 'interlock' ? 'alternating layers where they can tie together' : 'the same layer every time, in straight columns'}, within the cartons' stacking limits; change both under “Put the cartons on pallets first”.`;
    const cap = state.pzs.caps && state.pzs.caps[row.k];
    const capIn = $('[data-pzcap]'); if (document.activeElement !== capIn) capIn.value = cap ? String(cap) : '';
    capIn.placeholder = `most: ${fmt(row.most)}`;
    $('[data-pzvnote]').textContent = `Fewer cartons per pallet make lower, lighter pallets (for example for a weak carton or a customer's height). Leave it empty for the most that fit (${fmt(row.most)}).`;
    // the pallet calculator with this carton and pallet, for hand editing (changes there stay there)
    const c = state.cartons[row.k]; const pz = state.pzs;
    const st = { cont: { preset: pz.preset, L: pz.L, W: pz.W, H: pz.H, overhang: 0, palletH: pz.palletH, palletWt: pz.palletWt ?? null, maxWeight: pz.maxWeight || 0 }, priority: false, stack: state.stack, support: state.support, mode: 'auto', steps: [], fillRest: true, items: [{ ...c, qty: n }] };
    try { $('[data-pzedit]').href = '/pallet-loading-calculator/#p=' + btoa(unescape(encodeURIComponent(JSON.stringify(st)))).replace(/=+$/, ''); } catch { /* keep the plain link */ }
    if (!pzv) { const { createView } = await import('./view3d.js'); pzv = createView($('[data-pzv3d]')); }
    pzv.setPlan({ cont: { L: pz.L, W: pz.W, H: Math.max(1, pz.H - (pz.palletH || 0)) }, boxes: lay.map(([x, y, zz, dx, dy, dz]) => ({ k: ci, x, y, z: zz, dx, dy, dz })), colors: SWATCH, pallet: { L: pz.L, W: pz.W, H: pz.palletH || 0 }, offset: 0 });
  }
  const pzOnBox = $('[data-pzon]');
  if (pzOnBox) {
    pzOnBox.addEventListener('click', (e) => {
      const v = e.target.closest('[data-pzv]'), vi = e.target.closest('[data-pzvi]');
      if (v) { const k = +v.dataset.pzv; pzView = pzView && pzView.k === k ? null : { k, i: 0 }; paintPzOn(); if (pzView) $('[data-pzview]').scrollIntoView({ behavior: 'smooth', block: 'nearest' }); else $('[data-pzview]').hidden = true; return; }
      if (vi) { pzView.i = +vi.dataset.pzvi; paintPzView(); return; }
      if (e.target.closest('[data-pzvclose]')) { pzView = null; $('[data-pzview]').hidden = true; paintPzOn(); return; }
      if (e.target.closest('[data-pzrebuild]')) {
        const k = pzView?.k; if (k == null) return;
        const n = parseInt($('[data-pzcap]').value, 10);
        state.pzs.caps = { ...(state.pzs.caps || {}) }; if (n > 0) state.pzs.caps[k] = n; else delete state.pzs.caps[k];
        $('[data-pzvnote]').textContent = 'Rebuilding the pallets…';
        pzRequest(state.cartons, false);
      }
    });
  }
  if (pzBox) {
    pzBox.addEventListener('input', (e) => {
      const t = e.target; const k = t.dataset.pzf; if (!k) return; const z = state.pzs;
      if (k === 'layer' || k === 'pstack') return; // handled on change
      if (k === 'stack2') z.stack2 = t.checked;
      else if (k === 'palletWt') z.palletWt = t.value.trim() === '' ? null : readWt(t.value);
      else if (k === 'maxWeight') z.maxWeight = t.value.trim() === '' ? 0 : readWt(t.value) ?? 0;
      else if (k !== 'preset') { const v = readLen(t.value); if (v !== null) z[k] = v; if (['L', 'W', 'palletH'].includes(k)) { z.preset = 'custom'; P('preset').value = 'custom'; } }
      if (k === 'stack2') paintPz(); else $('[data-pzsum]').textContent = state.pzOn ? `On: ${fmt(state.pzOn.pallets)} pallets` : 'Off: the cartons are loaded loose';
      writeHash();
    });
    pzBox.addEventListener('change', (e) => {
      if (e.target.dataset.pzf === 'layer' || e.target.dataset.pzf === 'pstack') {
        state.pzs[e.target.dataset.pzf] = e.target.value; writeHash();
        if (state.pzOn && Array.isArray(state.cartons)) { $('[data-pzmsg]').textContent = 'Building the pallets…'; pzRequest(state.cartons, false); }
        return;
      }
      if (e.target.dataset.pzf !== 'preset') return;
      const p = pzPresets.find((x) => x.id === e.target.value);
      if (p) Object.assign(state.pzs, { preset: p.id, L: p.L, W: p.W, palletH: p.H, palletWt: p.weightKg, maxWeight: p.maxWeight }); else state.pzs.preset = 'custom';
      paintPz(); writeHash();
    });
    $('[data-pzgo]').addEventListener('click', () => {
      const z = state.pzs; const cartons = Array.isArray(state.cartons) ? state.cartons : state.items;
      if (!(z.L > 0 && z.W > 0 && z.H > (z.palletH || 0))) { $('[data-pzmsg]').textContent = 'Enter the pallet size and a max height above the pallet height.'; return; }
      $('[data-pzmsg]').textContent = 'Building the pallets…'; $('[data-pzgo]').disabled = true;
      pzRequest(cartons, false);
    });
    pzRequest = function (cartons, layoutsOnly) {
      const z = state.pzs;
      if (!pzWorker) {
        pzWorker = new Worker(new URL('./pack-worker.js', import.meta.url), { type: 'module' });
        pzWorker.onmessage = (ev) => { if (ev.data.id === pzId) pzDone(ev.data.out, pzOnlyLay); };
      }
      pzOnlyLay = layoutsOnly;
      const pst = z.pstack === 'interlock' ? 'interlock' : 'column';
      const ms = pst === 'interlock' ? state.support : 1;
      const caps = z.caps || {};
      const items = cartons.map((it, k) => ({ l: it.l, w: it.w, h: it.h, weight: it.weight, qty: it.qty, rotation: it.rotation, orients: it.rotation === 'custom' ? allowedIdx(it) : undefined, stackable: it.stackable !== false, maxOnTop: it.maxOnTop ?? null, maxLoad: it.maxLoad ?? null, cap: +caps[k] > 0 ? +caps[k] : 0 }));
      pzWorker.postMessage({ id: ++pzId, kind: 'palletize', container: { L: z.L, W: z.W, H: z.H - (z.palletH || 0), maxWeight: z.maxWeight || 0, minSupport: ms }, items, opts: { stack: pst, grid: z.layer === 'grid', timeMs: 300 } });
      pzBox.dataset.cartons = JSON.stringify(cartons);
    };
    // a page opened from a link with pallets: fetch the carton layouts for the 3D view (the pallets stay as they are)
    if (state.pzOn && Array.isArray(state.cartons) && state.items.some((it) => it.pz)) setTimeout(() => pzRequest(state.cartons, true), 300);
    function pzDone(out, layoutsOnly) {
      $('[data-pzgo]').disabled = false;
      if (layoutsOnly) {
        out.forEach((r, k) => { if (r && r.per) for (const b of [r.f, r.last, r.single]) if (b) pzLay.set(`${k}:${b.n}`, b.boxes); });
        if (!ed && plans[shown]) render({ ...plans[shown], keep: true });
        return;
      }
      const z = state.pzs; const cartons = JSON.parse(pzBox.dataset.cartons || '[]');
      const pw = +z.palletWt || 0, ph = z.palletH || 0;
      const p = pzPresets.find((x) => x.id === z.preset);
      let cur = null, curK = -1;
      const pallet = (name, n, b) => { pzLay.set(`${curK}:${b.n}`, b.boxes); return { name: name.slice(0, 40), l: z.L, w: z.W, h: ph + b.h, weight: b.w + pw, qty: n, rotation: 'upright', stackable: !!z.stack2, maxOnTop: z.stack2 ? 1 : null, maxLoad: null, stop: cur ? cur.stop ?? null : null, pz: { k: curK, n: b.n } }; };
      let items = [], rows = [], loose = [], looseN = 0, pallets = 0, merged = false;
      cartons.forEach((c, k) => {
        const r = out[k]; const nm = c.name || `Box ${k + 1}`; cur = c; curK = k;
        if (!r || !r.per) { if ((c.qty || 0) > 0) { items.push({ ...c }); loose.push(`“${nm}”`); looseN += c.qty; } rows.push({ name: nm, per: 0 }); return; }
        if (r.single) { items.push(pallet(`${nm} · 1 pallet of ${r.single.n}`, 1, r.single)); pallets += 1; rows.push({ name: nm, k, most: r.most, per: r.per, tihi: r.tihi, desc: '1', ns: [r.single.n], h: [ph + r.single.h], w: [r.single.w + pw] }); return; }
        items.push({ ...pallet(`${nm} · ${r.per} per pallet`, r.full, r.f), _k: k });
        pallets += r.full;
        if (r.last) { items.push({ ...pallet(`${nm} · last pallet, ${r.last.n}`, 1, r.last), _last: true }); pallets += 1; }
        rows.push({ name: nm, k, most: r.most, ns: r.last ? [r.f.n, r.last.n] : [r.f.n], per: r.per, tihi: r.tihi, desc: r.last ? `${fmt(r.full)} + 1` : fmt(r.full), h: r.last ? [ph + r.f.h, ph + r.last.h] : [ph + r.f.h], w: r.last ? [r.f.w + pw, r.last.w + pw] : [r.f.w + pw] });
      });
      if (items.length > 10) { // keep within 10 box types: part pallets counted as full ones (safe: as tall and heavy)
        merged = true;
        items = items.filter((it) => !it._last);
        cartons.forEach((c, k) => { const r = out[k]; if (r && r.per && r.last) { const f = items.find((it) => it._k === k); if (f) f.qty += 1; } });
        items = items.slice(0, 10);
      }
      items.forEach((it) => { delete it._k; delete it._last; });
      if (!items.length) { $('[data-pzmsg]').textContent = 'No box type fits on this pallet within the height and load limits.'; return; }
      state.cartons = cartons; state.items = items;
      state.pzOn = { pallets, cartons: cartons.reduce((t, c) => t + (c.qty || 0), 0), palletName: p ? p.name : 'custom pallet', H: z.H, stack2: !!z.stack2, rows, loose: loose.join(', '), looseN, merged };
      state.steps = state.mode === 'semi' ? state.items.map((_, i) => ({ item: i, qty: null, orient: null, newSection: false })) : [];
      $('[data-pzmsg]').textContent = '';
      paintBoxes(); paintMode(); paintPz(); schedule();
      if (!pzView) $('[data-pzon]').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    $('[data-pzoff]').addEventListener('click', () => {
      if (!Array.isArray(state.cartons)) return;
      state.items = state.cartons; state.cartons = null; state.pzOn = null; pzView = null;
      state.steps = state.mode === 'semi' ? state.items.map((_, i) => ({ item: i, qty: null, orient: null, newSection: false })) : [];
      paintBoxes(); paintMode(); paintPz(); schedule();
    });
    paintPz();
  }

  // ---------- saved plans: kept in this browser (localStorage), every planner page lists them all ----------
  const SAVE_KEY = 'lpc-plans', SAVE_MAX = 50;
  const readSaved = () => { try { const v = JSON.parse(localStorage.getItem(SAVE_KEY) || '[]'); return Array.isArray(v) ? v.filter((x) => x && typeof x.hash === 'string' && typeof x.page === 'string') : []; } catch { return null; } };
  const writeSaved = (list) => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(list.slice(0, SAVE_MAX))); return true; } catch { return false; } };
  const pageName = () => (document.querySelector('h1')?.textContent || 'Load planner').trim();
  const defaultName = () => {
    const n = plans[0] ? plans[0].boxes.length : 0;
    const where = mode === 'pallet' ? presets.find((x) => x.id === state.cont.preset)?.name || 'Pallet' : unitName() === 'this size' ? 'Custom size' : unitName();
    return `${where} · ${fmt(n)} boxes · ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`;
  };
  const savedMsg = (t) => { $('[data-savedmsg]').textContent = t; };
  function paintSaved() {
    const list = readSaved();
    $('[data-savename]').placeholder = defaultName();
    if (list === null) { $('[data-savedsum]').textContent = 'not available'; $('[data-savebtn]').disabled = true; savedMsg('This browser does not allow saving here (private window or blocked site data). Use Copy link instead.'); $('[data-savedlist]').innerHTML = ''; return; }
    $('[data-savedsum]').textContent = list.length ? `${list.length} on this device` : 'none yet';
    $('[data-savedlist]').innerHTML = list.map((x) => {
      const here = x.page === location.pathname;
      const when = (() => { try { return new Date(x.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch { return ''; } })();
      return `<li><div class="sv"><strong>${esc(x.name)}</strong><span class="small">${esc(x.summary || '')}${here ? '' : ` · ${esc(x.pageName || x.page)}`} · ${esc(when)}</span></div><div class="svbtns"><button type="button" class="btn line" data-open="${esc(x.id)}">Open</button><button type="button" class="iconbtn" data-delsaved="${esc(x.id)}" aria-label="Delete ${esc(x.name)}">✕</button></div></li>`;
    }).join('');
  }
  async function currentHash() {
    if (ed) { clearTimeout(hashTimer); try { const e = await packEdits(ed.boxes); history.replaceState(null, '', '#p=' + btoa(unescape(encodeURIComponent(JSON.stringify(state)))).replace(/=+$/, '') + '&e=' + e); } catch { /* ignore */ } }
    else writeHash();
    return location.hash;
  }
  $('[data-savebtn]').addEventListener('click', async () => {
    const list = readSaved(); if (list === null) { paintSaved(); return; }
    const name = ($('[data-savename]').value.trim() || defaultName()).slice(0, 60);
    const total = qtyOf().reduce((a, b) => a + b, 0), n = plans[0] ? plans[0].boxes.length : 0;
    const entry = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name, page: location.pathname, pageName: pageName(), hash: await currentHash(), at: new Date().toISOString(),
      summary: `${fmt(n)} of ${fmt(total)} boxes${plans.length > 1 ? ` in the first of ${plans.length}` : ''}${ed ? ', hand-edited' : ''}` };
    const same = list.findIndex((x) => x.name === name && x.page === entry.page);
    if (same >= 0) list.splice(same, 1);
    list.unshift(entry);
    if (!writeSaved(list)) { savedMsg('Could not save: the browser storage is full or blocked. Use Copy link instead.'); return; }
    if (list.length > SAVE_MAX) savedMsg(`Saved “${name}”. Only the ${SAVE_MAX} newest plans are kept.`);
    else savedMsg(same >= 0 ? `Updated “${name}”.` : `Saved “${name}”.`);
    $('[data-savename]').value = ''; paintSaved();
  });
  $('[data-savedlist]').addEventListener('click', (e) => {
    const list = readSaved() || [];
    const o = e.target.closest('[data-open]'), d = e.target.closest('[data-delsaved]');
    if (d) { const i = list.findIndex((x) => x.id === d.dataset.delsaved); if (i >= 0) { const [x] = list.splice(i, 1); writeSaved(list); savedMsg(`Deleted “${x.name}”.`); paintSaved(); } return; }
    if (!o) return;
    const x = list.find((y) => y.id === o.dataset.open); if (!x) return;
    if (x.page === location.pathname) { history.replaceState(null, '', x.hash); location.reload(); }
    else location.href = x.page + x.hash;
  });
  $('[data-saved]').addEventListener('toggle', () => { if ($('[data-saved]').open) paintSaved(); });
  window.addEventListener('storage', (e) => { if (e.key === SAVE_KEY) paintSaved(); });
  paintSaved();

  paintUnits(); paintContainer(); paintBoxes(); paintMode(); paintEditor(); run(); readEditHash();
  // a shared link with settings other than the page's defaults opens "More options", so they can be seen
  {
    const dStack = defaults.stack === 'interlock' ? 'interlock' : 'column';
    const dSup = [1, 0.9, 0.8, 0.7].includes(+defaults.support) ? +defaults.support : 0.8;
    if (fromHash && (state.mode === 'semi' || !!state.priority !== !!defaults.priority || state.stack !== dStack || (state.stack === 'interlock' && state.support !== dSup))) $('[data-more]').open = true;
  }
  // full-screen 3D view (with the view and step buttons); Esc or the button closes it
  const stage = $('[data-stage]'); const fullBtn = $('[data-full]');
  const setFull = (on) => {
    stage.classList.toggle('full', on); document.body.classList.toggle('has-full', on);
    fullBtn.setAttribute('aria-pressed', String(on)); fullBtn.textContent = on ? '✕' : '⤢';
    fullBtn.setAttribute('aria-label', on ? 'Close full screen' : 'Full screen 3D view'); fullBtn.title = on ? 'Close full screen' : 'Full screen';
  };
  fullBtn.addEventListener('click', () => setFull(!stage.classList.contains('full')));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && stage.classList.contains('full')) setFull(false); });
  window.addEventListener('beforeprint', () => setFull(false));
}

const nBoxes = (n) => `${fmt(n)} ${n === 1 ? 'box' : 'boxes'}`;
function esc(s) { return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
