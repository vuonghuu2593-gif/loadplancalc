// Rental box truck presets for the load planner (container mode), from box-trucks.json (U-Haul and Penske truck pages).
// Door fields only where the fleet prints a door opening (U-Haul); payload = the printed max load / load capacity, or
// the printed gross vehicle weight minus the printed empty weight when that is lower (U-Haul 10′: 8,600 − 5,790 = 2,810 lb < 2,850 lb).
// Penske prints "up to" sizes and calls them approximations, so its presets say so.
import bdata from './box-trucks.json';
export const boxTrucks = bdata.trucks;
const ftin = (i) => { const f = Math.floor(i / 12), r = i - f * 12; return r ? `${f}′ ${r}″` : `${f}′`; };
export const truckPresets = bdata.trucks.map((t) => ({
  id: t.id, name: t.name, L: t.L, W: t.W, H: t.H, doorW: t.doorW, doorH: t.doorH, payload: t.gvwLb && t.emptyLb && (t.gvwLb - t.emptyLb) < t.maxLoadLb ? (t.gvwLb - t.emptyLb) * 0.45359237 : t.maxLoadKg, url: t.url,
  source: `${t.fleet} (${t.size} truck page)`,
  note: t.fleet === 'U-Haul'
    ? `Inside ${ftin(t.Lin)} × ${ftin(t.Win)} × ${ftin(t.Hin)}, door opening ${ftin(t.doorWin)} × ${ftin(t.doorHin)} and max load ${t.maxLoadLb.toLocaleString('en-US')} lb as printed${t.gvwLb && t.emptyLb && (t.gvwLb - t.emptyLb) < t.maxLoadLb ? ` (the payload here is the lower ${(t.gvwLb - t.emptyLb).toLocaleString('en-US')} lb: gross vehicle weight ${t.gvwLb.toLocaleString('en-US')} lb minus empty weight ${t.emptyLb.toLocaleString('en-US')} lb, both as printed)` : ''}; U-Haul says all its truck measurements are approximate and the truck you get may vary. Mom's Attic (the space over the cab) is not part of the load space here. Measure your truck if the plan is tight.`
    : `Interior “up to” ${ftin(t.Lin)} × ${ftin(t.Win)} × ${ftin(t.Hin)} and “up to” ${t.maxLoadLb.toLocaleString('en-US')} lb load capacity as printed; Penske calls these approximations that may vary by manufacturer, so your truck can be smaller. No door opening is published: the door fields are empty (no door check) until you enter your own.`,
}));
