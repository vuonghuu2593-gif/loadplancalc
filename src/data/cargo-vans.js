// Cargo van presets for the load planner (container mode), from cargo-vans.json (Mercedes-Benz Vans' Sprinter cargo van page).
// Width = the width between the rear wheel arches ("Cargo Width at Wheelhouse"), because the arches stand inside the
// cargo floor; the wider floor ("Max Width at Floor") is only usable in front of and behind them. Payload = the printed
// payload capacity of the 2500 Standard Output version.
import vdata from './cargo-vans.json';
export const cargoVans = vdata.vans;
export const vanPresets = vdata.vans.map((v) => ({
  id: v.id, name: `Sprinter cargo van ${v.short}`, L: v.L, W: v.W, H: v.H, doorW: v.doorW, doorH: v.doorH, payload: v.payloadKg, url: v.url,
  source: `Mercedes-Benz Vans (Sprinter cargo van page)`,
  note: `Cargo bed ${v.Lin} in long, ${v.wheelhouseWin} in between the wheel arches (${v.floorWin} in at the floor outside them), ${v.Hin} in high, rear door ${v.doorWin} × ${v.doorHin} in and payload ${v.payloadLb.toLocaleString('en-US')} lb (2500 Standard Output) as Mercedes-Benz prints them. The plan uses the ${v.wheelhouseWin} in between the wheel arches over the whole length. The 3500, 3500XD and 4500 versions print ${vdata.wheelhouseOther.wheelhouseWin} in at the wheel arches and a different payload: enter yours.`,
}));

// Ram ProMaster City cargo van (promaster-city.json, Stellantis body builder document, mm as printed). Conservative plan
// size: the beltline cargo length, the width between the wheel arches and the height at the rear axle; door = rear
// doors' maximum loading width × rear opening height. No payload is printed there, so the payload field stays empty.
import pmc from './promaster-city.json';
const pf = Object.fromEntries(pmc.figures.map((f) => [f.code, f]));
export const promasterCity = { ...pmc, f: pf, P: Object.fromEntries(Object.entries(pmc.plan).map(([k, c]) => [k, pf[c].mm])) };
export const promasterCityPresets = [{
  id: 'pm-city', name: 'Ram ProMaster City cargo van', L: pf['L204-1'].mm, W: pf['W201'].mm, H: pf['H201'].mm,
  doorW: pf['W509'].mm, doorH: pf['H202'].mm, payload: null, url: pmc.url, source: 'Stellantis (Ram ProMaster City body builder document)',
  note: `Cargo length ${pf['L202-1'].in.toFixed(1)} in at the floor and ${pf['L204-1'].in.toFixed(1)} in at the beltline, ${pf['W201'].in.toFixed(1)} in between the wheel arches (${pf['W200'].in.toFixed(1)} in maximum), ${pf['H201'].in.toFixed(1)} in high at the rear axle, rear door opening ${pf['W509'].in.toFixed(1)} × ${pf['H202'].in.toFixed(1)} in, as Stellantis prints them. The plan uses the beltline length, the width between the wheel arches and the height at the rear axle over the whole space. No payload is printed in that document: enter your van's payload from its door-jamb label.`,
}];

// Chevrolet Express cargo van (express-cargo-vans.json, GM Upfitter 2023 specification guide, in./mm as printed).
// Conservative plan size: load floor length to the front seat, width between the wheelhousings, cargo area height;
// door = rear opening width at beltline × rear opening height; each the smaller of in × 25.4 and the printed mm.
// Payload depends on engine and series (2500/3500), so the payload field stays empty.
import ex from './express-cargo-vans.json';
const lo = (i, mm) => Math.min(i * 25.4, mm);
export const express = { ...ex, bodies: ex.bodies.map((b) => ({ ...b, P: { L: lo(b.floorToSeatIn, b.floorToSeatMm), W: lo(b.wheelhouseWIn, b.wheelhouseWMm), H: lo(b.HIn, b.HMm), doorW: lo(b.doorWIn, b.doorWMm), doorH: lo(b.doorHIn, b.doorHMm) } })) };
export const expressPresets = express.bodies.map((b) => ({
  id: b.id, name: `${b.name.replace('Chevrolet Express cargo van, ', 'Chevrolet Express cargo van ')}`, ...b.P, payload: null, url: ex.url, source: 'GM (2023 Express Van - Cargo specification guide)',
  note: `Load floor ${b.floorToSeatIn} in long to the front seat (${b.floorToEngineIn} in to the engine cover), ${b.wheelhouseWIn} in between the wheelhousings, ${b.HIn} in high, rear door opening ${b.doorWIn} × ${b.doorHIn} in, as GM prints them for the 2023 model year. The plan uses the length to the front seat, the width between the wheelhousings over the whole length and the cargo area height. Payload depends on the engine and on 2500 or 3500: enter your van's payload from its door-jamb label.`,
}));
