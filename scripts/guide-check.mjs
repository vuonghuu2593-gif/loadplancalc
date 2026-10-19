// Keeps the user guide (/how-to-use/) in step with the tools. Vương's rule: every update to a tool
// must update the guide too. Two checks, run at the end of scripts/test-site.mjs (after npm run build):
//   1. every tool page in the sitemap is linked from /how-to-use/ and has its own section there
//      (id = the page's last path segment);
//   2. the tools have not changed since the guide was last updated: a fingerprint of how the tools
//      work (scripts, components, forms and inline scripts of pages, the list of tool pages) must
//      match ops/guide-stamp.json.
// After changing a tool: update src/pages/how-to-use.astro (its sections and the "What's new" list),
// then run   node scripts/guide-check.mjs --stamp   and commit the stamp with the change.
// --stamp refuses when the tools changed but the guide file did not.
import fs from 'fs'; import path from 'path'; import crypto from 'crypto';
import { fileURLToPath } from 'url';

// What counts as a tool and which files describe how the tools work (this site: the load planner).
const FULL = ['src/scripts', 'src/components'];          // fingerprinted in full
const USAGE = ['src/pages', 'src/layouts'];              // forms, inline scripts and component tags only
const isTool = (route, html) => html.includes('class="planner"');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STAMP = path.join(ROOT, 'ops/guide-stamp.json');
const GUIDE_SRC = path.join(ROOT, 'src/pages/how-to-use.astro');
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

function walk(dir) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return [];
  if (fs.statSync(abs).isFile()) return [dir];
  return fs.readdirSync(abs).flatMap((n) => walk(path.join(dir, n)));
}
// how a page is used: its forms, inline scripts and component tags (text and styling changes do not count)
function usagePart(src) {
  const parts = [...src.matchAll(/<form[\s\S]*?<\/form>|<script[\s\S]*?<\/script>|<[A-Z][A-Za-z0-9]*\b[^>]*>/g)].map((m) => m[0]);
  return parts.join('\n');
}
function toolRoutes() {
  const dist = path.join(ROOT, 'dist');
  const map = fs.readFileSync(path.join(dist, 'sitemap-0.xml'), 'utf8');
  return [...map.matchAll(/<loc>https?:\/\/[^/]+([^<]*)<\/loc>/g)].map((m) => m[1])
    .filter((u) => u !== '/how-to-use/' && isTool(u, fs.readFileSync(path.join(dist, u, 'index.html'), 'utf8'))).sort();
}
function fingerprint(routes) {
  const h = crypto.createHash('sha256');
  for (const f of [...new Set(FULL.flatMap(walk))].sort()) h.update(f + '\n' + fs.readFileSync(path.join(ROOT, f), 'utf8'));
  for (const f of [...new Set(USAGE.flatMap(walk))].filter((x) => x.endsWith('.astro')).sort()) {
    if (path.resolve(ROOT, f) === GUIDE_SRC) continue;
    h.update(f + '\n' + usagePart(fs.readFileSync(path.join(ROOT, f), 'utf8')));
  }
  h.update(routes.join('\n'));
  return h.digest('hex');
}

export function check() {
  const problems = [];
  const routes = toolRoutes();
  const guidePath = path.join(ROOT, 'dist/how-to-use/index.html');
  if (!fs.existsSync(guidePath)) return ['/how-to-use/ page is missing'];
  const html = fs.readFileSync(guidePath, 'utf8');
  for (const r of routes) {
    const id = r.split('/').filter(Boolean).pop();
    if (!html.includes(`href="${r}"`)) problems.push(`guide does not link to ${r}`);
    if (!new RegExp(`id="${id}"`).test(html)) problems.push(`guide has no section id="${id}" for ${r}`);
  }
  let stamp = null; try { stamp = JSON.parse(fs.readFileSync(STAMP, 'utf8')); } catch { /* none */ }
  if (!stamp) problems.push('ops/guide-stamp.json is missing: update the guide, then run node scripts/guide-check.mjs --stamp');
  else {
    if (stamp.tools !== fingerprint(routes)) problems.push('the tools changed since the guide was last updated: update src/pages/how-to-use.astro (sections + "What\'s new"), then run node scripts/guide-check.mjs --stamp');
    if (stamp.guide !== sha(fs.readFileSync(GUIDE_SRC, 'utf8'))) problems.push('the guide changed after its stamp: run node scripts/guide-check.mjs --stamp');
  }
  return problems;
}

function stampNow() {
  const routes = toolRoutes();
  const tools = fingerprint(routes), guide = sha(fs.readFileSync(GUIDE_SRC, 'utf8'));
  let prev = null; try { prev = JSON.parse(fs.readFileSync(STAMP, 'utf8')); } catch { /* first stamp */ }
  if (prev && prev.tools !== tools && prev.guide === guide) {
    console.error('Refused: the tools changed but src/pages/how-to-use.astro did not. Update the guide for the change first.');
    process.exit(1);
  }
  const today = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(STAMP, JSON.stringify({ updated: today, tools, guide, toolPages: routes }, null, 2) + '\n');
  console.log(`guide stamp written (${routes.length} tool pages, ${today}). Rebuild before running the site test.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--stamp')) stampNow();
  else { const p = check(); p.forEach((x) => console.log('FAIL guide:', x)); console.log(p.length ? `${p.length} guide problems` : 'guide is up to date'); process.exit(p.length ? 1 : 0); }
}
