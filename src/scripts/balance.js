// Weight distribution of a load plan. Pure JS, no DOM (page and Node tests). Units: mm and kg.
// Axes as in packer.js: x = length from the back wall (the closed end) toward the door, y = width (0 = the right side
// wall as seen from the door), z = height from the floor. Each box's mass is taken at its middle (evenly filled box).
//
// Centre of gravity: CTU Code (IMO/ILO/UNECE, MSC.1/Circ.1497) annex 7, appendix 4, section 3: d = Σ(m·d) / Σm.
// Guidance used for the verdicts (annex 7):
//   1.11  lengthwise "within allowed limits", crosswise "close to the half width", vertically "below half the height
//         of the cargo space";
//   3.1.4 containers lifted level: eccentricity "should not exceed 5% in general", "up to 10% could be accepted"
//         under particular circumstances. We measure eccentricity as the distance from mid-length as a share of
//         the inside length.
// Axle loads: plain statics on two supports (front support = kingpin or front axle, rear support = middle of the rear
// axle group), from positions the user enters. Nothing about any truck's geometry is assumed.
export const ECC_NORMAL = 0.05, ECC_MAX = 0.10;

export function cog(boxes, items) {
  let m = 0, sx = 0, sy = 0, sz = 0;
  for (const b of boxes) {
    const w = +items[b.k]?.weight || 0;
    if (!(w > 0)) continue;
    m += w; sx += w * (b.x + b.dx / 2); sy += w * (b.y + b.dy / 2); sz += w * (b.z + b.dz / 2);
  }
  return m > 0 ? { m, x: sx / m, y: sy / m, z: sz / m } : null;
}

// offsets from the middle as shares of the inside size (+ = toward the door / toward the left wall), height share of H
export function offsets(c, cont) {
  return { long: (c.x - cont.L / 2) / cont.L, trans: (c.y - cont.W / 2) / cont.W, vert: c.z / cont.H };
}
// 'ok' (≤ 5%), 'tolerated' (≤ 10%: only with spreaders that adjust for it), 'over' (> 10%)
export const longVerdict = (e) => (Math.abs(e) <= ECC_NORMAL + 1e-9 ? 'ok' : Math.abs(e) <= ECC_MAX + 1e-9 ? 'tolerated' : 'over');
export const vertOk = (share) => share < 0.5;

// Cargo mass m (kg) with its centre at d (mm from the back wall), carried on a front support at `front` and a rear
// support at `rear` (mm from the back wall; front may be negative = ahead of the back wall). Moment balance about
// the front support: rear · (rear − front) = m · (d − front). Returns null when the positions cannot work.
export function axleSplit(m, d, front, rear) {
  if (![m, d, front, rear].every(Number.isFinite) || !(rear > front) || !(m >= 0)) return null;
  const onRear = m * (d - front) / (rear - front);
  return { front: m - onRear, rear: onRear, outside: d < front || d > rear };
}

// US federal limits on the Interstate System, 23 CFR 658.17 (c) single axle, (d) tandem axles, (b) gross; in lb.
export const US_LIMITS_LB = { single: 20000, tandem: 34000, gross: 80000 };
