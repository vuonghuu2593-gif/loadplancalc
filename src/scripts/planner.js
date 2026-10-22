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
    f('priority').checked = !!state.priority;
    const p = presets.find((x) => x.id === c.preset);
    if (mode === 'pallet') {
      const u = U[units];
      f('srcnote').innerHTML = p && p.url ? `Pallet length, width and height from <a href="${p.url}" rel="noopener" target="_blank">${esc(p.source)}</a>, and its safe working load (${fmt(u.fromKG(p.maxWeight), 0)} ${u.wt}) as the starting max load weight. The max height is your own limit (racking, trailer, customer or warehouse rule); the ${fmt(u.fromMM(1800), units === 'metric' ? 0 : 1)} ${u.len} filled in is only an example.` : 'Enter your pallet size and height, how far the load may overhang each side, the max height of the loaded pallet and the max load weight.';
    } else f('srcnote').innerHTML = p && p.url ? `Preset figures from <a href="${p.url}" rel="noopener" target="_blank">${esc(p.source || 'Hapag-Lloyd')}</a>. ${p.note ? esc(p.note) : 'Containers vary by maker and series; check the CSC plate or your booking for the exact unit.'}` : 'Enter the inside dimensions of your container or trailer.';
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
      } else if (k === 'stackable') it.stackable = t.checked;
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
        else Object.assign(state.cont, { preset: p.id, L: p.L, W: p.W, palletH: p.H, maxWeight: p.maxWeight });
      } else state.cont.preset = 'custom';
      paintContainer(); schedule();
    } else if (t.dataset.f === 'priority') { state.priority = t.checked; schedule(); }
  });
  root.querySelectorAll('[data-units]').forEach((b) => b.addEventListener('click', () => {
    units = b.dataset.units; try { localStorage.setItem('lpc-units', units); } catch { /* ignore */ }
    paintUnits(); paintContainer(); paintBoxes(); paintMode(); render(ed ? edView() : last);
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
      state.items = res.items;
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

  $('[data-boxes]').addEventListener('click', (e) => {
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
  const engineItems = () => state.items.map((it) => ({ l: it.l, w: it.w, h: it.h, weight: it.weight, qty: it.qty, rotation: it.rotation, orients: it.rotation === 'custom' ? allowedIdx(it) : undefined, stackable: it.stackable !== false }));
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
    worker.postMessage({ id: ++reqId, kind: 'pack', container, items: engineItems(), opts });
  }
  const toView = (d) => {
    const list = [];
    for (let i = 0; i < d.buf.length; i += 8) list.push({ k: d.buf[i], x: d.buf[i + 1], y: d.buf[i + 2], z: d.buf[i + 3], dx: d.buf[i + 4], dy: d.buf[i + 5], dz: d.buf[i + 6], s: d.buf[i + 7] });
    return { cont: d.cont, boxes: list, steps: d.steps, errors: d.errors, pallet: d.pallet || null, stack: d.stack || null };
  };
  worker.onmessage = (e) => {
    if (e.data.id !== reqId) return;
    if (e.data.kind === 'fill') { fillDone(toView(e.data)); return; }
    last = toView(e.data);
    if (!ed) render(last); else root.querySelector('[data-result]').classList.remove('busy');
  };

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
  step.addEventListener('input', () => { view && view.setStep(+step.value); stepText(); });
  const stepText = () => {
    const v = +step.value; const b = boxes[v - 1];
    const stTxt = !ed && b && b.s >= 0 && last && last.steps ? (last.steps[b.s].auto ? ' · automatic part' : ` · step ${b.s + 1}`) : '';
    R('stepTxt').textContent = `${fmt(v)} of ${fmt(boxes.length)} boxes${stTxt}`;
  };

  async function render(d) {
    if (!d) return;
    root.querySelector('[data-result]').classList.remove('busy');
    const u = U[units];
    const ordered = state.items.reduce((s, it) => s + (it.qty || 0), 0);
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
    $('#r-main').textContent = `${fmt(n)} of ${fmt(ordered)}`;
    R('vol').textContent = contVol > 0 ? `${fmt(totals.vol / contVol * 100, 1)}%` : '0%';
    const wt = u.fromKG(totals.w);
    R('wt').textContent = `${fmt(wt, 0)} ${u.wt}`;
    R('left').textContent = fmt(ordered - n);
    const volLeft = Math.max(0, contVol - totals.vol);
    const vU = units === 'metric' ? 'm³' : 'ft³', toV = (mm3) => (units === 'metric' ? mm3 / 1e9 : mm3 / (304.8 ** 3));
    R('spaceLeft').textContent = `${fmt(toV(volLeft), 2)} ${vU}`;
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
    if (notFit > 0) {
      const byWeight = d.cont.maxWeight > 0 && totals.w > d.cont.maxWeight * 0.98;
      w.push(byWeight ? `Weight limit reached: ${nBoxes(notFit)} stay${notFit === 1 ? 's' : ''} out because the load would exceed ${fmt(u.fromKG(d.cont.maxWeight))} ${u.wt}.` : `${nBoxes(notFit)} ${notFit === 1 ? 'does' : 'do'} not fit ${mode === 'pallet' ? 'on this pallet' : 'in this space'}${semi ? ' with these steps' : ''}${mode === 'pallet' && !semi && state.items.length === 1 ? ' (see “Pallets for your quantity”)' : ''}.`);
    }
    if (semi) d.steps.forEach((st, si) => {
      if (st.auto) return;
      const cfg = state.steps[si]; const name = esc(state.items[cfg?.item]?.name || 'this box type');
      if (st.asked === 0) w.push(`Step ${si + 1} has nothing to load: no “${name}” are left for it.`);
      else if (st.loaded < st.asked) w.push(`Step ${si + 1} loaded ${fmt(st.loaded)} of ${fmt(st.asked)} “${name}”: the rest do not fit in the space left${cfg?.orient != null ? ' in the position chosen' : ''}.`);
    });
    state.items.forEach((it, i) => {
      const dims = [it.l, it.w, it.h];
      if (hasAuto && !d.edited && it.qty > 0 && perItem[i] === 0) w.push(`“${esc(it.name)}” could not be placed at all — check its size against the ${mode === 'container' ? 'inside dimensions and the door opening' : 'pallet size, overhang and max height'}.`);
      if (!dims.every((x) => x > 0)) w.push(`“${esc(it.name)}” needs a length, width and height.`);
    });
    if (cog && n && mode === 'pallet') {
      const ln = (mm) => `${fmt(u.fromMM(mm), units === 'metric' ? 1 : 2)} ${u.len}`;
      w.push(`Centre of gravity of the load: ${ln(Math.abs(cog.x - d.cont.L / 2))} off the middle along the length, ${ln(Math.abs(cog.y - d.cont.W / 2))} across the width, ${ln(cog.z)} above the pallet deck. Keep heavy boxes low and the load centred.`);
    } else if (cog && n) {
      const off = (cog.x - d.cont.L / 2) / d.cont.L * 100;
      w.push(`Centre of gravity of the cargo: ${fmt(u.fromMM(cog.x), units === 'metric' ? 0 : 1)} ${u.len} from the back wall (${off >= 0 ? fmt(off, 0) + '% toward the door' : fmt(-off, 0) + '% toward the back'} from the middle). Keep heavy cargo low and the load spread evenly.`);
    }
    R('warn').innerHTML = w.map((x) => `<p class="warn">${x}</p>`).join('');
    paintStackResult(d, n);
    // table
    const used = (list) => { // "H up · L along: 540, L up · W across: 120"
      const c = new Map();
      for (const b of list) { const o = orientOf(state.items[b.k], b); c.set(o, (c.get(o) || 0) + 1); }
      return [...c.entries()].sort((a, b) => b[1] - a[1]).map(([o, m]) => `${o >= 0 ? SHORT[o] : '?'}: ${fmt(m)}`).join('<br>') || '–';
    };
    R('table').innerHTML = state.items.map((it, i) => `<tr><td><i style="display:inline-block;width:12px;height:12px;border-radius:3px;background:${SWATCH[i % SWATCH.length]};margin-right:6px"></i>${esc(it.name)}</td><td class="num">${fmt(it.qty)}</td><td class="num">${fmt(perItem[i])}</td><td class="num">${fmt(Math.max(0, it.qty - perItem[i]))}</td><td class="num">${fmt(u.fromKG(perItem[i] * it.weight))} ${u.wt}</td><td style="white-space:nowrap">${used(boxes.filter((b) => b.k === i))}</td></tr>`).join('');
    R('stepbox').hidden = !semi || !!d.edited;
    R('steptable').innerHTML = semi ? d.steps.map((st, si) => {
      const cfg = st.auto ? null : state.steps[si];
      const label = st.auto ? 'Rest' : String(si + 1);
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
    ].join('<br>');
    roomFor(d);
    paintLoadList();
    if (mode === 'pallet') paintPallet(d);
    // 3D
    const { offset } = engineInput();
    step.max = String(boxes.length); step.value = String(boxes.length); stepText();
    const v = await ensureView();
    v.setPlan({ cont: d.cont, boxes, colors: SWATCH, offset, keepCamera: !!d.edited, pallet: mode === 'pallet' ? { L: state.cont.L, W: state.cont.W, H: state.cont.palletH || 0 } : null });
    paintEditor();
  }


  // ---------- loading list (sections along the length, layers from the floor up; see loadlist.js) ----------
  let lastList = null, llAll = false;
  const LL_FEW = 2; // sections shown before "Show all" on long lists
  const stepName = (s) => (s < 0 || !lastList?.d.steps ? '' : lastList.d.steps[s]?.auto ? 'Automatic part' : `Step ${s + 1}`);
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
      ? `Load the pallet layer by layer from the deck up. In each layer place the groups in the order listed, each from the back edge and from the right-hand edge as seen from the front (the Front view). Distances in ${u.len} from the pallet edges. The loading step slider shows the same order.`
      : `Load section by section from the back wall toward the door, each section layer by layer from the floor up, and in each layer the groups in the order listed, starting at the back of the section and at the right-hand wall as seen from the door. ${il ? `The sections are the interlocked walls of ${ln(d.stack.section)} ${u.len}${ll.sections.length > d.stack.sections ? '; the boxes in front of the last wall follow' : ''}.` : 'A section ends where no box crosses the line across the load; where boxes of different lengths overlap, a section is about 120 cm long or more.'} Distances in ${u.len}. The loading step slider shows the same order.`;
    const many = ll.sections.length > LL_FEW + 1 && ll.sections.reduce((t, s) => t + s.layers.reduce((a, l) => a + l.groups.length, 0), 0) > 30;
    let html = '';
    ll.sections.forEach((s, si) => {
      const hide = many && !llAll && si >= LL_FEW ? ' hidden' : '';
      const where = pal ? (ll.sections.length > 1 ? `Part ${si + 1}` : 'Pallet') : `Section ${si + 1} · ${ln(s.x0)}–${ln(s.x1)} ${u.len} from the back wall`;
      const stp = stepName(s.step);
      html += `<tr class="llsec"${hide}><th colspan="7"><div class="llsecin">${where}${stp ? ` · ${stp}` : ''} · ${fmt(s.n)} ${s.n === 1 ? 'box' : 'boxes'}, ${wt(s.w)}<span class="small"> · loaded so far: ${fmt(s.soFar)} ${s.soFar === 1 ? 'box' : 'boxes'}, ${wt(s.wSoFar)}</span></div></th></tr>`;
      s.layers.forEach((l, li) => l.groups.forEach((g, gi) => {
        const lay = gi ? '' : `<td rowspan="${l.groups.length}"><strong>${fmt(li + 1)}</strong> <span class="small">${l.z < 0.5 ? (pal ? 'deck' : 'floor') : `${ln(l.z)} ${u.len} up`}</span></td>`;
        html += `<tr${hide}>${lay}<td><i class="sw" style="background:${SWATCH[g.k % SWATCH.length]}"></i>${esc(state.items[g.k]?.name)}</td><td style="white-space:nowrap">${g.o >= 0 ? SHORT[g.o] : '?'}</td><td class="num">${fmt(g.n)}</td><td class="num">${ln(g.x0 - off)}–${ln(g.x1 - off)}</td><td class="num">${ln(g.y0 - off)}–${ln(g.y1 - off)}</td><td class="num">${fmt(g.soFar)}</td></tr>`;
      }));
    });
    R('lltable').innerHTML = html || '<tr><td colspan="7">No boxes in the plan.</td></tr>';
    const more = $('[data-llmore]');
    more.hidden = !many;
    more.textContent = llAll ? `Show the first ${LL_FEW} sections only` : `Show all ${fmt(ll.sections.length)} ${pal ? 'parts' : 'sections'}`;
    more.setAttribute('aria-expanded', String(llAll));
    $('[data-llcsv]').disabled = !ll.n;
  }
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
    if (a === 'exit') { ed = null; clearEditView(); render(last); writeHash(); return; }
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
  $('[data-print]').addEventListener('click', () => window.print());

  paintUnits(); paintContainer(); paintBoxes(); paintMode(); paintEditor(); run(); readEditHash();
}

const nBoxes = (n) => `${fmt(n)} ${n === 1 ? 'box' : 'boxes'}`;
function esc(s) { return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
