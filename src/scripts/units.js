// Exact definitions: 1 in = 25.4 mm, 1 lb = 0.45359237 kg.
export const MM_PER_IN = 25.4;
export const KG_PER_LB = 0.45359237;
export const U = {
  metric: { len: 'cm', wt: 'kg', toMM: (v) => v * 10, fromMM: (mm) => mm / 10, toKG: (v) => v, fromKG: (kg) => kg, lenStep: 0.1 },
  imperial: { len: 'in', wt: 'lb', toMM: (v) => v * MM_PER_IN, fromMM: (mm) => mm / MM_PER_IN, toKG: (v) => v * KG_PER_LB, fromKG: (kg) => kg / KG_PER_LB, lenStep: 0.01 },
};
export const round = (v, d = 2) => { const f = 10 ** d; return Math.round(v * f) / f; };
export const fmt = (v, d = 0) => Number(v).toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: 0 });
