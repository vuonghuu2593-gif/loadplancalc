// Cubic feet calculator: item lines (length × width × height × quantity) -> cubic feet, cubic metres,
// cubic yards, litres and US gallons, plus a two-way cubic feet ⇄ cubic metres converter.
// Every length is stored in millimetres, so switching in / ft / cm / m / mm never changes the numbers.
// Exact definitions: 1 in = 25.4 mm, 1 ft = 0.3048 m (1 ft³ = 0.028316846592 m³ = 1,728 in³),
// 1 yd³ = 27 ft³, 1 L = 0.001 m³, 1 US gallon = 231 in³.
import { round, fmt } from './units.js';

export const FT3_M3 = 0.3048 ** 3; // 0.028316846592
export const UNITS = {
  in: { toMM: (v) => v * 25.4, fromMM: (mm) => mm / 25.4, d: 2 },
  ft: { toMM: (v) => v * 304.8, fromMM: (mm) => mm / 304.8, d: 4 },
  cm: { toMM: (v) => v * 10, fromMM: (mm) => mm / 10, d: 2 },
  m: { toMM: (v) => v * 1000, fromMM: (mm) => mm / 1000, d: 4 },
  mm: { toMM: (v) => v, fromMM: (mm) => mm, d: 1 },
};
export const ft3 = (x) => (x.l * x.w * x.h) / 304.8 ** 3; // one item, mm -> ft³
// cubic feet -> the other units (exact factors)
export const conv = (f) => ({ ft3: f, m3: f * FT3_M3, yd3: f / 27, in3: f * 1728, L: f * FT3_M3 * 1000, gal: (f * 1728) / 231 });
// decimals that keep small values readable
const dv = (v) => (v >= 1000 ? 1 : v >= 100 ? 2 : v >= 1 ? 3 : v >= 0.01 ? 4 : 6);
export const fv = (v) => fmt(v, dv(v));
const pc = (v) => Number(v).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const num = (v) => { const n = parseFloat(String(v).replace(/,/g, '')); return Number.isFinite(n) && n >= 0 ? n : NaN; };

