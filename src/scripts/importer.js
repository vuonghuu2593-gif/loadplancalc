// Box list import: an Excel workbook (.xlsx), a CSV/TSV file, or cells pasted from a spreadsheet.
// Everything runs in the browser (and in Node for tests); nothing is uploaded.
// Output: box types in mm and kg, plus plain-English notes on what was read, assumed or skipped.

const MM = { mm: 1, cm: 10, m: 1000, in: 25.4, inch: 25.4, inches: 25.4, ft: 304.8, feet: 304.8 };
const KG = { kg: 1, g: 0.001, lb: 0.45359237, lbs: 0.45359237, pound: 0.45359237, pounds: 0.45359237 };
export const MAX_TYPES = 10;
export const MAX_QTY = 20000;

// ---------- .xlsx (a zip of XML files) ----------
async function inflateRaw(bytes) {
  const ds = new DecompressionStream('deflate-raw');
  const out = await new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer();
  return new Uint8Array(out);
}
async function unzip(buf) {
  const u8 = new Uint8Array(buf); const dv = new DataView(buf);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('not a zip');
  const n = dv.getUint16(eocd + 10, true); let p = dv.getUint32(eocd + 16, true);
  const files = new Map(); const dec = new TextDecoder();
  for (let k = 0; k < n; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('bad zip directory');
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true), extra = dv.getUint16(p + 30, true), comment = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nameLen));
    const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
    files.set(name, { method, data: u8.subarray(start, start + csize) });
    p += 46 + nameLen + extra + comment;
  }
  return {
    has: (f) => files.has(f),
    text: async (f) => {
      const e = files.get(f); if (!e) return null;
      const raw = e.method === 0 ? e.data : e.method === 8 ? await inflateRaw(e.data) : null;
      if (!raw) throw new Error('unsupported compression');
      return dec.decode(raw).replace(/<(\/?)[A-Za-z][\w.-]*:(?=[A-Za-z])/g, '<$1'); // drop element prefixes such as <x:row>
    },
  };
}
const unxml = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d)).replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&amp;/g, '&');
const texts = (xml) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g)].map((m) => unxml(m[1] || '')).join('');
const colIndex = (ref) => { let n = 0; for (const ch of ref.replace(/\d+$/, '')) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; };

