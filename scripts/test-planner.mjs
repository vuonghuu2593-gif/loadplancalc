// Browser checks of the planner: unit switch both ways without drift, imperial input, share link.
// Usage (after npm run build): node scripts/test-planner.mjs
import { chromium } from 'playwright';
import http from 'http'; import fs from 'fs'; import path from 'path';
const root = path.resolve('dist');
const types = { '.html': 'text/html', '.css': 'text/css', '.svg': 'image/svg+xml', '.js': 'text/javascript', '.woff2': 'font/woff2' };
const srv = http.createServer((q, s) => { let p = path.join(root, decodeURIComponent(q.url.split('?')[0])); if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html'); if (!fs.existsSync(p)) { s.statusCode = 404; s.end(); return; } s.setHeader('content-type', types[path.extname(p)] || 'text/plain'); s.end(fs.readFileSync(p)); }).listen(4401);
const exe = process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const b = await chromium.launch(fs.existsSync(exe) ? { executablePath: exe } : {});
const pg = await b.newPage({ viewport: { width: 390, height: 844 }, locale: 'en-GB' });
const errs = []; pg.on('pageerror', (e) => errs.push(e.message));
let fails = 0; const ok = (c, m) => { console.log(c ? 'ok  ' : 'FAIL', m); if (!c) fails++; };
const main = () => pg.$eval('#r-main', (e) => e.textContent.trim());
const settle = async () => { await pg.waitForTimeout(350); await pg.waitForFunction(() => !document.querySelector('[data-result]').classList.contains('busy'), null, { timeout: 15000 }); };
await pg.goto('http://localhost:4401/container-loading-calculator/'); await settle();
ok(await main() === '900 of 900', 'defaults: 900 of 900 (' + await main() + ')');
// space left: 40' HC 12.032 x 2.35 x 2.7 = 76.34 m³; cargo 400 x 0.096 + 500 x 0.045 = 60.9 m³ -> 15.44 m³; 28,600 - 7,800 = 20,800 kg
ok(await pg.$eval('[data-r="spaceLeft"]', (e) => e.textContent) === '15.44 m³', 'space left 15.44 m³ (' + await pg.$eval('[data-r="spaceLeft"]', (e) => e.textContent) + ')');
ok(await pg.$eval('[data-r="wtLeft"]', (e) => e.textContent) === '20,800 kg', 'payload left 20,800 kg');
await pg.waitForFunction(() => !document.querySelector('[data-r="room"]').textContent.includes('…'), null, { timeout: 20000 });
const room = await pg.$$eval('[data-r="room"] tr', (r) => r.map((x) => x.children[1].textContent));
ok(room.length === 2 && room.every((v) => /^[\d,]+$/.test(v) && +v.replace(/,/g, '') > 0), 'room for more shown for each box type (' + room.join(' / ') + ')');
const L0 = await pg.inputValue('[data-f="L"]');
await pg.click('[data-units="imperial"]'); await settle();
ok(await pg.inputValue('[data-f="L"]') === '473.7', 'inside length 12032 mm shows 473.7 in (' + await pg.inputValue('[data-f="L"]') + ')');
ok((await pg.$eval('[data-r="wt"]', (e) => e.textContent)) === '17,196 lb', '7,800 kg shows 17,196 lb');
for (let i = 0; i < 3; i++) { await pg.click('[data-units="metric"]'); await pg.click('[data-units="imperial"]'); }
await pg.click('[data-units="metric"]'); await settle();
ok(await pg.inputValue('[data-f="L"]') === L0, 'length unchanged after 4 unit round trips (' + L0 + ')');
// 600 x 400 x 400 mm in imperial = 23.62 x 15.75 x 15.75 in; set qty 5000 for carton A, remove B -> 660
await pg.click('.boxcard:nth-child(2) [data-del]');
await pg.fill('.boxcard [data-b="qty"]', '5000'); await settle();
ok(await main() === '660 of 5,000', '600x400x400 x5000 in 40HC -> 660 (' + await main() + ')');
const url = pg.url();
const pg2 = await b.newPage({ viewport: { width: 390, height: 844 } });
await pg2.goto(url); await pg2.waitForTimeout(400); await pg2.waitForFunction(() => document.querySelector('#r-main').textContent.trim() !== '–', null, { timeout: 15000 }); await pg2.waitForTimeout(500);
ok(await pg2.$eval('#r-main', (e) => e.textContent.trim()) === '660 of 5,000', 'share link reproduces the plan');
// Interlocked layers (the default for one carton type): 660 in 10 walls of 1200 mm, 11 per layer, the same as column stacks
const S = (k) => pg.$eval(`[data-r="${k}"]`, (e) => e.textContent.trim());
ok(await S('stack') === 'Interlocked' && (await S('stackSub')).includes('alternate 11 and 11') && !(await S('stackSub')).includes('would load'), 'interlocked 660: 11 per layer, nothing lost (' + await S('stackSub') + ')');
ok((await S('steps')).includes('walls 120 cm long (10 full walls'), 'formula line names the 1200 mm walls');
await pg.selectOption('[data-f="preset"]', '20dv'); await settle();
const il20 = +(await main()).split(' ')[0].replace(/,/g, '');
ok(il20 > 0 && il20 <= 275 && (await S('stackSub')).includes(`would load ${275 - il20} more`) && !(await S('warn')).includes('failed its own check'), `20ft interlocked: ${il20}, column stacks would load ${275 - il20} more`);
await pg.selectOption('[data-f="support"]', '1'); await settle();
ok(!(await S('warn')).includes('failed its own check') && +(await main()).split(' ')[0].replace(/,/g, '') <= il20, '100% support: plan passes the check, no more than at 80% (' + await main() + ')');
await pg.click('[data-stack="column"]'); await settle();
ok(await S('stack') === 'Column stacks' && await pg.isHidden('[data-supportrow]'), 'column stacks chosen, support choice hidden');
ok(await main() === '275 of 5,000', '20ft standard -> 275 (' + await main() + ')');
// Orientation chosen by hand: only "height up, length along" -> 20 x 5 x 6 = 600 in 40' HC
await pg.selectOption('[data-f="preset"]', '40hc'); await settle();
await pg.selectOption('.boxcard [data-b="rotation"]', 'custom'); await settle();
ok(await pg.$$eval('.boxcard .ochip[aria-pressed="true"]', (x) => x.length) === 6, 'custom starts with all 6 positions ticked');
for (const k of [1, 2, 3, 4, 5]) await pg.click(`.boxcard .ochip[data-o="${k}"]`);
await pg.click('.boxcard .ochip[data-o="0"]'); // the last ticked position cannot be removed
await settle();
ok(await pg.$$eval('.boxcard .ochip[aria-pressed="true"]', (x) => x.map((e) => e.dataset.o).join()) === '0', 'only position 0 ticked, last one stays');
ok(await main() === '600 of 5,000', 'fixed position: 600 of 5,000 (' + await main() + ')');
ok((await pg.$eval('[data-r="table"]', (e) => e.textContent)).includes('H up · L along: 600'), 'table shows positions used');
const pg3 = await b.newPage({ viewport: { width: 390, height: 844 } });
await pg3.goto(pg.url()); await pg3.waitForTimeout(400); await pg3.waitForFunction(() => document.querySelector('#r-main').textContent.trim() !== '–', null, { timeout: 15000 }); await pg3.waitForTimeout(500);
ok(await pg3.$eval('#r-main', (e) => e.textContent.trim()) === '600 of 5,000', 'share link keeps the chosen position');
// Semi-automatic steps on the defaults
await pg.goto('http://localhost:4401/container-loading-calculator/'); await pg.evaluate(() => { history.replaceState(null, '', location.pathname); }); await pg.reload(); await settle();
await pg.click('[data-mode="semi"]'); await settle();
ok(await pg.$$eval('.stepcard', (x) => x.length) === 2, 'semi mode starts with one step per box type');
ok(await main() === '900 of 900', 'one step per type + auto rest: 900 of 900 (' + await main() + ')');
await pg.fill('.stepcard:nth-child(1) [data-s="qty"]', '100');
await pg.selectOption('.stepcard:nth-child(1) [data-s="orient"]', '0');
await pg.check('.stepcard:nth-child(2) [data-s="newSection"]'); await settle();
const rows = await pg.$$eval('[data-r="steptable"] tr', (r) => r.map((x) => [...x.children].map((c) => c.textContent.trim())));
ok(rows.length === 3 && rows[0][3] === '100' && rows[0][4] === '100' && rows[1][4] === '500' && rows[2][0] === 'Rest', 'step table: 100/100, 500 B, then rest (' + JSON.stringify(rows.map((r) => r.slice(3))) + ')');
ok(!(await pg.$eval('[data-r="warn"]', (e) => e.textContent)).includes('failed its own check'), 'semi plan passes the check');
await pg.uncheck('[data-f="fillRest"]'); await settle();
ok(await main() === '600 of 900', 'without the automatic rest: 600 of 900 (' + await main() + ')');
ok((await pg.$eval('[data-r="warn"]', (e) => e.textContent)).includes('300 boxes are not in any step'), 'warns about boxes in no step');
await pg.click('[data-units="imperial"]'); await pg.click('[data-units="metric"]'); await settle();
ok(await pg.inputValue('.stepcard:nth-child(1) [data-s="qty"]') === '100' && await main() === '600 of 900', 'steps survive a unit switch');
await pg.click('.stepcard:nth-child(2) [data-move="-1"]'); await settle();
ok((await pg.$eval('.stepcard:nth-child(1) [data-s="item"]', (e) => e.value)) === '1', 'move step up');
// Hand editing
const msg = () => pg.$eval('[data-ed-msg]', (e) => e.textContent.trim());
const noFail = async () => !(await pg.$eval('[data-r="warn"]', (e) => e.textContent)).includes('failed its own check');
await pg.goto('http://localhost:4401/container-loading-calculator/'); await pg.evaluate(() => history.replaceState(null, '', location.pathname)); await pg.reload(); await settle();
await pg.click('[data-ed="start"]'); await pg.waitForTimeout(300);
ok(await pg.isVisible('[data-ed-on]') && await main() === '900 of 900', 'edit mode opens on the automatic plan');
const box = await pg.$('[data-view] canvas').then((c) => c.boundingBox());
await pg.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.55); await pg.waitForTimeout(200);
ok((await pg.$eval('[data-ed-seltxt]', (e) => e.textContent)).startsWith('Box '), 'tap in the 3D view selects a box (' + await pg.$eval('[data-ed-seltxt]', (e) => e.textContent) + ')');
await pg.click('[data-ed="prev"]'); await pg.waitForTimeout(100);
ok((await pg.$eval('[data-ed-seltxt]', (e) => e.textContent)).length > 0, 'step through boxes with ‹ ›');
await pg.click('[data-ed="remove"]'); await pg.waitForTimeout(200);
const m1 = await msg(); const extra = /the (\d+) standing/.exec(m1); const gone = 1 + (extra ? +extra[1] : 0);
ok(await main() === `${(900 - gone).toLocaleString('en-US')} of 900`, `remove: ${gone} box(es) out (${await main()}; ${m1})`);
ok((await pg.$eval('[data-ed-left]', (e) => e.textContent)).includes(String(gone)), 'removed boxes listed under Not loaded');
await pg.click('[data-ed="undo"]'); await pg.waitForTimeout(150); ok(await main() === '900 of 900', 'undo');
await pg.click('[data-ed="redo"]'); await pg.waitForTimeout(150); ok(await main() !== '900 of 900', 'redo');
await pg.click('[data-ed="fill"]'); await settle();
ok(await main() === '900 of 900' && await noFail(), 'fill the rest automatically: 900 of 900 (' + await main() + ')');
await pg.click('[data-ed="exit"]'); await pg.waitForTimeout(200);
ok(!(await pg.isVisible('[data-ed-on]')) && await main() === '900 of 900', 'back to the automatic plan');
// from empty, by hand
await pg.click('[data-ed="empty"]'); await pg.waitForTimeout(200);
ok(await main() === '0 of 900', 'load by hand from empty: 0 of 900');
await pg.click('[data-place="0"]'); await pg.waitForTimeout(200);
ok(await pg.isVisible('[data-ed-placing]'), 'placing panel shows');
for (let i = 0; i < 3; i++) { await pg.click('[data-ed="nextspot"]'); await pg.waitForTimeout(120); }
ok(await main() === '3 of 900' && await noFail(), 'three boxes placed in free spots (' + await main() + ')');
await pg.selectOption('[data-ed-plorient]', '4'); await pg.waitForTimeout(150);
await pg.click('[data-ed="nextspot"]'); await pg.waitForTimeout(150);
ok(await main() === '4 of 900' && await noFail(), 'placed one in a fixed position (length up)');
await pg.click('[data-ed="stop"]');
await pg.click('[data-ed="prev"]'); await pg.click('[data-push="0,1"]'); await pg.waitForTimeout(150);
ok(/moved/.test(await msg()) && await noFail(), 'push toward the door: ' + await msg());
await pg.click('[data-push="2,1"]'); await pg.waitForTimeout(150);
ok(/No free place|moved/.test(await msg()) && await noFail(), 'push up is checked: ' + await msg());
const chip = await pg.$('[data-ed-turn] .ochip[aria-pressed="false"]');
if (chip) { await chip.click(); await pg.waitForTimeout(150); ok(/Turned|Cannot turn/.test(await msg()) && await noFail(), 'turn is checked: ' + await msg()); }
await pg.click('[data-ed="move"]'); await pg.waitForTimeout(150);
await pg.click('[data-ed="nextspot"]'); await pg.waitForTimeout(150);
ok(/moved/.test(await msg()) && await main() === '4 of 900' && await noFail(), 'move to a new spot: ' + await msg());
await pg.waitForTimeout(600);
const eurl = pg.url();
ok(/&e=/.test(eurl), 'share link carries the hand edits');
const pg4 = await b.newPage({ viewport: { width: 390, height: 844 } });
await pg4.goto(eurl); await pg4.waitForTimeout(2500);
ok(await pg4.$eval('#r-main', (e) => e.textContent.trim()) === '4 of 900' && await pg4.isVisible('[data-ed-on]'), 'shared link reopens the hand-edited plan (' + await pg4.$eval('#r-main', (e) => e.textContent.trim()) + ')');
await pg.click('[data-ed="fill"]'); await settle();
const filled = parseInt((await main()).replace(/,/g, ''), 10);
ok(filled >= 890 && await noFail(), 'fill around 4 hand-placed boxes (' + await main() + ')');
await pg.fill('.boxcard [data-b="qty"]', '401'); await settle();
ok(!(await pg.isVisible('[data-ed-on]')) && (await pg.$eval('[data-r="warn"]', (e) => e.textContent)).includes('hand edits were cleared'), 'changing inputs clears hand edits with a notice');
await pg.screenshot({ path: process.env.SHOT || '/tmp/semi.png', fullPage: true });
// Pallet mode: /pallet-loading-calculator/
{
  const T = (k) => pg.$eval(`[data-r="${k}"]`, (e) => e.textContent.trim());
  const V = (sel) => pg.inputValue(sel);
  await pg.goto('http://localhost:4401/pallet-loading-calculator/'); await pg.evaluate(() => { localStorage.setItem('lpc-units', 'metric'); history.replaceState(null, '', location.pathname); }); await pg.reload(); await settle();
  // Default: interlocked layers, 80% support. 6 layers alternate the 4 x 2 grid (8) and a row of three cartons turned
  // lengthwise beside a row of four (7, 700 of 800 mm, centred): 3 x 8 + 3 x 7 = 45; 100 cartons -> 2 x 45 + 10; 45 x 12 = 540 kg
  ok(await main() === '45 of 100' && await T('stack') === 'Interlocked' && (await T('stackSub')).includes('Column stacks would load 3 more'), 'pallet default interlocked: 45 of 100, 3 fewer than columns (' + await main() + ' / ' + await T('stackSub') + ')');
  ok(await T('tihi') === '8 / 7 × 6' && (await T('tihiSub')).includes('45 per pallet'), 'interlocked Ti-Hi 8 / 7 × 6 (' + await T('tihi') + ')');
  ok(await T('pallets') === '3' && await T('palletsSub') === '2 full of 45 + 1 with 10' && await T('wt') === '540 kg' && !(await T('warn')).includes('failed its own check'), 'pallets for 100: 2 full of 45 + 1 with 10, 540 kg, checked (' + await T('palletsSub') + ')');
  await pg.selectOption('[data-f="support"]', '1'); await settle();
  ok(await main() === '42 of 100' && await T('tihi') === '7 × 6', 'full support: 7 per layer (three turned + four), 42 (' + await main() + ', ' + await T('tihi') + ')');
  await pg.selectOption('[data-f="support"]', '0.8'); await pg.click('[data-stack="column"]'); await settle();
  // Column stacks: Euro pallet 1200 x 800 x 144 mm, 1800 mm limit: 8 per layer x 6 layers = 48; 100 cartons -> 3 pallets (2 x 48 + 4)
  ok(await main() === '48 of 100', 'pallet defaults: 48 of 100 (' + await main() + ')');
  ok(await T('tihi') === '8 × 6' && (await T('tihiSub')).includes('48 per pallet'), 'Ti-Hi 8 × 6 (' + await T('tihi') + ' / ' + await T('tihiSub') + ')');
  ok(await T('pallets') === '3' && await T('palletsSub') === '2 full of 48 + 1 with 4', 'pallets for 100: 3 = 2 full of 48 + 1 with 4 (' + await T('palletsSub') + ')');
  ok(await V('[data-f="L"]') === '120' && await V('[data-f="W"]') === '80' && await V('[data-f="H"]') === '180' && await V('[data-f="palletH"]') === '14.4' && await V('[data-f="maxWeight"]') === '1500' && await V('[data-f="overhang"]') === '0', 'Euro pallet preset fields in cm / kg');
  ok((await T('wt')) === '576 kg' && !(await T('warn')).includes('failed its own check'), 'weight 48 x 12 = 576 kg, plan passes the check');
  ok((await T('steps')).includes('180 − 14.4 = 165.6 cm'), 'formula line: load height 180 − 14.4 = 165.6 cm');
  ok(await pg.$('[data-view] canvas') !== null, '3D view drawn');
  await pg.click('[data-units="imperial"]'); await settle();
  ok(await V('[data-f="L"]') === '47.24' && await V('[data-f="maxWeight"]') === '3306.93' && await V('.boxcard [data-b="l"]') === '15.75', 'imperial: 47.24 in, 3,306.93 lb, carton 15.75 in');
  for (let i = 0; i < 3; i++) { await pg.click('[data-units="metric"]'); await pg.click('[data-units="imperial"]'); }
  await pg.click('[data-units="metric"]'); await settle();
  ok(await V('[data-f="L"]') === '120' && await V('[data-f="H"]') === '180' && await V('.boxcard [data-b="h"]') === '25' && await main() === '48 of 100', 'pallet: no drift after 4 unit round trips');
  // fewer than a full pallet: layer by layer, Ti-Hi of the full pallet, 1 pallet
  await pg.fill('.boxcard [data-b="qty"]', '20'); await settle();
  ok(await main() === '20 of 20' && await T('tihi') === '8 × 6' && await T('pallets') === '1', '20 cartons: 1 pallet, full-pallet Ti-Hi 8 × 6 (' + await T('tihi') + ')');
  await pg.fill('.boxcard [data-b="qty"]', '100');
  await pg.fill('[data-f="overhang"]', '2.5'); await settle();
  ok(await main() === '48 of 100' && await pg.$eval('[data-f="preset"]', (e) => e.value) === 'epal1', 'overhang 2.5 cm: still 48, preset kept');
  await pg.fill('[data-f="palletH"]', '15'); await settle();
  ok(await pg.$eval('[data-f="preset"]', (e) => e.value) === 'custom', 'changing the pallet height switches to Custom size');
  // second case in inches: CHEP 48 x 40 in, 60 in limit, 12 x 10 x 8 in at 30 lb, 200 cartons:
  // 4 x 4 = 16 per layer, floor((1524 - 141) / 203.2) = 6 layers = 96, 2800 / 30 = 93.3 -> 93 = 16 x 5 + 13; 200 -> 3 pallets
  await pg.click('[data-units="imperial"]');
  await pg.selectOption('[data-f="preset"]', 'chep4840'); await pg.fill('[data-f="overhang"]', '0');
  await pg.fill('[data-f="H"]', '60');
  for (const [k, v] of [['l', '12'], ['w', '10'], ['h', '8'], ['weight', '30'], ['qty', '200']]) await pg.fill(`.boxcard [data-b="${k}"]`, v);
  await settle();
  ok(await V('[data-f="L"]') === '48' && await V('[data-f="W"]') === '40' && await V('[data-f="maxWeight"]') === '2800', 'CHEP preset: 48 × 40 in, 2,800 lb');
  ok(await main() === '93 of 200', '48 × 40 in, 12 × 10 × 8 in at 30 lb: 93 of 200 (' + await main() + ')');
  ok(await T('tihi') === '16 × 5 + 13' && (await T('tihiSub')).includes('max load weight reached'), 'Ti-Hi 16 × 5 + 13, weight limited (' + await T('tihi') + ')');
  ok(await T('pallets') === '3' && await T('palletsSub') === '2 full of 93 + 1 with 14', 'pallets for 200: 2 full of 93 + 1 with 14 (' + await T('palletsSub') + ')');
  ok((await T('warn')).includes('Weight limit reached') && !(await T('warn')).includes('failed its own check'), 'weight-limit note, plan passes the check');
  await pg.click('[data-units="metric"]'); await settle();
  ok(await V('[data-f="L"]') === '121.9' && await V('.boxcard [data-b="l"]') === '30.5' && await main() === '93 of 200', 'metric: 121.9 cm, carton 30.5 cm (shown to 1 decimal), still 93');
  await pg.click('[data-units="imperial"]'); await settle();
  ok(await V('[data-f="L"]') === '48' && await V('[data-f="H"]') === '60' && await V('.boxcard [data-b="weight"]') === '30' && await main() === '93 of 200', 'back to inches: 48, 60, 30 lb, 93 of 200');
  await pg.waitForTimeout(300);
  const purl = pg.url();
  const pg5 = await b.newPage({ viewport: { width: 390, height: 844 } }); pg5.on('pageerror', (e) => errs.push(e.message));
  await pg5.goto(purl); await pg5.waitForTimeout(400); await pg5.waitForFunction(() => document.querySelector('#r-main').textContent.trim() !== '–', null, { timeout: 15000 }); await pg5.waitForTimeout(500);
  ok(await pg5.$eval('#r-main', (e) => e.textContent.trim()) === '93 of 200' && await pg5.$eval('[data-r="tihi"]', (e) => e.textContent.trim()) === '16 × 5 + 13', 'pallet share link reproduces 93 = 16 × 5 + 13');
  // hand editing on a pallet: checked, Ti-Hi hidden while editing
  await pg.click('[data-ed="start"]'); await pg.waitForTimeout(300);
  ok(await T('tihi') === '–' && await main() === '93 of 200' && !(await T('warn')).includes('failed its own check'), 'edit mode with inch sizes: plan still passes the check, Ti-Hi hidden');
  await pg.click('[data-ed="next"]'); await pg.click('[data-ed="remove"]'); await pg.waitForTimeout(200);
  await pg.click('[data-ed="fill"]'); await settle();
  ok(await main() === '93 of 200' && !(await T('warn')).includes('failed its own check'), 'remove + fill on a pallet: 93 again, checked (' + await main() + ')');
  await pg.click('[data-ed="exit"]'); await pg.waitForTimeout(300);
  ok(await T('tihi') === '16 × 5 + 13', 'back to the automatic plan: Ti-Hi again');
  // two box types: no Ti-Hi
  await pg.click('[data-add]'); await settle();
  ok(await T('tihi') === '–' && (await T('tihiSub')).includes('one box type'), 'two box types: Ti-Hi not shown');
  await pg.screenshot({ path: process.env.PSHOT || '/tmp/pallet.png', fullPage: true });
}
// Pallets in a container: /how-many-pallets-fit-in-a-container/
{
  const T = (k) => pg.$eval(`[data-r="${k}"]`, (e) => e.textContent.trim());
  const V = (sel) => pg.inputValue(sel);
  await pg.goto('http://localhost:4401/how-many-pallets-fit-in-a-container/'); await pg.evaluate(() => { localStorage.setItem('lpc-units', 'metric'); history.replaceState(null, '', location.pathname); }); await pg.reload(); await settle();
  // 40' DV 12032 x 2352: Euro pallets 15 crosswise + 10 lengthwise = 25; 25 x 500 kg = 12,500 kg
  ok(await main() === '25 of 50', 'pallets defaults: 25 of 50 Euro pallets in a 40\' DV (' + await main() + ')');
  ok(await pg.$eval('[data-f="preset"]', (e) => e.value) === '40dv' && await pg.$eval('.boxcard [data-b="bpreset"]', (e) => e.value) === 'epal1' && await V('.boxcard [data-b="h"]') === '110', 'defaults: 40\' Standard, Euro pallet footprint, 110 cm high');
  ok(await T('wt') === '12,500 kg' && !(await T('warn')).includes('failed its own check'), '25 x 500 kg = 12,500 kg, plan passes the check');
  await pg.check('.boxcard [data-b="stackable"]'); await settle();
  ok(await main() === '50 of 50', 'two high (2 x 1100 = 2200 <= 2395): 50 of 50 (' + await main() + ')');
  await pg.uncheck('.boxcard [data-b="stackable"]');
  await pg.selectOption('[data-f="preset"]', '20dv'); await settle();
  ok(await main() === '11 of 50', '20\' DV: 7 + 4 = 11 (' + await main() + ')');
  await pg.selectOption('.boxcard [data-b="bpreset"]', 'epal2'); await settle();
  ok(await V('.boxcard [data-b="l"]') === '120' && await V('.boxcard [data-b="w"]') === '100' && await main() === '9 of 50', 'pallet picker EPAL 2: 120 x 100 cm, 5 + 4 = 9 in a 20\' (' + await main() + ')');
  await pg.fill('.boxcard [data-b="w"]', '80'); await settle();
  ok(await pg.$eval('.boxcard [data-b="bpreset"]', (e) => e.value) === 'epal1', 'typing 120 x 80 cm shows the Euro pallet in the picker');
  await pg.fill('.boxcard [data-b="w"]', '81'); await settle();
  ok(await pg.$eval('.boxcard [data-b="bpreset"]', (e) => e.value) === 'custom', 'typing 120 x 81 cm switches the picker to Custom size');
  // too tall for the door: 230 cm > 229.2 cm door of a 20'
  await pg.fill('.boxcard [data-b="w"]', '80'); await pg.fill('.boxcard [data-b="h"]', '230'); await settle();
  ok(await main() === '0 of 50' && (await T('warn')).includes('door opening'), 'a 230 cm loaded pallet does not pass the 229.2 cm door: 0, note shown');
  // second case in inches: 48 x 40 in, 50 in high, 1,500 lb, stacking allowed, 40' HC -> 11 + 9 = 20 per layer x 2 = 40
  await pg.click('[data-units="imperial"]');
  await pg.selectOption('[data-f="preset"]', '40hc');
  await pg.selectOption('.boxcard [data-b="bpreset"]', 'chep4840');
  await pg.fill('.boxcard [data-b="h"]', '50'); await pg.fill('.boxcard [data-b="weight"]', '1500');
  await pg.check('.boxcard [data-b="stackable"]'); await settle();
  ok(await V('.boxcard [data-b="l"]') === '48' && await V('.boxcard [data-b="w"]') === '40' && await main() === '40 of 50', '48 x 40 in at 50 in, two high in a 40\' HC: 40 of 50 (' + await main() + ')');
  ok(await T('wt') === '60,000 lb', '40 x 1,500 lb = 60,000 lb (' + await T('wt') + ')');
  await pg.selectOption('[data-f="preset"]', '40dv'); await settle();
  ok(await main() === '20 of 50', '40\' DV (94.29 in inside): no room for two high, 20 (' + await main() + ')');
  for (let i = 0; i < 3; i++) { await pg.click('[data-units="metric"]'); await pg.click('[data-units="imperial"]'); }
  await settle();
  ok(await V('.boxcard [data-b="l"]') === '48' && await V('.boxcard [data-b="h"]') === '50' && await V('.boxcard [data-b="weight"]') === '1500' && await pg.$eval('.boxcard [data-b="bpreset"]', (e) => e.value) === 'chep4840' && await main() === '20 of 50', 'no drift after 3 unit round trips, picker still 48 x 40 in');
  await pg.click('[data-units="metric"]'); await settle();
  ok(await V('.boxcard [data-b="l"]') === '121.9' && await V('.boxcard [data-b="h"]') === '127' && await V('.boxcard [data-b="weight"]') === '680.39', 'metric: 121.9 cm, 127 cm, 680.39 kg');
  await pg.waitForTimeout(300);
  const pg6 = await b.newPage({ viewport: { width: 390, height: 844 } }); pg6.on('pageerror', (e) => errs.push(e.message));
  await pg6.goto(pg.url()); await pg6.waitForTimeout(400); await pg6.waitForFunction(() => document.querySelector('#r-main').textContent.trim() !== '–', null, { timeout: 15000 }); await pg6.waitForTimeout(500);
  ok(await pg6.$eval('#r-main', (e) => e.textContent.trim()) === '20 of 50' && await pg6.$eval('.boxcard [data-b="bpreset"]', (e) => e.value) === 'chep4840', 'share link reproduces 20 and the 48 x 40 in picker');
  // container calculator has no pallet picker
  await pg6.goto('http://localhost:4401/container-loading-calculator/'); await pg6.waitForTimeout(300);
  ok(await pg6.$eval('.boxcard .bpre', (e) => e.hidden), 'no pallet picker on the container loading calculator');
}
// Pallets in a 53' trailer: /how-many-pallets-fit-in-a-53-foot-trailer/ (Hyundai Translead interiors, no door, no payload)
{
  const T = (k) => pg.$eval(`[data-r="${k}"]`, (e) => e.textContent.trim());
  const V = (sel) => pg.inputValue(sel);
  await pg.goto('http://localhost:4401/how-many-pallets-fit-in-a-53-foot-trailer/'); await pg.evaluate(() => { localStorage.setItem('lpc-units', 'imperial'); history.replaceState(null, '', location.pathname); }); await pg.reload(); await settle();
  // hand: 48 in side across, 2 x 48 = 96 <= 101.5 in; 15 rows x 40 = 600 <= 630 in -> 30 of 36; 30 x 1,500 lb = 45,000 lb
  ok(await main() === '30 of 36', 'trailer defaults: 30 of 36 pallets of 48 x 40 in (' + await main() + ')');
  ok(await pg.$eval('[data-f="preset"]', (e) => e.value) === '53ht-composite' && await pg.$eval('.boxcard [data-b="bpreset"]', (e) => e.value) === 'chep4840', 'defaults: Composite trailer, 48 x 40 in picker');
  ok(await V('[data-f="L"]') === '630' && await V('[data-f="W"]') === '101.5' && await V('[data-f="H"]') === '110' && await V('[data-f="doorW"]') === '' && await V('[data-f="doorH"]') === '' && await V('[data-f="maxWeight"]') === '', 'trailer fields 630 x 101.5 x 110 in, door and payload empty');
  ok(await V('.boxcard [data-b="l"]') === '48' && await V('.boxcard [data-b="h"]') === '50' && await V('.boxcard [data-b="weight"]') === '1500', 'pallet 48 in, 50 in high, 1,500 lb');
  ok(await T('wt') === '45,000 lb' && await T('wtLeft') === 'No limit set' && !(await T('warn')).includes('failed its own check'), '45,000 lb, no limit set, plan passes the check (' + await T('wt') + ')');
  ok((await pg.$eval('[data-f="srcnote"]', (e) => e.textContent)).includes('Hyundai Translead (Composite)'), 'source note names Hyundai Translead');
  ok((await pg.$eval('.planner h2', (e) => e.textContent)) === 'Trailer', 'form heading says Trailer');
  // bottom result bar: after an input with the result off screen it shows the headline value
  await pg.evaluate(() => window.scrollTo(0, 0)); await pg.fill('.boxcard [data-b="qty"]', '80'); await settle();
  ok(await pg.$eval('.stickybar', (e) => !e.hidden && e.textContent.includes('30 of 80')), 'result bar shows 30 of 80 while the result is off screen');
  await pg.check('.boxcard [data-b="stackable"]'); await settle();
  ok(await main() === '60 of 80', 'two high (2 x 50 = 100 <= 110 in): 60 of 80 (' + await main() + ')');
  await pg.uncheck('.boxcard [data-b="stackable"]');
  await pg.selectOption('[data-f="preset"]', '53ht-original'); await settle();
  ok(await V('[data-f="W"]') === '98.5' && await main() === '30 of 80', 'Original (98.5 in wide): still 30 (' + await main() + ')');
  // 48 in side along only (position 0): 13 rows x 2 = 26
  await pg.selectOption('[data-f="preset"]', '53ht-composite');
  await pg.selectOption('.boxcard [data-b="rotation"]', 'custom'); await settle();
  for (const k of [1, 2, 3, 4, 5]) { const on = await pg.$eval(`.boxcard .ochip[data-o="${k}"]`, (e) => e.getAttribute('aria-pressed') === 'true'); if (on) await pg.click(`.boxcard .ochip[data-o="${k}"]`); }
  await settle();
  ok(await main() === '26 of 80', '48 in side along the trailer only: 26 (' + await main() + ')');
  await pg.selectOption('.boxcard [data-b="rotation"]', 'upright');
  // Euro pallets, second case: two crosswise x 20 rows = 40
  await pg.selectOption('.boxcard [data-b="bpreset"]', 'epal1'); await settle();
  ok(await main() === '40 of 80', 'Euro pallets: 2 crosswise x 20 rows = 40 (' + await main() + ')');
  for (let i = 0; i < 3; i++) { await pg.click('[data-units="metric"]'); await pg.click('[data-units="imperial"]'); }
  await settle();
  ok(await V('[data-f="L"]') === '630' && await V('[data-f="W"]') === '101.5' && await V('.boxcard [data-b="h"]') === '50' && await V('.boxcard [data-b="weight"]') === '1500' && await main() === '40 of 80', 'trailer: no drift after 3 unit round trips');
  await pg.click('[data-units="metric"]'); await settle();
  ok(await V('[data-f="L"]') === '1600.2' && await V('[data-f="W"]') === '257.8' && await V('[data-f="H"]') === '279.4' && await V('.boxcard [data-b="l"]') === '120' && await V('.boxcard [data-b="h"]') === '127' && await V('.boxcard [data-b="weight"]') === '680.39', 'metric: 1600.2 x 257.8 x 279.4 cm, Euro 120 cm, 127 cm, 680.39 kg');
  ok(await T('wt') === '27,216 kg', '40 x 680.39 kg = 27,216 kg (' + await T('wt') + ')');
  await pg.waitForTimeout(300);
  const pg8 = await b.newPage({ viewport: { width: 390, height: 844 } }); pg8.on('pageerror', (e) => errs.push(e.message));
  await pg8.goto(pg.url()); await pg8.waitForTimeout(400); await pg8.waitForFunction(() => document.querySelector('#r-main').textContent.trim() !== '–', null, { timeout: 15000 }); await pg8.waitForTimeout(500);
  ok(await pg8.$eval('#r-main', (e) => e.textContent.trim()) === '40 of 80' && await pg8.$eval('[data-f="preset"]', (e) => e.value) === '53ht-composite', 'trailer share link reproduces 40 in the Composite');
  // the container loading calculator lists the trailers too; picking one clears the door and payload
  await pg8.goto('http://localhost:4401/container-loading-calculator/'); await pg8.evaluate(() => { localStorage.setItem('lpc-units', 'metric'); history.replaceState(null, '', location.pathname); }); await pg8.reload(); await pg8.waitForTimeout(400);
  await pg8.waitForFunction(() => !document.querySelector('[data-result]').classList.contains('busy') && document.querySelector('#r-main').textContent.trim() !== '–', null, { timeout: 15000 });
  ok(await pg8.$eval('#r-main', (e) => e.textContent.trim()) === '900 of 900' && await pg8.$eval('[data-f="preset"] option:checked', (e) => e.value) === '40hc', 'container calculator defaults unchanged');
  await pg8.selectOption('[data-f="preset"]', '53ht-hycube'); await pg8.waitForTimeout(400);
  await pg8.waitForFunction(() => !document.querySelector('[data-result]').classList.contains('busy'), null, { timeout: 15000 });
  ok(await pg8.inputValue('[data-f="L"]') === '1600.2' && await pg8.inputValue('[data-f="W"]') === '256.5' && await pg8.inputValue('[data-f="doorW"]') === '' && await pg8.inputValue('[data-f="maxWeight"]') === '' && await pg8.$eval('#r-main', (e) => e.textContent.trim()) === '900 of 900' && await pg8.$eval('[data-r="wtLeft"]', (e) => e.textContent.trim()) === 'No limit set', 'container calculator: HY-Cube trailer preset, door and payload empty, 900 of 900');
  await pg8.selectOption('[data-f="preset"]', '40hc'); await pg8.waitForTimeout(400);
  ok(await pg8.inputValue('[data-f="doorW"]') === '234' && await pg8.inputValue('[data-f="maxWeight"]') === '28600', 'back to the 40\' HC: door and payload filled again');
  await pg8.close();
}
// CBM calculator: defaults (hand: 0.6·0.4·0.4·400 + 0.5·0.3·0.3·500 = 38.4 + 22.5 = 60.9 m³ = 2,150.66 ft³),
// shares of Hapag-Lloyd inside volumes, unit round trips, an inch case and the "Plan in 3D" link into the planner
{
  const pg7 = await b.newPage({ viewport: { width: 390, height: 844 }, locale: 'en-GB' }); pg7.on('pageerror', (e) => errs.push(e.message));
  const T = (s) => pg7.$eval(s, (e) => e.textContent.trim());
  const shares = () => pg7.$$eval('[data-r="conts"] tr', (r) => r.map((x) => x.children[1].firstChild.textContent.trim()).join(' '));
  await pg7.goto('http://localhost:4401/cbm-calculator/'); await pg7.waitForTimeout(300);
  ok(await T('#r-main') === '60.9 m³' && await T('[data-r="ft3"]') === '2,150.66 ft³', 'cbm defaults 60.9 m³ = 2,150.66 ft³ (' + await T('#r-main') + ')');
  ok(await shares() === '183.2% 89.9% 79.8% 70.7%', 'cbm shares 20/40/40HC/45HC (' + await shares() + ')');
  ok((await T('[data-r="conts"]')).includes('at least 2 by volume'), 'cbm: 20ft needs at least 2 by volume');
  for (let i = 0; i < 3; i++) { await pg7.click('[data-unit="in"]'); await pg7.click('[data-unit="mm"]'); await pg7.click('[data-unit="cm"]'); }
  ok(await pg7.inputValue('.cbmline [data-k="l"]') === '60' && await T('#r-main') === '60.9 m³', 'cbm: no drift after 3 unit round trips');
  await pg7.click('[data-unit="in"]');
  ok(await pg7.inputValue('.cbmline [data-k="l"]') === '23.62', 'cbm: 600 mm shows 23.62 in');
  await pg7.click('.cbmline:nth-child(2) [data-del]');
  for (const [k, v] of [['l', '24'], ['w', '18'], ['h', '18'], ['qty', '120']]) await pg7.fill(`.cbmline [data-k="${k}"]`, v);
  // hand: 24·18·18 = 7,776 in³ = 4.5 ft³ (÷1,728) → 540 ft³; 7,776 × 16.387064 cm³ × 120 = 15.291 m³; ÷ 33.2349 = 46.0%
  ok(await T('#r-main') === '15.291 m³' && await T('[data-r="ft3"]') === '540 ft³' && (await shares()).startsWith('46.0% 22.6% 20.0% 17.8%'), 'cbm inch case 15.291 m³, 540 ft³, 46.0% of a 20ft (' + await T('#r-main') + ' ' + await shares() + ')');
  await pg7.click('[data-unit="cm"]');
  ok(await pg7.inputValue('.cbmline [data-k="l"]') === '60.96' && await T('#r-main') === '15.291 m³', 'cbm: 24 in shows 60.96 cm, total unchanged');
  await pg7.click('[data-unit="in"]');
  ok(await pg7.inputValue('.cbmline [data-k="l"]') === '24', 'cbm: back to 24 in');
  const href = await pg7.$eval('[data-r="conts"] tr:nth-child(1) a', (a) => a.getAttribute('href'));
  await pg7.goto('http://localhost:4401' + href); await pg7.waitForFunction(() => document.querySelector('#r-main').textContent.trim() !== '–', null, { timeout: 15000 }); await pg7.waitForTimeout(800);
  ok(await pg7.inputValue('[data-f="preset"]') === '20dv' && /^\d+ of 120$/.test(await T('#r-main')) && await pg7.inputValue('.boxcard [data-b="qty"]') === '120', 'cbm "Plan in 3D" opens the 20ft plan with 120 cartons (' + await T('#r-main') + ')');
  await pg7.close();
}
// Dimensional weight calculator (USPS DMM rule): hand checks
// defaults 18 x 14 x 12 in = 3,024 in³ ÷ 139 = 21.76 → 22 lb (10 lb actual); 50 x 40 x 30 cm → 19.69 x 15.75 x 11.81 → 20 x 16 x 12 = 3,840 ÷ 139 = 27.63 → 28 lb;
// 12 in cube = 1,728 in³ → none; 24 in cube = 13,824 ÷ 139 = 99.45 → 100 lb (70-pound price); 20 in cube not rectangular 8,000 × 0.785 = 6,280 ÷ 139 = 45.18 → 46;
// commercial PM not rectangular 20.4 x 20.5 x 20 → rounded off 20 x 21 x 20 = 8,400 × 0.785 = 6,594 ÷ 166 = 39.72 → 40; custom 6,000 cm³/kg: 60,000 cm³ → 10 kg
{
  const pg9 = await b.newPage({ viewport: { width: 390, height: 844 }, locale: 'en-GB' }); pg9.on('pageerror', (e) => errs.push(e.message));
  const T = (s) => pg9.$eval(s, (e) => e.textContent.trim());
  const V = (k) => pg9.inputValue(`[data-f="${k}"]`);
  const fill = async (o) => { for (const [k, v] of Object.entries(o)) await pg9.fill(`[data-f="${k}"]`, v); };
  await pg9.goto('http://localhost:4401/dimensional-weight-calculator/'); await pg9.waitForTimeout(300);
  ok(await T('#r-main') === '22 lb' && await T('[data-r="dim"]') === '22 lb' && await T('[data-r="mainsub"]') === '9.98 kg', 'dim defaults: 22 lb billable, 22 lb dimensional, 9.98 kg (' + await T('#r-main') + ')');
  ok(await V('l') === '45.72' && await V('w') === '35.56' && await V('h') === '30.48' && await V('wt') === '4.54', 'dim: en-GB starts in cm · kg, 18 in = 45.72 cm, 10 lb = 4.54 kg');
  await pg9.click('[data-units="imperial"]');
  ok(await V('l') === '18' && await V('wt') === '10', 'dim: imperial shows 18 in, 10 lb');
  for (let i = 0; i < 3; i++) { await pg9.click('[data-units="metric"]'); await pg9.click('[data-units="imperial"]'); }
  ok(await V('l') === '18' && await V('h') === '12' && await V('wt') === '10' && await T('#r-main') === '22 lb', 'dim: no drift after 3 unit round trips');
  await pg9.fill('[data-f="qty"]', '4');
  ok((await T('[data-r="total"]')).includes('88 lb billable'), 'dim: 4 packages = 88 lb (' + await T('[data-r="total"]') + ')');
  await pg9.evaluate(() => window.scrollTo(0, 0)); await pg9.waitForTimeout(400);
  ok(await pg9.$eval('.stickybar', (e) => !e.hidden && e.textContent.includes('22 lb')), 'dim: bottom result bar shows 22 lb');
  await pg9.fill('[data-f="qty"]', '1');
  await pg9.click('[data-units="metric"]'); await fill({ l: '50', w: '40', h: '30', wt: '8' });
  ok(await T('#r-main') === '28 lb' && await T('[data-r="mainsub"]') === '12.7 kg' && (await T('[data-r="steps"]')).includes('20 × 16 × 12'), 'dim: 50 x 40 x 30 cm, 8 kg → 20 x 16 x 12 in → 28 lb (' + await T('#r-main') + ')');
  await pg9.click('[data-units="imperial"]');
  ok(await V('l') === '19.69' && await V('wt') === '17.64', 'dim: 50 cm shows 19.69 in, 8 kg shows 17.64 lb');
  await fill({ l: '12', w: '12', h: '12', wt: '5' });
  ok(await T('#r-main') === '5 lb' && await T('[data-r="dim"]') === 'Not applied', 'dim: 12 in cube (1,728 in³) has none, 5 lb billable');
  await fill({ h: '12.1' });
  ok(await T('#r-main') === '14 lb', 'dim: 12 x 12 x 12.1 → 13 in → 1,872 in³ → 14 lb (' + await T('#r-main') + ')');
  await fill({ l: '24', w: '24', h: '24', wt: '30' });
  ok(await T('#r-main') === '100 lb' && (await T('[data-r="warn"]')).includes('70-pound price') && (await T('[data-r="price"]')).includes('70 lb'), 'dim: 24 in cube → 100 lb, priced at the 70-pound price');
  await fill({ l: '20', w: '20', h: '20', wt: '10' }); await pg9.click('[data-shape="nonrect"]');
  ok(await T('#r-main') === '46 lb', 'dim: 20 in not rectangular → 6,280 in³ → 46 lb (' + await T('#r-main') + ')');
  await pg9.selectOption('[data-f="rule"]', 'usps-pm-commercial'); await fill({ l: '20.4', w: '20.5' });
  ok(await T('#r-main') === '40 lb', 'dim: commercial PM not rectangular, rounded off, ÷ 166 → 40 lb (' + await T('#r-main') + ')');
  await pg9.selectOption('[data-f="rule"]', 'custom');
  ok(await pg9.$eval('[data-shapebox]', (e) => e.hidden) && await V('divisor') === '139', 'dim: custom divisor starts at 139, shape hidden');
  await pg9.click('[data-units="metric"]'); await pg9.selectOption('[data-f="dunit"]', 'cm3kg');
  ok(await V('divisor') === '5021.69', 'dim: 139 in³/lb = 139 × 16.387064 ÷ 0.45359237 = 5,021.69 cm³/kg (' + await V('divisor') + ')');
  await fill({ divisor: '6000', l: '50', w: '40', h: '30', wt: '8' });
  ok(await T('#r-main') === '10 kg' && await T('[data-r="dim"]') === '10 kg', 'dim: custom 6,000 cm³/kg, 50 x 40 x 30 cm → 10 kg (' + await T('#r-main') + ')');
  await pg9.selectOption('[data-f="dunit"]', 'in3lb');
  ok(await V('divisor') === '166.08' && await T('#r-main') === '22.05 lb', 'dim: same divisor in in³/lb 166.08, 22.05 lb (' + await V('divisor') + ' ' + await T('#r-main') + ')');
  await pg9.selectOption('[data-f="dunit"]', 'cm3kg');
  ok(await V('divisor') === '6000', 'dim: divisor back to 6000 cm³/kg without drift');
  await pg9.close();
}
// Box list import (Excel .xlsx, CSV, pasted cells): parser checks in Node, then the buttons in the browser
{
  const { readBoxFile, readDelimited, rowsToItems, toNumber } = await import('../src/scripts/importer.js');
  const asFile = (p) => ({ name: path.basename(p), arrayBuffer: async () => { const x = fs.readFileSync(p); return x.buffer.slice(x.byteOffset, x.byteOffset + x.length); } });
  const tx = await readBoxFile(asFile('public/load-plan-template.xlsx'), 'imperial');
  ok(tx.items.length === 2 && tx.items[0].l === 600 && tx.items[0].qty === 400 && tx.items[0].rotation === 'any' && tx.items[1].rotation === 'upright' && tx.items[1].weight === 6, 'import: Excel template → 2 types, 600 mm from 60 (cm), header units win over the form units');
  const tp = await readBoxFile(asFile('scripts/fixtures/inline-prefixed.xlsx'), 'imperial');
  ok(tp.items.length === 1 && tp.items[0].name === 'Big & heavy' && tp.items[0].l === 1200 && tp.items[0].qty === 4 && tp.items[0].weight === 0, 'import: .xlsx with inline strings, x: prefixes, a named sheet and a gap row');
  const tc = await readBoxFile(asFile('public/load-plan-template.csv'), 'metric');
  ok(JSON.stringify(tc.items) === JSON.stringify(tx.items), 'import: CSV template gives the same box list as the Excel template');
  // no units in the header, imperial form: 24 x 16 x 12 in, 30 lb -> 609.6 x 406.4 x 304.8 mm, 13.60776 kg; a row without length is skipped
  const pi = rowsToItems(readDelimited('SKU\tL\tW\tH\tGW\tQty\nA1\t24\t16\t12\t30\t100\nbad\t\t1\t1\t1\t1\n').rows, 'imperial');
  ok(pi.items.length === 1 && pi.items[0].l === 609.6 && pi.items[0].h === 304.8 && Math.abs(pi.items[0].weight - 30 * 0.45359237) < 1e-6 && pi.skipped.length === 1 && pi.notes.some((n) => n.includes('inches')), 'import: pasted cells, inches and pounds assumed and said so, bad row skipped');
  const eu = rowsToItems(readDelimited('Item;Length mm;Width mm;Height mm;Weight kg;Pcs;Orientation;Stackable\n"Box; big";600;400;400;12,5;1.200;upright;no\n').rows);
  ok(eu.items[0].name === 'Box; big' && eu.items[0].weight === 12.5 && eu.items[0].qty === 1200 && eu.items[0].rotation === 'upright' && eu.items[0].stackable === false, 'import: semicolon CSV with decimal commas, quoted name, upright, not stackable');
  ok([toNumber('1,200'), toNumber('12,5'), toNumber('1.200,5'), toNumber('40cm')].join() === '1200,12.5,1200.5,40', 'import: number formats');
  let xlsErr = ''; try { await readBoxFile({ name: 'old.xls', arrayBuffer: async () => new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0, 0, 0, 0]).buffer }, 'metric'); } catch (e) { xlsErr = e.message; }
  ok(xlsErr.includes('.xlsx'), 'import: old .xls refused with a "save as .xlsx or CSV" message');
  const many = rowsToItems([['Name', 'L', 'W', 'H', 'Qty'], ...Array.from({ length: 12 }, (_, i) => ['B' + i, 10, 10, 10, 1])]);
  ok(many.items.length === 10 && many.notes.some((n) => n.includes('first 10')), 'import: 12 types → first 10, with a note');

  const pgI = await b.newPage({ viewport: { width: 390, height: 844 } }); pgI.on('pageerror', (e) => errs.push(e.message));
  const settleI = async () => { await pgI.waitForTimeout(350); await pgI.waitForFunction(() => !document.querySelector('[data-result]').classList.contains('busy'), null, { timeout: 15000 }); };
  await pgI.goto('http://localhost:4401/container-loading-calculator/'); await pgI.evaluate(() => { localStorage.setItem('lpc-units', 'metric'); history.replaceState(null, '', location.pathname); }); await pgI.reload(); await settleI();
  const csv = path.join(process.env.TMPDIR || '/tmp', 'lpc-import-test.csv');
  fs.writeFileSync(csv, 'Name,Length (in),Width (in),Height (in),Weight (lb),Quantity,This side up,Stackable\r\nTV,48,8,30,40,20,yes,no\r\nCarton,24,16,12,30,100,no,yes\r\n');
  await pgI.setInputFiles('[data-importfile]', csv); await settleI();
  const cards = await pgI.$$eval('.boxcard', (c) => c.map((x) => [x.querySelector('[data-b="name"]').value, x.querySelector('[data-b="l"]').value, x.querySelector('[data-b="qty"]').value, x.querySelector('[data-b="rotation"]').value, x.querySelector('[data-b="stackable"]').checked].join('|')));
  ok(cards.join(' / ') === 'TV|121.9|20|upright|false / Carton|61|100|any|true', 'import button: CSV in inches → 2 box cards in cm (' + cards.join(' / ') + ')');
  const msg = await pgI.$eval('[data-importmsg]', (e) => e.textContent);
  ok(msg.includes('Imported 2 box types (120 boxes)') && (await pgI.$eval('#r-main', (e) => e.textContent.trim())).endsWith('of 120'), 'import button: note and the plan for 120 boxes (' + msg.slice(0, 80) + ')');
  await pgI.click('[data-paste]');
  await pgI.fill('[data-pastetext]', 'Name\tLength (cm)\tWidth (cm)\tHeight (cm)\tWeight (kg)\tQuantity\nCarton A\t60\t40\t40\t12\t5000\n');
  await pgI.click('[data-pasteuse]'); await settleI();
  ok(await pgI.$eval('#r-main', (e) => e.textContent.trim()) === '660 of 5,000', 'paste: 600 x 400 x 400 mm x 5000 pasted → 660 in the 40\' HC');
  await pgI.setInputFiles('[data-importfile]', 'public/load-plan-template.xlsx'); await settleI();
  ok(await pgI.$eval('#r-main', (e) => e.textContent.trim()) === '900 of 900' && (await pgI.$$('.boxcard')).length === 2, 'import button: Excel template → the default 900 of 900');
  await pgI.close();
}
// Loading list: sections from the back wall, layers from the floor, running totals, CSV, units
{
  const pgL = await b.newPage({ viewport: { width: 390, height: 844 }, locale: 'en-GB', acceptDownloads: true });
  const settleL = async () => { await pgL.waitForTimeout(350); await pgL.waitForFunction(() => !document.querySelector('[data-result]').classList.contains('busy'), null, { timeout: 15000 }); };
  const mainL = () => pgL.$eval('#r-main', (e) => +e.textContent.trim().split(' ')[0].replace(/,/g, ''));
  // per section: header text, box count, layers [sum per layer], last running total
  const info = () => pgL.$$eval('[data-r="lltable"] tr', (rows) => {
    const out = []; let s = null;
    for (const r of rows) {
      if (r.classList.contains('llsec')) { s = { head: r.textContent, n: 0, layers: [], soFar: 0, groups: 0 }; out.push(s); continue; }
      const td = [...r.children].map((c) => c.textContent.trim()); const n = +td[td.length - 4].replace(/,/g, '');
      if (td.length === 7) s.layers.push(0);
      s.layers[s.layers.length - 1] += n; s.n += n; s.groups++; s.soFar = +td[td.length - 1].replace(/,/g, '');
    }
    return out;
  });
  const csvNow = async () => {
    const [dl] = await Promise.all([pgL.waitForEvent('download'), pgL.click('[data-llcsv]')]);
    const text = fs.readFileSync(await dl.path(), 'utf8').replace(/^\uFEFF/, '');
    const lines = text.trim().split(/\r?\n/).map((l) => l.split(','));
    return { name: dl.suggestedFilename(), head: lines[0], rows: lines.slice(1) };
  };
  await pgL.goto('http://localhost:4401/container-loading-calculator/'); await pgL.evaluate(() => { localStorage.setItem('lpc-units', 'metric'); history.replaceState(null, '', location.pathname); }); await pgL.reload(); await settleL();
  let L = await info(); const n0 = await mainL();
  ok(n0 === 900 && L.reduce((t, s) => t + s.n, 0) === 900 && L[L.length - 1].soFar === 900 && L.every((s, i) => s.soFar === L.slice(0, i + 1).reduce((t, x) => t + x.n, 0)), `default plan: ${L.length} sections, counts sum to 900, running totals add up (${L.map((s) => s.n).join('+')})`);
  ok(await pgL.$$eval('[data-r="lltable"] tr[hidden]', (x) => x.length) > 0 && await pgL.isVisible('[data-llmore]'), 'long list: later sections collapsed behind "Show all"');
  const tap = await pgL.$eval('[data-llmore]', (e) => e.getBoundingClientRect().height);
  ok(tap >= 44, 'Show all button is at least 44 px high (' + tap + ')');
  await pgL.click('[data-llmore]');
  ok(await pgL.$$eval('[data-r="lltable"] tr[hidden]', (x) => x.length) === 0, 'Show all opens every section');
  let csv = await csvNow();
  const ci = (h) => csv.head.findIndex((x) => x.startsWith(h));
  ok(csv.name === 'loading-list.csv' && csv.rows.length === L.reduce((t, s) => t + s.groups, 0) && csv.rows.reduce((t, r) => t + +r[ci('Boxes')], 0) === 900 && +csv.rows[csv.rows.length - 1][ci('Boxes loaded so far')] === 900, `CSV: one row per section, layer, type and position (${csv.rows.length} rows), counts sum to 900`);
  ok(csv.head.some((h) => h.includes('(cm)')) && csv.head.some((h) => h.includes('(kg)')), 'CSV headers name the units (cm, kg)');
  const head0 = L[1].head;
  await pgL.click('[data-units="imperial"]'); await settleL();
  const headI = (await info())[1].head; csv = await csvNow();
  ok(/ in from the back wall/.test(headI) && headI !== head0 && / lb/.test(headI) && csv.head.some((h) => h.includes('(in)')), 'unit switch: distances in inches (' + headI.slice(0, 60) + ')');
  await pgL.click('[data-units="metric"]'); await settleL();
  ok((await info())[1].head === head0, 'back to cm: the same distances as before (' + head0.slice(0, 60) + ')');
  // 600 x 400 x 400 mm x 5000 in the 40' HC: 660 in 10 interlocked walls of 1200 mm, 6 layers of 11 (hand-checked: 2 x 5 + 1 = 11 per layer, 2700 / 400 = 6 layers, 12032 / 1200 = 10 walls)
  await pgL.click('.boxcard:nth-child(2) [data-del]'); await pgL.fill('.boxcard [data-b="qty"]', '5000'); await settleL();
  L = await info();
  ok(await mainL() === 660 && L.length === 10 && L.every((s) => s.n === 66 && s.layers.length === 6 && s.layers.every((x) => x === 11)), '660: 10 sections of 66, each 6 layers of 11 (' + L.map((s) => s.n + ':' + s.layers.join('/')).slice(0, 2).join(' ') + ' …)');
  ok(L[0].head.includes('0–120 cm from the back wall') && L[9].head.includes('1,080–1,200 cm') && L[9].soFar === 660, 'walls 0–120 cm … 1,080–1,200 cm, running total 660');
  csv = await csvNow();
  ok(csv.rows.reduce((t, r) => t + +r[ci('Boxes')], 0) === 660 && new Set(csv.rows.map((r) => r[0])).size === 10, 'CSV of the 660 plan: 10 sections, counts sum to 660');
  // the slider order is the list order: after the first section's 66 boxes the slider is at the wall line
  const firstWall = await pgL.evaluate(() => { const s = document.querySelector('[data-step]'); s.value = '66'; s.dispatchEvent(new Event('input')); return document.querySelector('[data-r="stepTxt"]').textContent; });
  ok(firstWall.startsWith('66 of 660'), 'loading step slider: ' + firstWall);
  // column stacks and hand editing keep a complete list
  await pgL.click('[data-stack="column"]'); await settleL(); L = await info();
  ok(L.reduce((t, s) => t + s.n, 0) === await mainL(), `column stacks: list sums to the boxes loaded (${L.length} sections)`);
  await pgL.click('[data-ed="start"]'); await pgL.waitForTimeout(500); L = await info();
  ok(L.reduce((t, s) => t + s.n, 0) === 660 && L.length === 10, 'hand-edited plan: list of 660 in 10 sections');
  await pgL.click('[data-ed="exit"]'); await pgL.waitForTimeout(300);
  // semi-automatic: sections follow the steps
  await pgL.goto('http://localhost:4401/container-loading-calculator/'); await pgL.evaluate(() => history.replaceState(null, '', location.pathname)); await pgL.reload(); await settleL();
  await pgL.click('[data-mode="semi"]'); await settleL(); L = await info();
  ok(L.reduce((t, s) => t + s.n, 0) === 900 && L.some((s) => s.head.includes('Step 1')) && L.some((s) => s.head.includes('Step 2')), 'semi-automatic: list sums to 900 and names the steps');
  // pallet mode: default interlocked 45 = layers 8, 7, 8, 7, 8, 7
  await pgL.goto('http://localhost:4401/pallet-loading-calculator/'); await pgL.evaluate(() => history.replaceState(null, '', location.pathname)); await pgL.reload(); await settleL();
  L = await info();
  ok(await mainL() === 45 && L.length === 1 && L[0].layers.join() === '8,7,8,7,8,7' && L[0].soFar === 45, 'pallet: one list of 45 in layers ' + (L[0] && L[0].layers.join()));
  csv = await csvNow();
  ok(csv.rows.reduce((t, r) => t + +r[ci('Boxes')], 0) === 45 && csv.head.some((h) => h.includes('back edge')), 'pallet CSV: counts sum to 45, distances from the pallet edges');
  // print: the loading list is printed, its buttons are not
  await pgL.emulateMedia({ media: 'print' });
  ok(await pgL.isVisible('.loadlist table') && !(await pgL.isVisible('[data-llcsv]')), 'print: list shown, CSV button hidden');
  await pgL.close();
}
ok(errs.length === 0, 'no JS errors ' + errs.join(' | '));
// Cubic feet calculator: hand checks
// defaults 24·18·18 = 7,776 in³ ÷ 1,728 = 4.5 ft³ × 100 = 450, + 12³ = 1 ft³ × 50 = 50 → 500 ft³ × 0.028316846592 = 14.158 m³, ÷ 27 = 18.519 yd³,
// 14,158.4 L, 864,000 in³ ÷ 231 = 3,740.3 US gal; shares 500 ÷ 1,173.68 (20') = 42.6%, ÷ 2,393.51 = 20.9%, ÷ 2,696.03 (40' HC) = 18.5%, ÷ 4,070.57 (53') = 12.3%;
// 60 × 40 × 40 cm × 100 = 9.6 m³ ÷ 0.028316846592 = 339.02 ft³; 10 × 8 × 8 ft = 640 ft³ = 18.123 m³ = 23.704 yd³; converter 100 ft³ = 2.831685 m³, 1 m³ = 35.3147 ft³
{
  const pc = await b.newPage({ viewport: { width: 390, height: 844 }, locale: 'en-GB' }); pc.on('pageerror', (e) => errs.push(e.message));
  const T = (s) => pc.$eval(s, (e) => e.textContent.trim());
  const V = (k) => pc.inputValue(`.cuftline [data-k="${k}"]`);
  const shares = () => pc.$$eval('[data-r="spaces"] li strong', (r) => r.map((x) => x.textContent).join(' '));
  await pc.goto('http://localhost:4401/cubic-feet-calculator/'); await pc.evaluate(() => localStorage.removeItem('lpc-cuft-unit')); await pc.reload(); await pc.waitForTimeout(300);
  ok(await T('#r-main') === '500 ft³' && await T('[data-r="m3"]') === '14.158 m³' && await T('[data-r="yd3"]') === '18.519 yd³', 'cuft defaults 500 ft³ = 14.158 m³ = 18.519 yd³ (' + await T('#r-main') + ' ' + await T('[data-r="m3"]') + ')');
  ok(await T('[data-r="L"]') === '14,158.4 L' && await T('[data-r="gal"]') === '3,740.3 US gal' && await T('[data-r="count"]') === '150', 'cuft defaults 14,158.4 L, 3,740.3 US gal, 150 items');
  ok(await shares() === '42.6% 20.9% 18.5% 12.3%', 'cuft shares 20/40/40HC/53 (' + await shares() + ')');
  ok(await pc.inputValue('[data-conv="m3"]') === '2.831685', 'cuft converter: 100 ft³ = 2.831685 m³ (' + await pc.inputValue('[data-conv="m3"]') + ')');
  await pc.fill('[data-conv="m3"]', '1');
  ok(await pc.inputValue('[data-conv="ft3"]') === '35.3147' && (await T('[data-r="convOut"]')).includes('35.3147 ft³'), 'cuft converter: 1 m³ = 35.3147 ft³ (' + await pc.inputValue('[data-conv="ft3"]') + ')');
  await pc.fill('[data-conv="ft3"]', '27');
  ok(await pc.inputValue('[data-conv="m3"]') === '0.764555' && (await T('[data-r="convOut"]')).includes('= 1 yd³'), 'cuft converter: 27 ft³ = 0.764555 m³ = 1 yd³');
  const seen = [];
  for (const u of ['ft', 'cm', 'm', 'mm', 'in']) { await pc.click(`[data-unit="${u}"]`); seen.push(await V('l')); }
  ok(seen.join(' ') === '2 60.96 0.6096 609.6 24' && await T('#r-main') === '500 ft³', 'cuft: 24 in = 2 ft = 60.96 cm = 0.6096 m = 609.6 mm, back to 24 in (' + seen.join(' ') + ')');
  for (let i = 0; i < 3; i++) for (const u of ['mm', 'ft', 'cm', 'm', 'in']) await pc.click(`[data-unit="${u}"]`);
  ok(await V('l') === '24' && await V('w') === '18' && await T('#r-main') === '500 ft³', 'cuft: no drift after 3 rounds through all five units');
  await pc.click('.cuftline:nth-child(2) [data-del]'); await pc.click('[data-unit="cm"]');
  for (const [k, v] of [['l', '60'], ['w', '40'], ['h', '40'], ['qty', '100']]) await pc.fill(`.cuftline [data-k="${k}"]`, v);
  ok(await T('#r-main') === '339.02 ft³' && await T('[data-r="m3"]') === '9.6 m³' && (await shares()).startsWith('28.9%'), 'cuft cm case: 60 × 40 × 40 cm × 100 = 9.6 m³ = 339.02 ft³, 28.9% of a 20ft (' + await T('#r-main') + ')');
  await pc.click('[data-unit="in"]');
  ok(await V('l') === '23.62' && await T('#r-main') === '339.02 ft³', 'cuft: 60 cm shows 23.62 in, total unchanged');
  await pc.click('[data-unit="cm"]');
  ok(await V('l') === '60' && await T('#r-main') === '339.02 ft³', 'cuft: back to 60 cm');
  await pc.click('[data-unit="ft"]');
  for (const [k, v] of [['l', '10'], ['w', '8'], ['h', '8'], ['qty', '1']]) await pc.fill(`.cuftline [data-k="${k}"]`, v);
  ok(await T('#r-main') === '640 ft³' && await T('[data-r="m3"]') === '18.123 m³' && await T('[data-r="yd3"]') === '23.704 yd³' && (await T('[data-r="steps"]')).includes('10 × 8 × 8 ft = 640 ft³'), 'cuft ft case: 10 × 8 × 8 ft = 640 ft³ = 18.123 m³ = 23.704 yd³');
  await pc.fill('.cuftline [data-k="h"]', '');
  ok(await T('#r-main') === '–' && !(await pc.$eval('[data-r="skip"]', (e) => e.hidden)), 'cuft: empty height → no total, note shown');
  await pc.evaluate(() => localStorage.removeItem('lpc-cuft-unit'));
  await pc.close();
}
await b.close(); srv.close();
console.log(fails ? fails + ' failing' : 'planner checks pass'); process.exit(fails ? 1 : 0);
