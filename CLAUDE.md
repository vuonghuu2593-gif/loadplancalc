# Load Plan Calc (loadplancalc.com) — rules for every session

Independent AdSense site owned by Vương Đức Hữu: free load planning tools (cartons into containers, onto pallets,
pallets into containers and trailers) plus reference data. English content, global audience (metric and imperial).
Reports to Vương are in Vietnamese. Vương has approved fully automatic publishing: scheduled runs build, test and push
to `main` without asking. Because nobody reviews before publishing, the checks below are the review. Never skip them.

## Stack and deploy
- Astro static site, Node 22. `npm ci && npm run build` must pass. Push to `main` = production (Cloudflare Pages).
- Commit as `-c user.name="Vuong Duc Huu" -c user.email="vuonghuu2593@gmail.com"` with the attribution lines from the
  session's system reminder.
- Site name and URL live only in `src/site.js`.

## The engine (the core of the site)
- `src/scripts/packer.js`: block-building packer (mm, kg; x = length from the back wall, z = up) and `validate()`, an
  independent checker (inside bounds, no overlap, orientation rules, door opening, full support, non-stackable,
  weight, quantity). Runs in `pack-worker.js`. The page shows a warning instead of a plan if `validate()` fails.
- Any engine change: `node scripts/test-packer.mjs` must pass (hand-checked cases + 40 random cases). Never weaken a
  check in `validate()` to make a test pass. Improvements must not lower any hand-checked count.
- Page logic `src/scripts/planner.js` stores every value in mm/kg (unit switches never drift); 3D view `view3d.js`.
- Component `src/components/LoadPlanner.astro` (mode container | pallet). New planner pages reuse it.
- Planner features: orientation per box type (any / upright / custom set of the 6 positions), semi-automatic loading
  steps (`opts.steps`, `packSteps`), and hand editing (`src/scripts/editor.js`: `placeProblem`, `spots`, `nudge`,
  `fillAround`). Hand edits must stay checked by `placeProblem` before they are made; never let a manual change skip it.

## Facts and sources
- Math and units use exact definitions (1 in = 25.4 mm, 1 ft = 0.3048 m, 1 lb = 0.45359237 kg).
- Every product or equipment figure (container, pallet, trailer sizes, payloads, divisors, freight classes) must come
  from a primary source: the carrier's or manufacturer's own published specification, the standards body (ISO, EPAL),
  the official rule owner (NMFTA, UPS, FedEx, USPS), or the government/IMO text. Name and link it on the page and in the
  sources table on `/how-we-calculate/`. Read each figure twice independently (e.g. two fetches with different prompts,
  or a page text read plus a fetch) before using it. No source → leave the figure out.
- Data files: `src/data/*.json` with the source URL and checked date per figure set.
- Counts in tables ("how many pallets fit…") are computed by the engine from sourced dimensions, never copied.
- No prices or freight cost estimates unless the user enters their own rate. No invented experience, people or reviews.
- Do not make near-duplicate pages for keyword variants; improve the existing page instead.

## Every page
- One H1, unique title and meta description, mobile-first, existing CSS tokens and layouts (`Base`, `ToolPage`).
- Tool pages: working defaults that show a result, the lede contains a worked example whose numbers you computed with the
  engine AND checked by hand, "How the calculator works", a reference table, practical guidance, related links.
- Add new pages to the home page cards, the nav if important, `ops/keywords/page_map.csv` and related links.

## Before every push
`npm run build` → `node scripts/test-packer.mjs` → `npm i --no-save playwright@1.56.1 && node scripts/test-site.mjs`
(every sitemap page at 390 px: no JS errors, no overflow, one H1, no NaN/undefined, planner shows a result) →
`node scripts/test-planner.mjs` (unit round trips, share link, preset counts). All must pass. For a new calculator,
also check its numbers against a hand calculation for its defaults and one other case, and switch units both ways.
After pushing, wait for the deploy and open the new page on the live domain.

## Work tracking
- `ops/QUEUE.md`: ordered backlog. Take the first unchecked item; tick it when live; move blocked items to the end with a reason.
- `ops/LOG.md`: append one dated line per run.

## When the queue runs low: plan the next wave yourself (Vương's instruction: never wait for him)
When ops/QUEUE.md has fewer than 3 unchecked items, add at least 10 new items before doing any page work. Sources:
1. Uncovered demand in `ops/keywords/*.csv` (Semrush, Oct 2026: keyword;volume;cpc;kd) and `ops/keywords/page_map.csv`:
   rank by volume × (1 − kd/100) × max(cpc, 0.3); group keyword variants into one page; skip anything an existing page answers.
2. Natural companions of existing tools (other equipment types, trailers, air cargo ULDs) that have a primary source.
3. Planner features users need (pallet mode, loading list, print/PDF, saving several plans) — only with tests.
Each item states the target page, main keyword and volume, and the primary sources for its figures.

## Monetization
AdSense state for all sites lives in `ops/MONETIZATION.md` in the towinglimits repo. Follow the step for the current stage.
