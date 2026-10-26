// Dimensional weight calculator. Sizes are stored in millimetres and weights in kilograms, so switching
// in · lb / cm · kg never changes the numbers. Exact definitions: 1 in = 25.4 mm, 1 lb = 0.45359237 kg.
// USPS rules follow the Domestic Mail Manual text quoted on the page (src/data/dimweight.json):
// each side rounded to a whole inch (up, or off where the DMM says so), L × W × H (× 0.785 if not rectangular),
// only when the result exceeds 1,728 in³: ÷ divisor, rounded up to the next whole pound.
import { fmt, round, MM_PER_IN, KG_PER_LB } from './units.js';

export const IN3_CM3 = 2.54 ** 3; // 16.387064 cm³ in one cubic inch
// Air cargo volumetric weight: L × W × H in cm ÷ 6,000 ("an industry standard, set by the International Air Transport
// Association (IATA)", Maersk, "Air cargo chargeable weight", read twice 2026-10-26); billed on the greater weight.
export const AIR_CM3_PER_KG = 6000;
// in³ per lb → cm³ per kg
export const toCm3PerKg = (d) => (d * IN3_CM3) / KG_PER_LB;
export const fromCm3PerKg = (d) => (d * KG_PER_LB) / IN3_CM3;

// float-safe rounding of a size or weight (24 in entered as 609.6 mm must stay 24, not 24.000000000000004)
const clean = (x) => +x.toFixed(6);
export const roundUp = (x) => Math.ceil(clean(x));
export const roundOff = (x) => Math.floor(clean(x) + 0.5);

// p: { l, w, h } in mm, kg, qty; rule: a USPS rule from dimweight.json or null for custom;
// shape: 'rect' | 'nonrect'; divisor: in³ per lb (custom only); dunit: 'in3lb' | 'cm3kg' (custom only)
export function dimCalc(p, rule, shape = 'rect', divisor = 139, dunit = 'in3lb') {
  const qty = p.qty > 0 ? p.qty : 1;
  if (!(p.l > 0 && p.w > 0 && p.h > 0 && p.kg >= 0)) return null;
  const actualLb = p.kg / KG_PER_LB;
  if (rule) {
    const r = shape === 'nonrect' ? rule.nonrect : rule.rect;
    const exact = [p.l, p.w, p.h].map((mm) => mm / MM_PER_IN);
    const sides = exact.map((x) => (r.round === 'off' ? roundOff(x) : roundUp(x)));
    const vol = sides[0] * sides[1] * sides[2];                 // whole cubic inches
    const k = Math.round(r.factor * 1000);                      // 0.785 → 785, 1 → 1000 (integer maths)
    const applies = vol * k > rule.threshold_in3 * 1000;
    const dimLb = applies ? Math.ceil((vol * k) / (1000 * r.divisor)) : null;
    const byDim = dimLb !== null && dimLb > actualLb;
    const billLb = byDim ? dimLb : actualLb;
    const capped = dimLb !== null && dimLb > rule.cap_lb;
    const priceLb = Math.max(roundUp(actualLb), dimLb === null ? 0 : Math.min(dimLb, rule.cap_lb), 1);
    return { usps: true, exact, sides, vol, adj: (vol * k) / 1000, factor: r.factor, divisor: r.divisor, round: r.round, applies, dimLb, actualLb, byDim, billLb, capped, priceLb, qty, over: actualLb > rule.cap_lb, threshold: rule.threshold_in3, cap: rule.cap_lb };
  }
  // custom divisor: no rounding of sides, exact dimensional weight in the divisor's own units
  if (!(divisor > 0)) return null;
  const metric = dunit === 'cm3kg';
  const sides = [p.l, p.w, p.h].map((mm) => (metric ? mm / 10 : mm / MM_PER_IN));
  const vol = sides[0] * sides[1] * sides[2];
  const d = metric ? toCm3PerKg(divisor) : divisor;
  const dim = vol / d;
  const actual = metric ? p.kg : actualLb;
  const byDim = dim > actual;
  return { usps: false, metric, sides, vol, divisor: d, dim, actual, byDim, bill: byDim ? dim : actual, qty };
}

const lbkg = (lb) => `${fmt(lb * KG_PER_LB, 2)} kg`;
const kglb = (kg) => `${fmt(kg / KG_PER_LB, 2)} lb`;

