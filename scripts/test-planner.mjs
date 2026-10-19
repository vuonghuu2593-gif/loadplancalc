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
await pg.screenshot({ path: process.env.SHOT || '/tmp/semi.png', fullPage: true });
ok(errs.length === 0, 'no JS errors ' + errs.join(' | '));
await b.close(); srv.close();
console.log(fails ? fails + ' failing' : 'planner checks pass'); process.exit(fails ? 1 : 0);