// Rows of the first worksheet as arrays of strings/numbers.
export async function readXlsx(buf) {
  const z = await unzip(buf);
  let sheet = 'xl/worksheets/sheet1.xml';
  const wb = await z.text('xl/workbook.xml'), rels = await z.text('xl/_rels/workbook.xml.rels');
  if (wb && rels) {
    const first = wb.match(/<sheet\b[^>]*\br:id="([^"]+)"/) || wb.match(/<sheet\b[^>]*\bid="([^"]+)"/);
    const rel = first && [...rels.matchAll(/<Relationship\b[^>]*>/g)].map((m) => m[0]).find((r) => r.includes(`Id="${first[1]}"`));
    const target = rel && rel.match(/Target="([^"]+)"/);
    if (target) { const t = target[1].replace(/^\//, ''); sheet = t.startsWith('xl/') ? t : 'xl/' + t; }
  }
  const xml = await z.text(sheet);
  if (!xml) throw new Error('no worksheet');
  const sstXml = await z.text('xl/sharedStrings.xml');
  const sst = sstXml ? [...sstXml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => texts(m[1])) : [];
  const rows = [];
  for (const rm of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const rAttr = rm[1].match(/\br="(\d+)"/); const ri = rAttr ? +rAttr[1] - 1 : rows.length;
    const row = [];
    for (const cm of (rm[2] || '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1]; const body = cm[2] || '';
      const ref = attrs.match(/\br="([A-Z]+\d+)"/); const ci = ref ? colIndex(ref[1]) : row.length;
      const type = (attrs.match(/\bt="([^"]+)"/) || [])[1];
      const v = (body.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
      let val = '';
      if (type === 's') val = sst[+v] ?? '';
      else if (type === 'inlineStr') val = texts(body);
      else if (type === 'str' || type === 'e') val = v != null ? unxml(v) : '';
      else if (type === 'b') val = v === '1' ? 'TRUE' : 'FALSE';
      else if (v != null) { const num = Number(v); val = Number.isFinite(num) ? num : unxml(v); }
      row[ci] = val;
    }
    for (let i = 0; i < row.length; i++) if (row[i] === undefined) row[i] = '';
    rows[ri] = row;
  }
  return rows.map((r) => r || []);
}

// ---------- CSV / TSV / pasted cells ----------
export function readDelimited(text) {
  text = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const first = text.split('\n').find((l) => l.trim()) || '';
  const count = (ch) => first.split(ch).length - 1;
  const delim = count('\t') > 0 ? '\t' : count(';') > count(',') ? ';' : ',';
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch;
    } else if (ch === '"' && cell === '') q = true;
    else if (ch === delim) { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return { rows, delim };
}

// "1,200" / "1.200,5" / "12,5" / "1 200" → number (null if not a number)
export function toNumber(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let s = String(v ?? '').trim().replace(/[\s ']/g, '');
  if (!s) return null;
  s = s.replace(/[a-zA-Z"]+$/, ''); // trailing unit like "40cm" or 12"
  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, '');
  else if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d+,\d+$/.test(s)) s = s.replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// ---------- columns ----------
const FIELDS = [
  ['name', /^(name|box( name| type)?|item|product|description|sku|carton( name)?|article|part( no\.?| number)?)$/],
  ['l', /^(length|len|l|long|depth)$/],
  ['w', /^(width|wid|w|wide|breadth)$/],
  ['h', /^(height|hgt|ht|h|high|tall)$/],
  ['weight', /^((gross |unit |carton |box )?weight|wt|gw|gross|mass|kg|lb|lbs)$/],
  ['qty', /^(qty|quantity|pcs|pieces|count|number|no\.?|cartons|boxes|units|ctns|q'?ty)$/],
  ['rotation', /^(orientation|rotation|this side up|upright|keep upright|position)$/],
  ['stackable', /^(stackable|stack|can carry boxes on top|can stack|stacking)$/],
  ['maxOnTop', /^(max(imum)? boxes on top|boxes on top|stacking limit|stack limit|max(imum)? stack(ing)?( number)?|max on top)$/],
  ['maxLoad', /^(max(imum)? (weight|load|mass) on top|weight on top|load on top|stacking load|max(imum)? stacking (load|weight|mass))$/],
];
const unitOf = (h) => { const m = h.match(/[([]\s*([a-z]+)\s*[)\]]/i) || h.match(/\b(mm|cm|m|in|inch|inches|ft|kg|g|lb|lbs)\s*$/i); return m ? m[1].toLowerCase() : null; };
const bare = (h) => String(h).toLowerCase().replace(/[([].*?[)\]]/g, '').replace(/\b(mm|cm|in|inch|inches|ft|kg|lbs?)\s*$/i, '').replace(/[_*:.]+$/g, '').replace(/\s+/g, ' ').trim();
function headerMap(row) {
  const map = {}; const units = {};
  row.forEach((cell, i) => {
    const h = String(cell ?? '').trim(); if (!h) return;
    const b = bare(h);
    for (const [f, re] of FIELDS) if (map[f] === undefined && re.test(b)) { map[f] = i; units[f] = unitOf(h); break; }
  });
  return { map, units };
}
const yes = (v) => /^(y|yes|true|1|x|ok|có|co)$/i.test(String(v ?? '').trim());
const no = (v) => /^(n|no|false|0|không|khong)$/i.test(String(v ?? '').trim());

// rows → box types. `units`: 'metric' (cm, kg) or 'imperial' (in, lb) for columns whose header names no unit.
export function rowsToItems(rows, units = 'metric') {
  const notes = []; const skipped = [];
  const nonEmpty = rows.map((r, i) => ({ r, i })).filter(({ r }) => r.some((c) => String(c ?? '').trim() !== ''));
  if (!nonEmpty.length) return { items: [], notes: ['The file has no rows.'], skipped };
  // header = first row that names at least length, width and height
  let hi = nonEmpty.findIndex(({ r }) => { const { map } = headerMap(r); return map.l !== undefined && map.w !== undefined && map.h !== undefined; });
  let map, colUnits;
  if (hi >= 0) ({ map, units: colUnits } = headerMap(nonEmpty[hi].r));
  else { // no header: Name, Length, Width, Height, Weight, Quantity
    hi = -1; map = { name: 0, l: 1, w: 2, h: 3, weight: 4, qty: 5 }; colUnits = {};
    notes.push('No header row found, so the columns were read in the template order: name, length, width, height, weight, quantity.');
  }
  const defLen = units === 'imperial' ? 'in' : 'cm', defWt = units === 'imperial' ? 'lb' : 'kg';
  const lenU = ['l', 'w', 'h'].map((f) => colUnits[f] && MM[colUnits[f]] ? colUnits[f] : defLen);
  const wtU = colUnits.weight && KG[colUnits.weight] ? colUnits.weight : defWt;
  if (['l', 'w', 'h'].some((f) => !colUnits[f] || !MM[colUnits[f]])) notes.push(`Sizes without a unit in the header were read as ${defLen === 'cm' ? 'centimetres' : 'inches'}.`);
  if (map.weight !== undefined && !(colUnits.weight && KG[colUnits.weight])) notes.push(`Weights without a unit in the header were read as ${defWt === 'kg' ? 'kilograms' : 'pounds'}.`);
  const items = [];
  for (const { r, i } of nonEmpty.slice(hi + 1)) {
    const rowNo = i + 1;
    const get = (f) => (map[f] === undefined ? '' : r[map[f]]);
    const l = toNumber(get('l')), w = toNumber(get('w')), h = toNumber(get('h'));
    if (!(l > 0 && w > 0 && h > 0)) { skipped.push(`row ${rowNo} (needs a length, width and height above 0)`); continue; }
    const wt = map.weight === undefined ? 0 : toNumber(get('weight'));
    let qty = map.qty === undefined ? 1 : toNumber(get('qty'));
    if (qty === null || qty < 0) { skipped.push(`row ${rowNo} (quantity is not a number)`); continue; }
    qty = Math.floor(qty);
    if (qty > MAX_QTY) { notes.push(`Row ${rowNo}: quantity cut to ${MAX_QTY.toLocaleString('en-US')}, the most per box type.`); qty = MAX_QTY; }
    const rv = String(get('rotation') ?? '').trim().toLowerCase();
    const hdrRot = map.rotation !== undefined ? bare(rows[hi]?.[map.rotation] ?? '') : '';
    let rotation = 'any';
    if (/^(this side up|upright|keep upright)$/.test(hdrRot)) rotation = yes(rv) ? 'upright' : 'any';
    else if (/upright|this side up|side up|keep|^up$|vertical/.test(rv)) rotation = 'upright';
    const sv = get('stackable');
    const stackable = map.stackable === undefined || String(sv ?? '').trim() === '' ? true : !no(sv);
    const name = String(get('name') ?? '').trim().slice(0, 40) || `Box ${items.length + 1}`;
    // optional stacking limits; empty means no limit
    const onTop = map.maxOnTop === undefined || String(get('maxOnTop') ?? '').trim() === '' ? null : toNumber(get('maxOnTop'));
    const mlU = colUnits.maxLoad && KG[colUnits.maxLoad] ? colUnits.maxLoad : wtU;
    const ml = map.maxLoad === undefined || String(get('maxLoad') ?? '').trim() === '' ? null : toNumber(get('maxLoad'));
    const limits = {};
    if (onTop != null && onTop >= 0) limits.maxOnTop = Math.floor(onTop);
    if (ml != null && ml >= 0) limits.maxLoad = round6(ml * KG[mlU]);
    items.push({
      name, l: round6(l * MM[lenU[0]]), w: round6(w * MM[lenU[1]]), h: round6(h * MM[lenU[2]]),
      weight: wt > 0 ? round6(wt * KG[wtU]) : 0, qty, rotation, stackable, ...limits,
    });
  }
  if (items.length > MAX_TYPES) { notes.push(`The planner takes up to ${MAX_TYPES} box types; the first ${MAX_TYPES} were loaded and ${items.length - MAX_TYPES} left out.`); items.length = MAX_TYPES; }
  return { items, notes, skipped };
}
const round6 = (v) => Math.round(v * 1e9) / 1e9; // clears float noise only

// One entry point for a File (browser) or { name, arrayBuffer() } (tests).
export async function readBoxFile(file, units) {
  const name = (file.name || '').toLowerCase();
  const buf = await file.arrayBuffer();
  const u8 = new Uint8Array(buf);
  let rows;
  if (u8[0] === 0x50 && u8[1] === 0x4b) rows = await readXlsx(buf);
  else if (u8[0] === 0xd0 && u8[1] === 0xcf) throw new Error('This is an old Excel file (.xls). In Excel choose File › Save As › Excel Workbook (.xlsx) or CSV, then import that.');
  else if (/\.(xlsx|xlsm)$/.test(name)) throw new Error('The file could not be read as an Excel workbook.');
  else rows = readDelimited(new TextDecoder().decode(u8)).rows;
  return rowsToItems(rows, units);
}
