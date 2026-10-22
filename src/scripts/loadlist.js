// Loading list: a plan cut into sections along the length (container: from the back wall to the door),
// each listed layer by layer from the floor up, with the box type, count and position of every group.
// All figures come from the plan (mm / kg); the page formats them in the units chosen.
//
// How the sections are found:
// 1. Semi-automatic steps stay apart: a new section starts whenever the step changes.
// 2. Interlocked container plans are built in walls of equal length S from the back wall: every box
//    of wall i (x from i·S) is in section i. The space in front of the last wall is treated as in 3.
// 3. Other plans: boxes are sorted along the length and a section ends where no box crosses the line
//    (a clean face across the whole load). When boxes of different lengths overlap so that no clean
//    line comes for a long way, the run is cut at the first box start at least T = max(1200 mm, twice
//    the longest box length along) from the section start, and each box goes to the section in which
//    its back face lies. A box that rests on a box of a later section moves to that later section, so a
//    box never comes before a box it stands on.
// 4. Pallet mode: the whole pallet is one section (one per step in semi-automatic mode).
// Within a section the boxes go layer by layer (z from the floor up); within a layer, group by group
// (box type and position, in the order they first appear from the back and from the right wall), and
// each group from the back toward the door and from the right wall across. This order is also the
// order of the 3D loading-step slider, so its counts and the list's running totals agree.

const EPS = 0.5; // mm

export function loadList(boxes, items, opts = {}) {
  const { pallet = false, wall = null, orientOf = () => -1 } = opts;
  const runs = []; let cur = null;
  for (const b of boxes) {
    const s = b.s ?? -1;
    if (!cur || cur.s !== s) { cur = { s, list: [] }; runs.push(cur); }
    cur.list.push(b);
  }
  const groups = []; // arrays of boxes, one per section, in loading order
  for (const run of runs) {
    if (pallet) { groups.push(run.list); continue; }
    let rest = run.list;
    if (wall && wall.S > 0 && wall.k > 0) {
      const front = wall.S * wall.k; const walls = [];
      rest = [];
      for (const b of run.list) {
        if (b.x < front - EPS) { const i = Math.min(wall.k - 1, Math.floor((b.x + EPS) / wall.S)); (walls[i] ||= []).push(b); } else rest.push(b);
      }
      for (const w of walls) if (w && w.length) groups.push(w);
    }
    for (const g of chains(rest)) groups.push(g);
  }
  // build sections
  const sections = []; let soFar = 0, wSoFar = 0;
  for (const g of groups) {
    const sorted = orderSection(g, items, orientOf);
    const sec = { step: g[0].s ?? -1, x0: Infinity, x1: -Infinity, n: sorted.length, w: 0, layers: [], boxes: sorted };
    let lay = null, grp = null;
    for (const b of sorted) {
      sec.x0 = Math.min(sec.x0, b.x); sec.x1 = Math.max(sec.x1, b.x + b.dx);
      const m = items[b.k]?.weight || 0; sec.w += m;
      if (!lay || Math.abs(b.z - lay.z) > EPS) { lay = { z: b.z, top: b.z + b.dz, n: 0, groups: [] }; sec.layers.push(lay); grp = null; }
      lay.top = Math.max(lay.top, b.z + b.dz); lay.n++;
      const o = b._o;
      if (!grp || grp.k !== b.k || grp.o !== o) { grp = { k: b.k, o, n: 0, w: 0, x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity }; lay.groups.push(grp); }
      grp.n++; grp.w += m;
      grp.x0 = Math.min(grp.x0, b.x); grp.x1 = Math.max(grp.x1, b.x + b.dx); grp.y0 = Math.min(grp.y0, b.y); grp.y1 = Math.max(grp.y1, b.y + b.dy);
      soFar++; wSoFar += m; grp.soFar = soFar; grp.wSoFar = wSoFar;
    }
    sec.soFar = soFar; sec.wSoFar = wSoFar;
    sections.push(sec);
  }
  for (const s of sections) for (const b of s.boxes) delete b._o;
  return { sections, order: sections.flatMap((s) => s.boxes), n: soFar, w: wSoFar };
}

