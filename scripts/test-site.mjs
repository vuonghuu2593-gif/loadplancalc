// Checks every page in the built sitemap at phone width. Usage:
//   npm i --no-save playwright@1.56.1 && node scripts/test-site.mjs
// Uses the pre-installed Chromium headless shell (PW_CHROMIUM overrides the path).
import { chromium } from 'playwright';
import http from 'http'; import fs from 'fs'; import path from 'path';
const root = path.resolve('dist');
const site = fs.readFileSync(path.join(root, 'sitemap-0.xml'), 'utf8');
const urls = [...site.matchAll(/<loc>https?:\/\/[^/]+([^<]*)<\/loc>/g)].map((m) => m[1]);
const types = { '.html': 'text/html', '.css': 'text/css', '.svg': 'image/svg+xml', '.js': 'text/javascript', '.woff2': 'font/woff2', '.mjs': 'text/javascript', '.png': 'image/png', '.xml': 'application/xml' };
const srv = http.createServer((q, s) => { let p = path.join(root, decodeURIComponent(q.url.split('?')[0])); if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html'); if (!fs.existsSync(p)) { s.statusCode = 404; p = path.join(root, '404.html'); } s.setHeader('content-type', types[path.extname(p)] || 'text/plain'); s.end(fs.readFileSync(p)); }).listen(4399);
const exe = process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const b = await chromium.launch(fs.existsSync(exe) ? { executablePath: exe } : {});
const pg = await b.newPage({ viewport: { width: 390, height: 844 } });
let fails = 0; const errs = [];
pg.on('pageerror', (e) => errs.push(e.message));
for (const u of urls) {
  errs.length = 0;
  const r = await pg.goto('http://localhost:4399' + u);
  if (await pg.$('#r-main')) { await pg.waitForFunction(() => document.querySelector('#r-main').textContent.trim() !== '–', null, { timeout: 15000 }).catch(() => {}); await pg.waitForTimeout(400); }
  const info = await pg.evaluate(() => ({
    sw: document.documentElement.scrollWidth, h1: document.querySelectorAll('h1').length, title: document.title,
    text: document.body.innerText, desc: document.querySelector('meta[name=description]')?.content || '',
    result: [...document.querySelectorAll('#r-main')].map((e) => e.textContent.trim()),
  }));
  const p = [];
  if (r.status() !== 200) p.push('status ' + r.status());
  if (info.sw > 390) p.push('horizontal overflow ' + info.sw);
  if (info.h1 !== 1) p.push(info.h1 + ' h1 tags');
  if (!info.title || !info.desc) p.push('missing title/description');
  if (/\bNaN\b|\bundefined\b|\[object Object\]/.test(info.text)) p.push('NaN/undefined in page text');
  if (info.result.some((t) => t === '–' || t === '')) p.push('calculator shows no result with default inputs');
  if (errs.length) p.push('JS errors: ' + errs.join(' | '));
  if (p.length) { fails++; console.log('FAIL', u, p.join('; ')); }
}
// the user guide must cover every tool and be updated with them (scripts/guide-check.mjs)
const { check: guideCheck } = await import('./guide-check.mjs');
const gp = guideCheck(); gp.forEach((x) => console.log('FAIL guide:', x)); if (gp.length) fails++;
console.log(`pages: ${urls.length}, failing: ${fails}`);
await b.close(); srv.close();
process.exit(fails ? 1 : 0);
