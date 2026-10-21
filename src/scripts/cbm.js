// CBM calculator: carton lines -> cubic metres, cubic feet and share of each container's inside volume.
// Every length is stored in millimetres, so switching cm / mm / in never changes the numbers.
// Exact definitions: 1 in = 25.4 mm, 1 ft = 0.3048 m (1 ft³ = 0.028316846592 m³, 1 in³ = 0.000016387064 m³).
import { round, fmt } from './units.js';

export const FT3_M3 = 0.3048 ** 3;
export const UNITS = {
  cm: { toMM: (v) => v * 10, fromMM: (mm) => mm / 10, d: 2 },
  mm: { toMM: (v) => v, fromMM: (mm) => mm, d: 1 },
  in: { toMM: (v) => v * 25.4, fromMM: (mm) => mm / 25.4, d: 2 },
};
export const m3 = (l) => (l.l * l.w * l.h) / 1e9; // one carton, mm -> m³
// decimals that keep small cartons readable
const dv = (v) => (v >= 100 ? 2 : v >= 1 ? 3 : v >= 0.01 ? 4 : 6);
export const fv = (v) => fmt(v, dv(v));
const pc = (v) => Number(v).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// state for the container loading calculator's share link (#p=, see planner.js readHash)
export function planLink(c, lines) {
  const items = lines.filter((x) => x.l > 0 && x.w > 0 && x.h > 0 && x.qty > 0).slice(0, 10).map((x, i) => ({
    name: x.name || `Carton ${i + 1}`, l: x.l, w: x.w, h: x.h, weight: 0, qty: Math.min(x.qty, 20000), rotation: 'any', stackable: true,
  }));
  const state = { cont: { preset: c.id, L: c.L, W: c.W, H: c.H, doorW: c.doorW, doorH: c.doorH, maxWeight: c.payload }, priority: false, items };
  return '/container-loading-calculator/#p=' + btoa(unescape(encodeURIComponent(JSON.stringify(state)))).replace(/=+$/, '');
}

