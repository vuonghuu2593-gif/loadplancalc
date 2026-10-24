// Dunnage bag check from the IMO/ILO/UNECE CTU Code (MSC.1/Circ.1497), annex 7, appendix 4, section 4:
//   force from the cargo, sliding:  F = m · g · (c − µ · 0.75 · cz)       [kN, m in t]
//   force from the cargo, tipping:  F = m · g · (c − bp/hp · cz)
//   force the bag can take:         FDB = A · 10 · g · PB · SF          [kN, A in m², PB in bar]
//   contact area:                   A = (bDB − π · d/2) · (hDB − π · d/2)
// with g = 9.81 m/s² and π = 3.14 as the Code writes them, SF 0.75 single use / 0.5 reusable.
// Acceleration coefficients: chapter 5 tables (rail without the bracketed shock values).
export const G = 9.81, PI = 3.14;
export const MODES = [
  { id: 'road-f', label: 'Road, forward (braking)', c: 0.8, cz: 1.0, dir: 'long' },
  { id: 'road-b', label: 'Road, backward', c: 0.5, cz: 1.0, dir: 'long' },
  { id: 'road-s', label: 'Road, sideways', c: 0.5, cz: 1.0, dir: 'trans' },
  { id: 'rail-l', label: 'Rail (combined transport), forward or backward', c: 0.5, cz: 1.0, dir: 'long' },
  { id: 'rail-s', label: 'Rail (combined transport), sideways', c: 0.5, cz: 1.0, dir: 'trans' },
  { id: 'sea-a-l', label: 'Sea area A (Hs ≤ 8 m), lengthwise', c: 0.3, cz: 0.5, dir: 'long' },
  { id: 'sea-a-s', label: 'Sea area A (Hs ≤ 8 m), sideways', c: 0.5, cz: 1.0, dir: 'trans' },
  { id: 'sea-b-l', label: 'Sea area B (8 m < Hs ≤ 12 m), lengthwise', c: 0.3, cz: 0.3, dir: 'long' },
  { id: 'sea-b-s', label: 'Sea area B (8 m < Hs ≤ 12 m), sideways', c: 0.7, cz: 1.0, dir: 'trans' },
  { id: 'sea-c-l', label: 'Sea area C (Hs > 12 m), lengthwise', c: 0.4, cz: 0.2, dir: 'long' },
  { id: 'sea-c-s', label: 'Sea area C (Hs > 12 m), sideways', c: 0.8, cz: 1.0, dir: 'trans' },
];
// force on the bag for one mode; m in kg, bp and hp in m → kN (never below 0)
export function cargoForce(mKg, mode, mu, bp, hp) {
  const t = mKg / 1000;
  const slide = t * G * (mode.c - mu * 0.75 * mode.cz);
  const tip = bp > 0 && hp > 0 ? t * G * (mode.c - (bp / hp) * mode.cz) : -Infinity;
  const f = Math.max(slide, tip, 0);
  return { slide, tip, f, by: f <= 0 ? 'none' : slide >= tip ? 'sliding' : 'tipping' };
}
export const area = (bDB, hDB, d) => Math.max(0, bDB - PI * d / 2) * Math.max(0, hDB - PI * d / 2);
export const bagForce = (A, pb, sf) => A * 10 * G * pb * sf; // kN
export const pbNeeded = (F, A, sf) => (A > 0 && sf > 0 ? F / (A * 10 * G * sf) : Infinity); // bar
// exact unit definitions for the imperial view
export const LB = 0.45359237, IN = 0.0254, LBF_N = 0.45359237 * 9.80665, PSI_PA = LBF_N / (0.0254 ** 2);
