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