export function initCbm(root) {
  const conts = JSON.parse(root.dataset.containers);
  let lines = JSON.parse(root.dataset.defaults);
  let unit = 'cm';
  try { unit = localStorage.getItem('lpc-cbm-unit') || (navigator.language === 'en-US' ? 'in' : 'cm'); } catch { /* storage blocked */ }
  if (!UNITS[unit]) unit = 'cm';
  const $ = (s) => root.querySelector(s);
  const R = (k) => root.querySelector(`[data-r="${k}"]`) || document.querySelector(`[data-r="${k}"]`);
  const host = $('[data-lines]'), tpl = document.getElementById('cbm-line');
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
    const total = ok.reduce((s, x) => s + m3(x) * x.qty, 0);
    const count = ok.reduce((s, x) => s + x.qty, 0);
    const skipped = lines.length - ok.length;
    R('main').textContent = ok.length ? `${fv(total)} m³` : '–';
    R('ft3').textContent = ok.length ? `${fmt(total / FT3_M3, 2)} ft³` : '–';
    R('count').textContent = fmt(count);
    R('skip').hidden = !skipped;
    R('skip').textContent = skipped ? `${skipped === 1 ? 'One line is' : `${skipped} lines are`} left out: enter a length, width, height and quantity above 0.` : '';
    // per line
    root.querySelectorAll('.cbmline').forEach((node) => {
      const x = lines[+node.dataset.i]; const good = ok.includes(x);
      node.querySelector('[data-out]').textContent = good ? `${fv(m3(x))} m³ each · ${fv(m3(x) * x.qty)} m³ for ${fmt(x.qty)}` : 'Enter all three sizes and a quantity';
    });
    // containers
    R('conts').innerHTML = conts.map((c) => {
      const v = (c.L * c.W * c.H) / 1e9; const pct = (total / v) * 100; const need = Math.ceil(total / v - 1e-9);
      return `<tr><td>${esc(c.name)}<br><span class="small">${fmt(v, 2)} m³ inside</span></td>`
        + `<td class="num">${ok.length ? pc(pct) : '–'}${ok.length && pct > 100 ? `<br><span class="small">at least ${need} by volume</span>` : ''}</td>`
        + `<td>${ok.length ? `<a class="planlink" href="${planLink(c, ok)}">Plan in 3D</a>` : ''}</td></tr>`;
    }).join('');
    // live formula steps
    const u = unit, steps = ok.map((x) => {
      const a = [x.l, x.w, x.h].map((mm) => fmt(UNITS[u].fromMM(mm), UNITS[u].d));
      const one = m3(x);
      const head = `${esc(x.name || 'Carton')}: `;
      if (u === 'in') {
        const in3 = (x.l * x.w * x.h) / 25.4 ** 3;
        return `${head}${a.join(' × ')} in = ${fv(in3)} in³ ÷ 1,728 = ${fv(in3 / 1728)} ft³; × 0.000016387064 = ${fmt(one, 6)} m³ each<br>× ${fmt(x.qty)} cartons = ${fv(one * x.qty)} m³`;
      }
      const m = [x.l, x.w, x.h].map((mm) => fmt(mm / 1000, 4));
      return `${head}${a.join(' × ')} ${u} = ${m.join(' × ')} m = ${fmt(one, 6)} m³ each<br>× ${fmt(x.qty)} cartons = ${fv(one * x.qty)} m³`;
    });
    const c0 = conts.find((c) => c.id === '40hc') || conts[0]; const v0 = (c0.L * c0.W * c0.H) / 1e9;
    R('steps').innerHTML = ok.length ? steps.join('<br>')
      + `<br>Total = ${fv(total)} m³ ÷ 0.028316846592 = ${fmt(total / FT3_M3, 2)} ft³`
      + `<br>${esc(c0.name)}: ${[c0.L, c0.W, c0.H].map((mm) => fmt(mm / 1000, 3)).join(' × ')} m = ${fmt(v0, 2)} m³ → ${fv(total)} ÷ ${fmt(v0, 2)} = ${pc((total / v0) * 100)}` : 'Enter a carton to see the steps.';
  }

  const readLen = (v) => { const n = parseFloat(String(v).replace(',', '.')); return Number.isFinite(n) && n >= 0 ? UNITS[unit].toMM(n) : 0; };
  host.addEventListener('input', (e) => {
    const t = e.target; const node = t.closest('.cbmline'); if (!node || !t.dataset.k) return;
    const x = lines[+node.dataset.i]; const k = t.dataset.k;
    if (k === 'name') x.name = t.value;
    else if (k === 'qty') { const n = parseInt(t.value, 10); x.qty = Number.isFinite(n) && n > 0 ? Math.min(n, 1e7) : 0; }
    else x[k] = readLen(t.value);
    calc();
  });
  host.addEventListener('click', (e) => {
    const d = e.target.closest('[data-del]'); if (!d || lines.length < 2) return;
    lines.splice(+d.closest('.cbmline').dataset.i, 1); paintLines(); calc();
  });
  $('[data-add]').addEventListener('click', () => {
    if (lines.length >= 10) return;
    const p = lines[lines.length - 1];
    lines.push({ name: `Carton ${String.fromCharCode(65 + lines.length)}`, l: p ? p.l : 400, w: p ? p.w : 300, h: p ? p.h : 300, qty: 100 });
    paintLines(); calc();
    host.lastElementChild?.querySelector('[data-k="l"]')?.focus();
  });
  root.querySelectorAll('[data-unit]').forEach((b) => b.addEventListener('click', () => {
    unit = b.dataset.unit; try { localStorage.setItem('lpc-cbm-unit', unit); } catch { /* ignore */ }
    paintLines(); calc();
  }));
  paintLines(); calc();
}
