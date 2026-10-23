// Freight density calculator: shipment lines (pieces × length × width × height, weight per piece) ->
// total weight, total cube and density in lb/ft³ and kg/m³. Sizes are stored in millimetres and weights in
// kilograms, so switching in · lb ⇄ cm · kg never changes the numbers.
// Exact definitions only: 1 in = 25.4 mm, 1 ft = 304.8 mm (1 ft³ = 0.028316846592 m³ = 1,728 in³),
// 1 lb = 0.45359237 kg, so 1 lb/ft³ = 0.45359237 ÷ 0.028316846592 = 16.01846337396… kg/m³.
import { round, fmt } from './units.js';

export const FT3_M3 = 0.3048 ** 3;
export const LB_KG = 0.45359237;
export const PCF_KGM3 = LB_KG / FT3_M3;
export const U = {
  imperial: { len: 'in', wt: 'lb', toMM: (v) => v * 25.4, fromMM: (mm) => mm / 25.4, toKG: (v) => v * LB_KG, fromKG: (kg) => kg / LB_KG, d: 2 },
  metric: { len: 'cm', wt: 'kg', toMM: (v) => v * 10, fromMM: (mm) => mm / 10, toKG: (v) => v, fromKG: (kg) => kg, d: 2 },
};
// one line: mm and kg in -> cube (m³) and weight (kg) for all its pieces
export const lineOf = (x) => ({ m3: (x.l * x.w * x.h * x.qty) / 1e9, kg: x.kg * x.qty });
export function totals(lines) {
  const ok = lines.filter((x) => x.l > 0 && x.w > 0 && x.h > 0 && x.qty > 0 && x.kg >= 0);
  let m3 = 0, kg = 0, n = 0;
  for (const x of ok) { const t = lineOf(x); m3 += t.m3; kg += t.kg; n += x.qty; }
  return { ok, m3, kg, n, ft3: m3 / FT3_M3, lb: kg / LB_KG, kgm3: m3 > 0 ? kg / m3 : 0, pcf: m3 > 0 ? kg / m3 / PCF_KGM3 : 0 };
}
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const num = (v) => { const n = parseFloat(String(v).replace(/,/g, '')); return Number.isFinite(n) && n >= 0 ? n : NaN; };

