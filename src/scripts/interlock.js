// Interlocked layers for one box type: the layer pattern changes from one layer to the next, so the
// seams between boxes do not line up and boxes in the upper layer bridge two or more boxes below
// ("cross-tied" or "brick" stacking). A column stack (every layer the same) packs the most boxes but
// leaves free-standing columns that can lean apart; interlocking ties the load together.
//
// Method: generate 2D layer patterns for the floor (one-block grids, two- and three-block guillotine
// patterns, four-block pinwheels), keep the fullest ones, and take each pattern's mirror images.
// A pair of layers (A, B) is usable only if every box of B stands fully on A and every box of A
// stands fully on B, so A, B, A, B... is supported at every level (validate() still checks this).
// The pair with the most boxes per two layers wins among pairs that tie the load; ties are scored by
// the share of boxes that rest on two or more boxes of the layer below.
// Units: mm. x = along the length, y = across.

const EPS = 0.01;

function grid(fp, X, Y, ox, oy, out) {
  const nx = Math.floor((X + EPS) / fp[0]), ny = Math.floor((Y + EPS) / fp[1]);
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) out.push({ x: ox + i * fp[0], y: oy + j * fp[1], dx: fp[0], dy: fp[1] });
  return { nx, ny, w: nx * fp[0], h: ny * fp[1] };
}

// Multiples of a and b that fit in X (for cut positions).
function cuts(X, a, limit = 40) {
  const out = [];
  for (let n = 1; n * a <= X + EPS && out.length < limit; n++) out.push(n * a);
  return out;
}

const key = (p) => p.map((r) => `${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.dx)}`).sort().join(';');

// All candidate patterns of footprints `fps` ([[dx, dy], ...], one or two of them) on an X x Y floor.
export function patterns(X, Y, fps, max = 3000) {
  const out = [];
  const add = (p) => { if (p.length && out.length < max) out.push(p); };
  for (const f of fps) { const p = []; grid(f, X, Y, 0, 0, p); add(p); }
  for (const f1 of fps) for (const f2 of fps) {
    if (f1 === f2) continue;
    // two blocks: cut along x, then along y
    for (const c of cuts(X, f1[0])) { const p = []; grid(f1, c, Y, 0, 0, p); grid(f2, X - c, Y, c, 0, p); add(p); }
    for (const c of cuts(Y, f1[1])) { const p = []; grid(f1, X, c, 0, 0, p); grid(f2, X, Y - c, 0, c, p); add(p); }
  }
  // three blocks: one cut, then the second part cut the other way
  for (const f1 of fps) for (const f2 of fps) for (const f3 of fps) {
    if (f2 === f3) continue;
    if (out.length >= max) break;
    for (const c of cuts(X, f1[0], 12)) for (const d of cuts(Y, f2[1], 12)) {
      const p = []; grid(f1, c, Y, 0, 0, p); grid(f2, X - c, d, c, 0, p); grid(f3, X - c, Y - d, c, d, p); add(p);
    }
    for (const c of cuts(Y, f1[1], 12)) for (const d of cuts(X, f2[0], 12)) {
      const p = []; grid(f1, X, c, 0, 0, p); grid(f2, d, Y - c, 0, c, p); grid(f3, X - d, Y - c, d, c, p); add(p);
    }
  }
  // pinwheel: B1 [0,X1]x[0,Y1], B2 [X1,X]x[0,Y2], B3 [X2,X]x[Y2,Y], B4 [0,X2]x[Y1,Y], X1 <= X2, Y2 <= Y1
  if (fps.length === 2) for (const [a, b] of [fps, [fps[1], fps[0]]]) {
    for (const X1 of cuts(X, a[0], 12)) for (const Y1 of cuts(Y, a[1], 12)) for (const Y2 of cuts(Y, b[1], 12)) {
      if (Y2 > Y1 + EPS) continue;
      for (const w3 of cuts(X, a[0], 12)) {
        const X2 = X - w3;
        if (X2 < X1 - EPS) continue;
        const p = [];
        grid(a, X1, Y1, 0, 0, p);
        const g2 = grid(b, X - X1, Y2, 0, 0, []); grid(b, X - X1, Y2, X - g2.w, 0, p);
        const g3 = grid(a, X - X2, Y - Y2, 0, 0, []); grid(a, X - X2, Y - Y2, X - g3.w, Y - g3.h, p);
        const g4 = grid(b, X2, Y - Y1, 0, 0, []); grid(b, X2, Y - Y1, 0, Y - g4.h, p);
        add(p);
      }
    }
  }
  return out;
}

