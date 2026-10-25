// Blocking with transverse timber battens, CTU Code (IMO/ILO/UNECE, MSC.1/Circ.1497), annex 7:
//   appendix 4, section 1:  F = n · w² · h / (28 · L)  [kN]   (w, h in cm, L = free length in m)
//   section 2.2.2 / the appendix 4 example: the cargo stays put when c · m · g ≤ µ · m · cz · g + F,
//   with the static friction factor µ (2.2.2.1: appendix 2 factors are static and "may be used for cargoes secured
//   by blocking"), m in t and g = 9.81. c and cz are the chapter 5 coefficients (MODES in dunnage.js).
export const G = 9.81;
export const battenForce = (w, h, L) => (w > 0 && h > 0 && L > 0 ? (w * w * h) / (28 * L) : 0); // one batten, kN
export const blockingNeeded = (mKg, mode, mu) => Math.max(0, (mKg / 1000) * G * (mode.c - mu * mode.cz)); // kN
export function blocking({ kg, mode, mu, n, w, h, L }) {
  const t = kg / 1000;
  const push = t * G * mode.c, friction = mu * t * mode.cz * G;
  const need = Math.max(0, push - friction);
  const per = battenForce(w, h, L);
  const have = n * per;
  return { push, friction, need, per, have, ok: have >= need - 1e-9, nNeeded: per > 0 ? Math.ceil(need / per - 1e-9) : Infinity };
}