export function initDim(root) {
  const rules = JSON.parse(root.dataset.rules);
  const st = JSON.parse(root.dataset.defaults); // { l, w, h (mm), kg, qty, rule, shape, divisor (in³/lb), dunit }
  let units = 'imperial';
  try { units = localStorage.getItem('lpc-dim-units') || (navigator.language === 'en-US' ? 'imperial' : 'metric'); } catch { /* storage blocked */ }
  if (units !== 'metric' && units !== 'imperial') units = 'imperial';
  const $ = (s) => root.querySelector(s);
  const R = (k) => root.querySelector(`[data-r="${k}"]`) || document.querySelector(`[data-r="${k}"]`);
  const F = (k) => root.querySelector(`[data-f="${k}"]`);
  const lenOut = (mm) => (units === 'metric' ? round(mm / 10, 2) : round(mm / MM_PER_IN, 2));
  const wtOut = (kg) => (units === 'metric' ? round(kg, 2) : round(kg / KG_PER_LB, 2));
  const divOut = () => (st.dunit === 'cm3kg' ? round(toCm3PerKg(st.divisor), 2) : round(st.divisor, 2));
  const num = (v) => { const n = parseFloat(String(v).replace(',', '.')); return Number.isFinite(n) && n >= 0 ? n : NaN; };

  function paint() {
    for (const k of ['l', 'w', 'h']) F(k).value = st[k] > 0 ? String(lenOut(st[k])) : '';
    F('wt').value = st.kg >= 0 && Number.isFinite(st.kg) ? String(wtOut(st.kg)) : '';
    F('qty').value = String(st.qty || '');
    F('rule').value = st.rule;
    F('dunit').value = st.dunit;
    F('divisor').value = st.divisor > 0 ? String(divOut()) : '';
    root.querySelectorAll('[data-ul]').forEach((e) => { e.textContent = units === 'metric' ? '(cm)' : '(in)'; });
    root.querySelectorAll('[data-uw]').forEach((e) => { e.textContent = units === 'metric' ? '(kg)' : '(lb)'; });
    root.querySelectorAll('[data-units]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.units === units)));
    root.querySelectorAll('[data-shape]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.shape === st.shape)));
    const custom = st.rule === 'custom', air = st.rule === 'air';
    $('[data-custom]').hidden = !custom;
    $('[data-shapebox]').hidden = custom || air;
  }

  function calc() {
    const air = st.rule === 'air';
    const rule = air ? null : rules.find((r) => r.id === st.rule) || null;
    const c = air ? dimCalc({ l: st.l, w: st.w, h: st.h, kg: st.kg, qty: st.qty }, null, 'rect', fromCm3PerKg(AIR_CM3_PER_KG), 'cm3kg')
      : dimCalc({ l: st.l, w: st.w, h: st.h, kg: st.kg, qty: st.qty }, rule, st.shape, st.divisor, st.dunit);
    const warn = [];
    if (!c) {
      R('main').textContent = '–'; R('dim').textContent = '–';
      for (const k of ['why', 'price', 'total']) R(k).textContent = '';
      R('steps').textContent = 'Enter a length, width, height and weight (and a divisor above 0) to see the steps.';
      R('warn').hidden = false; R('warn').textContent = 'Enter a length, width and height above 0 and a weight.';
      return;
    }
    const q = c.qty;
    if (c.usps) {
      R('main').textContent = `${fmt(c.billLb, 2)} lb`;
      R('mainsub').textContent = lbkg(c.billLb);
      R('dim').textContent = c.applies ? `${fmt(c.dimLb)} lb` : 'Not applied';
      R('dimsub').textContent = c.applies ? lbkg(c.dimLb) : `${fmt(c.factor !== 1 ? c.adj : c.vol, 2)} in³ is not over 1,728 in³`;
      R('why').textContent = !c.applies
        ? `The package is not over 1 cubic foot (1,728 in³) after rounding, so USPS charges the actual weight, ${fmt(c.actualLb, 2)} lb.`
        : c.byDim ? `The dimensional weight is higher: you pay for ${fmt(c.dimLb)} lb, not the ${fmt(c.actualLb, 2)} lb the package weighs.`
          : `The actual weight, ${fmt(c.actualLb, 2)} lb, is higher than the dimensional weight, so you pay the actual weight.`;
      R('price').textContent = c.actualLb <= 1 && !c.applies
        ? 'Priced as 1 lb or less: Priority Mail charges at least the 1-pound price; USPS Ground Advantage retail uses ounce steps up to 1 lb.'
        : `Priced as ${fmt(c.priceLb)} lb per package: any fraction of a pound counts as a whole pound.`;
      R('total').textContent = q > 1 ? `${fmt(q)} packages: ${fmt(c.billLb * q, 2)} lb billable (${lbkg(c.billLb * q)}), priced as ${fmt(c.priceLb * q)} lb in total.` : '';
      if (c.capped) warn.push(`The dimensional weight is over ${c.cap} lb: under the USPS rule the customer pays the ${c.cap}-pound price.`);
      if (c.over) warn.push(`The actual weight is over ${c.cap} lb. Priority Mail may weigh no more than 70 pounds (DMM 123 2.1).`);
      // live steps
      const ex = c.exact.map((x) => fmt(x, 2)).join(' × ');
      const how = c.round === 'off' ? 'rounded off' : 'rounded up';
      let s = `${ex} in → ${how} to whole inches: ${c.sides.join(' × ')} in<br>${c.sides.join(' × ')} = ${fmt(c.vol)} in³`;
      if (c.factor !== 1) s += `<br>× ${c.factor} (not rectangular) = ${fmt(c.adj, 3)} in³`;
      const v = c.factor !== 1 ? c.adj : c.vol;
      s += c.applies
        ? `<br>${fmt(v, 3)} in³ is over 1,728 in³ → ${fmt(v, 3)} ÷ ${c.divisor} = ${fmt(v / c.divisor, 3)} → rounded up: ${fmt(c.dimLb)} lb`
        : `<br>${fmt(v, 3)} in³ is not over 1,728 in³ → no dimensional weight`;
      s += `<br>Billable = greater of actual ${fmt(c.actualLb, 2)} lb and dimensional ${c.applies ? fmt(c.dimLb) + ' lb' : '–'} = ${fmt(c.billLb, 2)} lb`;
      R('steps').innerHTML = s;
    } else {
      const wu = c.metric ? 'kg' : 'lb', vu = c.metric ? 'cm³' : 'in³', lu = c.metric ? 'cm' : 'in';
      R('main').textContent = `${fmt(c.bill, 2)} ${wu}`;
      R('mainsub').textContent = c.metric ? kglb(c.bill) : lbkg(c.bill);
      R('dim').textContent = `${fmt(c.dim, 2)} ${wu}`;
      R('dimsub').textContent = `rounded up: ${fmt(roundUp(c.dim))} ${wu}`;
      R('why').textContent = c.byDim ? `The dimensional weight is higher than the ${fmt(c.actual, 2)} ${wu} the package weighs.` : `The actual weight, ${fmt(c.actual, 2)} ${wu}, is higher than the dimensional weight.`;
      R('price').textContent = air ? 'Air cargo chargeable weight: the greater of the actual weight and L × W × H in cm ÷ 6,000 (the IATA standard divisor). Some carriers use 5,000 instead, and each airline or forwarder rounds the chargeable weight in its own steps: check your quote.' : 'Sizes are not rounded here. Carriers have their own rules for rounding sizes and weights, and some apply dimensional weight only above a size: check your carrier\'s service guide.';
      R('total').textContent = q > 1 ? `${fmt(q)} packages: ${fmt(c.bill * q, 2)} ${wu} billable in total.` : '';
      R('steps').innerHTML = `${c.sides.map((x) => fmt(x, 2)).join(' × ')} ${lu} = ${fmt(c.vol, 2)} ${vu}`
        + `<br>${fmt(c.vol, 2)} ÷ ${fmt(c.divisor, 2)} ${vu} per ${wu} = ${fmt(c.dim, 2)} ${wu}`
        + `<br>Billable = greater of actual ${fmt(c.actual, 2)} ${wu} and dimensional ${fmt(c.dim, 2)} ${wu} = ${fmt(c.bill, 2)} ${wu}`;
    }
    R('warn').hidden = !warn.length; R('warn').textContent = warn.join(' ');
  }

  root.addEventListener('input', (e) => {
    const t = e.target, k = t.dataset && t.dataset.f; if (!k) return;
    if (k === 'l' || k === 'w' || k === 'h') { const n = num(t.value); st[k] = n > 0 ? (units === 'metric' ? n * 10 : n * MM_PER_IN) : 0; }
    else if (k === 'wt') { const n = num(t.value); st.kg = Number.isFinite(n) ? (units === 'metric' ? n : n * KG_PER_LB) : NaN; }
    else if (k === 'qty') { const n = parseInt(t.value, 10); st.qty = Number.isFinite(n) && n > 0 ? Math.min(n, 1e6) : 1; }
    else if (k === 'divisor') { const n = num(t.value); st.divisor = n > 0 ? (st.dunit === 'cm3kg' ? fromCm3PerKg(n) : n) : 0; }
    else return;
    calc();
  });
  root.addEventListener('change', (e) => {
    const t = e.target, k = t.dataset && t.dataset.f;
    if (k === 'rule') { st.rule = t.value; paint(); calc(); }
    if (k === 'dunit') { st.dunit = t.value; paint(); calc(); }
  });
  root.querySelectorAll('[data-units]').forEach((b) => b.addEventListener('click', () => {
    units = b.dataset.units; try { localStorage.setItem('lpc-dim-units', units); } catch { /* ignore */ }
    paint(); calc();
  }));
  root.querySelectorAll('[data-shape]').forEach((b) => b.addEventListener('click', () => { st.shape = b.dataset.shape; paint(); calc(); }));
  paint(); calc();
}