// Centre a pattern's bounding box on the floor (equal margins each side).
function centre(p, X, Y) {
  let mx = Infinity, my = Infinity, Mx = -Infinity, My = -Infinity;
  for (const r of p) { mx = Math.min(mx, r.x); my = Math.min(my, r.y); Mx = Math.max(Mx, r.x + r.dx); My = Math.max(My, r.y + r.dy); }
  const ox = (X - (Mx - mx)) / 2 - mx, oy = (Y - (My - my)) / 2 - my;
  return p.map((r) => ({ ...r, x: r.x + ox, y: r.y + oy }));
}

const mirrorX = (p, X) => p.map((r) => ({ ...r, x: X - r.x - r.dx }));
const mirrorY = (p, Y) => p.map((r) => ({ ...r, y: Y - r.y - r.dy }));

const overlap = (a, b) => Math.max(0, Math.min(a.x + a.dx, b.x + b.dx) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.dy, b.y + b.dy) - Math.max(a.y, b.y));

// Every box of `up` must be carried by `down`: at least `min` of its base area on boxes below and,
// when min < 1, its centre over one of them (the rule validate() uses). Returns the share of `up`
// boxes that rest on two or more boxes (each carrying at least 10% of the box), or -1 if a box is not
// carried.
export function tie(up, down, min = 1) {
  let tied = 0;
  for (const u of up) {
    let area = 0, n = 0, centre = false; const need = u.dx * u.dy;
    const cx = u.x + u.dx / 2, cy = u.y + u.dy / 2;
    for (const d of down) {
      const o = overlap(u, d);
      if (o > 0) {
        area += o; if (o >= 0.1 * need) n++;
        if (cx >= d.x - EPS && cx <= d.x + d.dx + EPS && cy >= d.y - EPS && cy <= d.y + d.dy + EPS) centre = true;
      }
    }
    if (area < min * need - 1 || (min < 1 && !centre)) return -1;
    if (n >= 2) tied++;
  }
  return up.length ? tied / up.length : 0;
}

// Best interlocked pair of layers. `fps` = allowed footprints for the chosen height; `mirror` = which
// mirror images the second layer may use ('xy' for a pallet; 'y' for a container section, so every
// layer keeps the same front and back lines and the section can be loaded as one wall).
// Returns { A, B, n: boxes in two layers, tie } or null when no pair ties the layers.
export function bestPair(X, Y, fps, opts = {}) {
  const mirror = opts.mirror ?? 'xy'; const min = opts.min ?? 1; const deadline = opts.deadline ?? Infinity;
  const seen = new Set(); let pool = [];
  for (const p of patterns(X, Y, fps)) {
    const c = opts.alignX ? centreY(p, Y) : centre(p, X, Y);
    const k = key(c); if (seen.has(k)) continue; seen.add(k); pool.push(c);
  }
  if (!pool.length) return null;
  const max = Math.max(...pool.map((p) => p.length));
  const floorN = Math.max(1, Math.floor(max * (opts.keep ?? 0.75)));
  pool = pool.filter((p) => p.length >= floorN).sort((a, b) => b.length - a.length).slice(0, opts.poolSize ?? 400);
  const variants = (p) => {
    const v = [p];
    if (mirror.includes('x')) v.push(mirrorX(p, X));
    if (mirror.includes('y')) v.push(mirrorY(p, Y));
    if (mirror === 'xy') v.push(mirrorY(mirrorX(p, X), Y));
    return v;
  };
  const all = pool.flatMap(variants);
  let best = null;
  for (let i = 0; i < pool.length; i++) {
    const A = pool[i];
    if (best && 2 * A.length < best.n) break; // sorted by size: nothing better can follow
    if (Date.now() > deadline) break;
    for (const B of all) {
      const n = A.length + B.length;
      if (best && n < best.n) continue;
      const t1 = tie(B, A, min); if (t1 <= 0) continue;
      const t2 = tie(A, B, min); if (t2 <= 0) continue;
      const t = Math.min(t1, t2);
      if (!best || n > best.n || (n === best.n && t > best.tie + 1e-9)) best = { A, B, n, tie: t };
    }
  }
  return best;
}

// Centre across the width only (container sections keep x from 0).
function centreY(p, Y) {
  let my = Infinity, My = -Infinity;
  for (const r of p) { my = Math.min(my, r.y); My = Math.max(My, r.y + r.dy); }
  const oy = (Y - (My - my)) / 2 - my;
  return p.map((r) => ({ ...r, y: r.y + oy }));
}

// Most boxes in one layer (column stack reference), centred.
export function bestLayer(X, Y, fps) {
  let best = null;
  for (const p of patterns(X, Y, fps)) if (!best || p.length > best.length) best = p;
  return best ? centre(best, X, Y) : null;
}
