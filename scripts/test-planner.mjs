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
await pg.selectOption('[data-f="preset"]', '20dv'); await settle();
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
  // Euro pallet 1200 x 800 x 144 mm, 1800 mm limit: 8 per layer x 6 layers = 48; 100 cartons -> 3 pallets (2 x 48 + 4)
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
ok(errs.length === 0, 'no JS errors ' + errs.join(' | '));
await b.close(); srv.close();
console.log(fails ? fails + ' failing' : 'planner checks pass'); process.exit(fails ? 1 : 0);