// Sections of boxes along the length (rule 3 above).
function chains(list) {
  if (!list.length) return [];
  const byX = list.slice().sort((a, b) => a.x - b.x);
  const out = []; let c = null;
  for (const b of byX) {
    if (!c || b.x >= c.x1 - EPS) { c = { x0: b.x, x1: b.x + b.dx, list: [] }; out.push(c); }
    c.x1 = Math.max(c.x1, b.x + b.dx); c.list.push(b);
  }
  return out.flatMap((ch) => splitLong(ch));
}
function splitLong(ch) {
  const T = Math.max(1200, 2 * Math.max(...ch.list.map((b) => b.dx)));
  if (ch.x1 - ch.x0 <= 1.5 * T) return [ch.list];
  // cut lines at box starts, at least T apart, none closer than T/2 to the end of the run
  const starts = [...new Set(ch.list.map((b) => b.x))].sort((a, b) => a - b);
  const cuts = [ch.x0];
  for (const x of starts) if (x >= cuts[cuts.length - 1] + T - EPS && ch.x1 - x >= T / 2) cuts.push(x);
  if (cuts.length === 1) return [ch.list];
  const sec = new Map();
  const binOf = (x) => { let i = 0; while (i + 1 < cuts.length && x >= cuts[i + 1] - EPS) i++; return i; };
  for (const b of ch.list) sec.set(b, binOf(b.x));
  // a box never comes before a box it stands on: bottom up, take the latest section of the boxes below
  const byTop = new Map();
  for (const b of ch.list) { const k = Math.round(b.z + b.dz); (byTop.get(k) || byTop.set(k, []).get(k)).push(b); }
  const up = ch.list.slice().sort((a, b) => a.z - b.z);
  for (const a of up) {
    if (a.z < EPS) continue;
    let s = sec.get(a);
    for (const k of [Math.round(a.z) - 1, Math.round(a.z), Math.round(a.z) + 1]) for (const b of byTop.get(k) || []) {
      if (Math.abs(b.z + b.dz - a.z) > EPS) continue;
      const ox = Math.min(a.x + a.dx, b.x + b.dx) - Math.max(a.x, b.x), oy = Math.min(a.y + a.dy, b.y + b.dy) - Math.max(a.y, b.y);
      if (ox > EPS && oy > EPS && sec.get(b) > s) s = sec.get(b);
    }
    sec.set(a, s);
  }
  const bins = [];
  for (const b of ch.list) (bins[sec.get(b)] ||= []).push(b);
  return bins.filter((x) => x && x.length);
}
// Layer by layer from the floor; in a layer group by group (type, position), each from the back and the right wall.
function orderSection(list, items, orientOf) {
  for (const b of list) b._o = orientOf(items[b.k], b);
  const byXY = list.slice().sort((a, b) => a.z - b.z || a.x - b.x || a.y - b.y);
  const out = []; let i = 0;
  while (i < byXY.length) {
    let j = i; while (j < byXY.length && Math.abs(byXY[j].z - byXY[i].z) <= EPS) j++;
    const layer = byXY.slice(i, j); const keys = [];
    for (const b of layer) { const key = b.k + ':' + b._o; if (!keys.includes(key)) keys.push(key); }
    for (const key of keys) for (const b of layer) if (b.k + ':' + b._o === key) out.push(b);
    i = j;
  }
  return out;
}

// CSV text: one row per section, layer, box type and position. fmtLen / fmtWt turn mm / kg into the
// numbers shown (already rounded), names[k] / pos(o) give the labels.
export function loadListCsv(list, { lenU, wtU, fmtLen, fmtWt, names, pos, pallet = false, stepName = () => '', offset = 0 }) {
  const q = (v) => { const s = String(v ?? ''); return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const from = pallet ? 'back edge' : 'back wall';
  const head = ['Section', 'Step', `Section from ${from} (${lenU})`, `Section to (${lenU})`, 'Layer', `Layer bottom above ${pallet ? 'pallet deck' : 'floor'} (${lenU})`, 'Box type', 'Position', 'Boxes',
    `Along from ${from} (${lenU})`, `Along to (${lenU})`, `Across from right ${pallet ? 'edge' : 'wall'} (${lenU})`, `Across to (${lenU})`, `Weight (${wtU})`, 'Boxes loaded so far', `Weight so far (${wtU})`];
  const rows = [head];
  list.sections.forEach((s, si) => s.layers.forEach((l, li) => l.groups.forEach((g) => {
    rows.push([si + 1, stepName(s.step), fmtLen(s.x0 - offset), fmtLen(s.x1 - offset), li + 1, fmtLen(l.z), names[g.k], pos(g.o), g.n,
      fmtLen(g.x0 - offset), fmtLen(g.x1 - offset), fmtLen(g.y0 - offset), fmtLen(g.y1 - offset), fmtWt(g.w), g.soFar, fmtWt(g.wSoFar)]);
  })));
  return rows.map((r) => r.map(q).join(',')).join('\r\n') + '\r\n';
}