export function initDensity(root) {
  let lines = JSON.parse(root.dataset.defaults);
  let units = 'imperial';
  try { units = localStorage.getItem('lpc-dens-units') || (navigator.language === 'en-US' ? 'imperial' : 'metric'); } catch { /* storage blocked */ }
  if (!U[units]) units = 'imperial';
  const $ = (s) => root.querySelector(s);
  const R = (k) => root.querySelector(`[data-r="${k}"]`) || document.querySelector(`[data-r="${k}"]`);
  const host = $('[data-lines]'), tpl = document.getElementById('dens-line');
  const showL = (mm) => (mm > 0 ? String(round(U[units].fromMM(mm), U[units].d)) : '');
  const showW = (kg) => (kg > 0 ? String(round(U[units].fromKG(kg), 2)) : kg === 0 ? '0' : '');

  function paintLines() {
    host.innerHTML = '';
    lines.forEach((x, i) => {
      const node = tpl.content.firstElementChild.cloneNode(true);
      node.dataset.i = String(i);
      node.querySelector('[data-k="name"]').value = x.name;
      for (const k of ['l', 'w', 'h']) node.querySelector(`[data-k="${k}"]`).value = showL(x[k]);
      node.querySelector('[data-k="kg"]').value = showW(x.kg);
      node.querySelector('[data-k="qty"]').value = String(x.qty);
      node.querySelector('[data-del]').hidden = lines.length < 2;
      host.appendChild(node);
    });
    root.querySelectorAll('[data-ul]').forEach((e) => { e.textContent = `(${U[units].len})`; });
    root.querySelectorAll('[data-uw]').forEach((e) => { e.textContent = `(${U[units].wt})`; });
    root.querySelectorAll('[data-units]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.units === units)));
    $('[data-add]').disabled = lines.length >= 10;
  }

  function calc() {
    const t = totals(lines); const u = U[units]; const imp = units === 'imperial';
    const has = t.ok.length && t.m3 > 0;
    R('main').textContent = has ? (imp ? `${fmt(t.pcf, 2)} lb/ft³` : `${fmt(t.kgm3, 1)} kg/m³`) : '–';
    R('other').textContent = has ? (imp ? `${fmt(t.kgm3, 1)} kg/m³` : `${fmt(t.pcf, 2)} lb/ft³`) : '–';
    R('wt').textContent = has ? (imp ? `${fmt(t.lb, 1)} lb` : `${fmt(t.kg, 1)} kg`) : '–';
    R('wtSub').textContent = has ? (imp ? `${fmt(t.kg, 1)} kg` : `${fmt(t.lb, 1)} lb`) : '';
    R('cube').textContent = has ? (imp ? `${fmt(t.ft3, 2)} ft³` : `${fmt(t.m3, 3)} m³`) : '–';
    R('cubeSub').textContent = has ? (imp ? `${fmt(t.m3, 3)} m³` : `${fmt(t.ft3, 2)} ft³`) : '';
    R('count').textContent = fmt(t.n);
    const skipped = lines.length - t.ok.length;
    R('skip').hidden = !skipped;
    R('skip').textContent = skipped ? `${skipped === 1 ? 'One line is' : `${skipped} lines are`} left out: enter a length, width, height, weight and number of pieces.` : '';
    root.querySelectorAll('.densline').forEach((node) => {
      const x = lines[+node.dataset.i]; const good = t.ok.includes(x);
      if (!good) { node.querySelector('[data-out]').textContent = 'Enter all three sizes, a weight and the pieces'; return; }
      const a = lineOf(x); const one = a.m3 / x.qty;
      node.querySelector('[data-out]').textContent = imp
        ? `${fmt(one / FT3_M3, 2)} ft³ each · ${fmt(a.kg / a.m3 / PCF_KGM3, 2)} lb/ft³`
        : `${fmt(one, 3)} m³ each · ${fmt(a.kg / a.m3, 1)} kg/m³`;
    });
    // live formula steps
    const steps = t.ok.map((x) => {
      const dims = [x.l, x.w, x.h].map((mm) => fmt(u.fromMM(mm), u.d)).join(' × ');
      const a = lineOf(x);
      return imp
        ? `${esc(x.name || 'Line')}: ${dims} in = ${fmt((x.l * x.w * x.h) / 25.4 ** 3, 1)} in³ ÷ 1,728 = ${fmt(a.m3 / x.qty / FT3_M3, 3)} ft³ × ${fmt(x.qty)} = ${fmt(a.m3 / FT3_M3, 3)} ft³; ${fmt(u.fromKG(x.kg), 2)} lb × ${fmt(x.qty)} = ${fmt(a.kg / LB_KG, 2)} lb`
        : `${esc(x.name || 'Line')}: ${dims} cm = ${[x.l, x.w, x.h].map((mm) => fmt(mm / 1000, 3)).join(' × ')} m = ${fmt(a.m3 / x.qty, 4)} m³ × ${fmt(x.qty)} = ${fmt(a.m3, 4)} m³; ${fmt(x.kg, 2)} kg × ${fmt(x.qty)} = ${fmt(a.kg, 2)} kg`;
    });
    R('steps').innerHTML = has ? steps.join('<br>') + (imp
      ? `<br>Density = ${fmt(t.lb, 2)} lb ÷ ${fmt(t.ft3, 3)} ft³ = <strong>${fmt(t.pcf, 2)} lb/ft³</strong><br>× 16.0185 (0.45359237 ÷ 0.028316846592) = ${fmt(t.kgm3, 1)} kg/m³`
      : `<br>Density = ${fmt(t.kg, 2)} kg ÷ ${fmt(t.m3, 4)} m³ = <strong>${fmt(t.kgm3, 1)} kg/m³</strong><br>÷ 16.0185 (0.45359237 ÷ 0.028316846592) = ${fmt(t.pcf, 2)} lb/ft³`) : 'Enter a line to see the steps.';
  }

  host.addEventListener('input', (e) => {
    const t = e.target; const node = t.closest('.densline'); if (!node || !t.dataset.k) return;
    const x = lines[+node.dataset.i]; const k = t.dataset.k;
    if (k === 'name') x.name = t.value;
    else if (k === 'qty') { const n = parseInt(t.value, 10); x.qty = Number.isFinite(n) && n > 0 ? Math.min(n, 100000) : 0; }
    else if (k === 'kg') { const n = num(t.value); x.kg = Number.isFinite(n) ? U[units].toKG(n) : -1; }
    else { const n = num(t.value); x[k] = Number.isFinite(n) ? U[units].toMM(n) : 0; }
    calc();
  });
  host.addEventListener('click', (e) => {
    const d = e.target.closest('[data-del]'); if (!d || lines.length < 2) return;
    lines.splice(+d.closest('.densline').dataset.i, 1); paintLines(); calc();
  });
  $('[data-add]').addEventListener('click', () => {
    if (lines.length >= 10) return;
    const p = lines[lines.length - 1];
    lines.push({ name: `Line ${lines.length + 1}`, l: p ? p.l : 1219.2, w: p ? p.w : 1016, h: p ? p.h : 1219.2, kg: p ? p.kg : 100, qty: 1 });
    paintLines(); calc();
    host.lastElementChild?.querySelector('[data-k="l"]')?.focus();
  });
  root.querySelectorAll('[data-units]').forEach((b) => b.addEventListener('click', () => {
    units = b.dataset.units; try { localStorage.setItem('lpc-dens-units', units); } catch { /* ignore */ }
    paintLines(); calc();
  }));
  paintLines(); calc();
}
