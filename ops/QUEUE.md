# Queue — loadplancalc.com (Web C)

Take the first unchecked item. Tick it when it is live. Blocked items go to the end with the reason.
Priority score = volume × (1 − kd/100) × max(cpc, 0.3) from ops/keywords/semrush_2026-10.csv.

- [x] /container-loading-calculator/ — "container loading calculator" 320 + "3d container loading calculator free" 390 (KD 5) + variants. Engine: block building, validator. Container presets: Hapag-Lloyd spec pages.
- [x] /shipping-container-dimensions/ — "shipping container dimensions" 5,400 + 20/40/HC variants. Source: Hapag-Lloyd spec pages.
- [x] /pallet-sizes/ — "standard pallet size" 12,100 (KD 25, CPC $29), "pallet dimensions" 3,600, "euro pallet dimensions" 480. Sources: EPAL (epal-pallets.org) for EUR pallets, ISO 6780 (iso.org) for the six ISO sizes, and a primary source for the 48 × 40 in GMA pallet (NWPCA or the standard text). Skip any size without a primary source. — live 2026-10-20 (EPAL 1/2/3/6/7 from epal-pallets.org + CHEP 48 × 40 in block pallet; ISO 6780 sizes left out: iso.org text not checkable)
- [x] /pallet-loading-calculator/ — "pallet calculator" 1,300 (KD 17; SERP is only app-store pages) + palletizing/configuration/stacking/Ti-Hi ~700. LoadPlanner mode="pallet": pallet footprint + overhang, max load height, pallet height, max load weight; presets only from /pallet-sizes/ sources. Show Ti-Hi (boxes per layer × layers) for single box type. — live 2026-10-21 (EPAL 1/2/3/6/7 + CHEP 48 × 40 in presets from pallets.json, SWL as starting max load weight, 1,800 mm max height as a labelled example; engine palletPack builds one-type pallets layer by layer; Ti-Hi + pallets needed; default 48 = 8 × 6)
- [x] /how-many-pallets-fit-in-a-container/ — "how many pallets fit in a 40ft container" 260 + 20ft + calculator variants ~150. Planner with pallets as boxes (single/double stack) + table computed by the engine for EUR/ISO pallets × Hapag-Lloyd containers. — live 2026-10-21 (EPAL 1/2/3/6/7 + CHEP 48 × 40 in × Hapag-Lloyd 20'/40'/40' HC/45' HC, one and two high, engine-computed + validated at build; ISO 6780 sizes left out: not sourced; pallet-size picker on box cards; default 25 Euro pallets in a 40' DV = 15 + 10 lanes)
- [ ] /cbm-calculator/ — "cbm calculator" 2,900 US / 12,100 IN / 1,600 UK (CPC $3–29). Pure math (exact unit definitions); cartons → CBM, cubic feet, and % of each container (Hapag-Lloyd volumes).
- [ ] /how-many-pallets-fit-in-a-53-foot-trailer/ — ~2,800 combined (KD 7–14). Needs inside dimensions from trailer makers' published spec sheets (Wabash, Utility, Great Dane, Hyundai Translead). Engine computes counts.
- [ ] /freight-class-calculator/ — "freight class calculator" 14,800 (KD 31, CPC $4) + "freight density calculator" 1,300. Source: NMFTA's published density-based classification scale (nmfta.org). Only if the official scale is published openly.
- [ ] /dimensional-weight-calculator/ — 1,600 + volumetric 260. Divisors from UPS, FedEx, USPS official pages; make the divisor editable.
- [ ] /shipping-container-dimensions/ add reefer 20' and 40' HC reefer and open top rows — "reefer container dimensions"; Hapag-Lloyd pages.
- [ ] /53-foot-trailer-dimensions/ — "53 ft trailer dimensions" 320 + inside 90 + "truck trailer dimensions" 480. Trailer makers' spec sheets.
- [ ] Planner feature: pallets-into-container mode and a printable loading list (row-by-row instructions).
- [ ] /cubic-feet-calculator/ — 22,200 (KD 35, low CPC) + cubic feet to cubic meters 3,600. Exact unit math; carton/container examples.