export function initCuft(root) {
  const spaces = JSON.parse(root.dataset.spaces); // [{name, ft3}]
  let lines = JSON.parse(root.dataset.defaults);
  let unit = 'in';
  try { unit = localStorage.getItem('lpc-cuft-unit') || 'in'; } catch { /* storage blocked */ }
  if (!UNITS[unit]) unit = 'in';
  const $ = (s) => root.querySelector(s);
  const R = (k) => root.querySelector(`[data-r="${k}"]`) || document.querySelector(`[data-r="${k}"]`);
  const host = $('[data-lines]'), tpl = document.getElementById('cuft-line');
  const show = (mm) => (mm > 0 ? String(round(UNITS[unit].fromMM(mm), UNITS[unit].d)) : '');

  function paintLines() {
    host.innerHTML = '';
    lines.forEach((x, i) => {
      const node = tpl.content.firstElementChild.cloneNode(true);
      node.dataset.i = String(i);
      node.querySelector('[data-k="name"]').value = x.name;
      for (const k of ['l', 'w', 'h']) node.querySelector(`[data-k="${k}"]`).value = show(x[k]);
      node.querySelector('[data-k="qty"]').value = String(x.qty);
      node.querySelector('[data-del]').hidden = lines.length < 2;
      host.appendChild(node);
    });
    root.querySelectorAll('[data-ul]').forEach((e) => { e.textContent = `(${unit})`; });
    root.querySelectorAll('[data-unit]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.unit === unit)));
    $('[data-add]').disabled = lines.length >= 10;
  }

  function calc() {
    const ok = lines.filter((x) => x.l > 0 && x.w > 0 && x.h > 0 && x.qty > 0);
    const total = ok.reduce((s, x) => s + ft3(x) * x.qty, 0);
    const count = ok.reduce((s, x) => s + x.qty, 0);
    const skipped = lines.length - ok.length;
    const c = conv(total);
    R('main').textContent = ok.length ? `${fv(total)} ft³` : '–';
    R('m3').textContent = ok.length ? `${fv(c.m3)} m³` : '–';
    R('yd3').textContent = ok.length ? `${fv(c.yd3)} yd³` : '–';
    R('L').textContent = ok.length ? `${fmt(c.L, 1)} L` : '–';
    R('gal').textContent = ok.length ? `${fmt(c.gal, 1)} US gal` : '–';
    R('count').textContent = fmt(count);
    R('skip').hidden = !skipped;
    R('skip').textContent = skipped ? `${skipped === 1 ? 'One line is' : `${skipped} lines are`} left out: enter a length, width, height and quantity above 0.` : '';
    root.querySelectorAll('.cuftline').forEach((node) => {
      const x = lines[+node.dataset.i]; const good = ok.includes(x);
      node.querySelector('[data-out]').textContent = good ? `${fv(ft3(x))} ft³ each · ${fv(ft3(x) * x.qty)} ft³ for ${fmt(x.qty)}` : 'Enter all three sizes and a quantity';
    });
    R('spaces').innerHTML = ok.length ? spaces.map((s) => `<li><span>${esc(s.name)}</span> <strong>${pc((total / s.ft3) * 100)}</strong> <span class="small">of ${fmt(s.ft3)} ft³</span></li>`).join('') : '';
    // live formula steps
    const u = unit, steps = ok.map((x) => {
      const a = [x.l, x.w, x.h].map((mm) => fmt(UNITS[u].fromMM(mm), UNITS[u].d)).join(' × ');
      const one = ft3(x), head = `${esc(x.name || 'Item')}: `, each = `<br>× ${fmt(x.qty)} = ${fv(one * x.qty)} ft³`;
      if (u === 'in') { const v = (x.l * x.w * x.h) / 25.4 ** 3; return `${head}${a} in = ${fv(v)} in³ ÷ 1,728 = ${fv(one)} ft³ each${each}`; }
      if (u === 'ft') return `${head}${a} ft = ${fv(one)} ft³ each${each}`;
      const m = (x.l * x.w * x.h) / 1e9;
      const inM = u === 'm' ? '' : ` = ${[x.l, x.w, x.h].map((mm) => fmt(mm / 1000, 4)).join(' × ')} m`;
      return `${head}${a} ${u}${inM} = ${fmt(m, 6)} m³ ÷ 0.028316846592 = ${fv(one)} ft³ each${each}`;
    });
    R('steps').innerHTML = ok.length ? steps.join('<br>')
      + `<br>Total = ${fv(total)} ft³`
      + `<br>× 0.028316846592 = ${fv(c.m3)} m³ · ÷ 27 = ${fv(c.yd3)} yd³`
      + `<br>× 28.316846592 = ${fmt(c.L, 1)} L · × 1,728 ÷ 231 = ${fmt(c.gal, 1)} US gal` : 'Enter an item to see the steps.';
  }

  const readLen = (v) => { const n = num(v); return Number.isFinite(n) ? UNITS[unit].toMM(n) : 0; };
  host.addEventListener('input', (e) => {
    const t = e.target; const node = t.closest('.cuftline'); if (!node || !t.dataset.k) return;
    const x = lines[+node.dataset.i]; const k = t.dataset.k;
    if (k === 'name') x.name = t.value;
    else if (k === 'qty') { const n = parseInt(t.value, 10); x.qty = Number.isFinite(n) && n > 0 ? Math.min(n, 1e7) : 0; }
    else x[k] = readLen(t.value);
    calc();
  });
  host.addEventListener('click', (e) => {
    const d = e.target.closest('[data-del]'); if (!d || lines.length < 2) return;
    lines.splice(+d.closest('.cuftline').dataset.i, 1); paintLines(); calc();
  });
  $('[data-add]').addEventListener('click', () => {
    if (lines.length >= 10) return;
    const p = lines[lines.length - 1];
    lines.push({ name: `Item ${lines.length + 1}`, l: p ? p.l : 304.8, w: p ? p.w : 304.8, h: p ? p.h : 304.8, qty: 1 });
    paintLines(); calc();
    host.lastElementChild?.querySelector('[data-k="l"]')?.focus();
  });
  root.querySelectorAll('[data-unit]').forEach((b) => b.addEventListener('click', () => {
    unit = b.dataset.unit; try { localStorage.setItem('lpc-cuft-unit', unit); } catch { /* ignore */ }
    paintLines(); calc();
  }));
  paintLines(); calc();

  // two-way converter: the field being typed in is the source, the other one follows
  const cf = document.querySelector('[data-conv="ft3"]'), cm = document.querySelector('[data-conv="m3"]');
  const cout = document.querySelector('[data-r="convOut"]');
  function convFrom(src) {
    const v = num(src === 'ft3' ? cf.value : cm.value);
    if (!Number.isFinite(v)) { (src === 'ft3' ? cm : cf).value = ''; cout.textContent = 'Enter a number of 0 or more.'; return; }
    const f = src === 'ft3' ? v : v / FT3_M3; const c = conv(f);
    if (src === 'ft3') cm.value = String(round(c.m3, 6)); else cf.value = String(round(f, 4));
    cout.innerHTML = src === 'ft3'
      ? `${fmt(v, 6)} ft³ × 0.028316846592 = <strong>${fmt(c.m3, 6)} m³</strong><br>= ${fmt(c.yd3, 4)} yd³ = ${fmt(c.in3, 2)} in³ = ${fmt(c.L, 3)} L`
      : `${fmt(v, 6)} m³ ÷ 0.028316846592 = <strong>${fmt(f, 4)} ft³</strong><br>= ${fmt(c.yd3, 4)} yd³ = ${fmt(c.in3, 0)} in³ = ${fmt(c.L, 3)} L`;
  }
  if (cf && cm) {
    cf.addEventListener('input', () => convFrom('ft3'));
    cm.addEventListener('input', () => convFrom('m3'));
    convFrom('ft3');
  }
}
