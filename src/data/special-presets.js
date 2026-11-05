// Reefer and open top presets for the load planner (container mode), from special-containers.json (Hapag-Lloyd).
// group keeps them out of the size comparison and the "fits in a smaller one" check unless one of the same group is
// selected, so dry cargo is never pointed at a reefer or an open top. Reefer height = the height Hapag-Lloyd lists
// (for the 20' reefer that is the booklet's maximum stowage height to the load line; the 40' HC series has none printed).
import sp from './special-containers.json';
export const reeferPresets = sp.reefers.map((c) => ({
  id: c.id, name: c.name, L: c.L, W: c.W, H: c.H, doorW: c.doorW, doorH: c.doorH, payload: c.payload, url: c.url,
  source: 'Hapag-Lloyd', group: 'reefer', kind: 'container',
  note: c.booklet.loadLineH
    ? `Height = the maximum stowage height to the red load line (${c.booklet.loadLineH.toLocaleString('en-US')} mm; inside height ${c.booklet.insideH.toLocaleString('en-US')} mm) in Hapag-Lloyd's booklet for series ${c.booklet.series}, so air can circulate. Reefers vary by series; keep cargo below the red line of your unit.`
    : `Height = the inside height on Hapag-Lloyd's page; its booklet prints no load-line height for this series (${c.booklet.series}). Every reefer has a red load line inside: keep cargo below it so air can circulate, and lower the height to your unit's line.`,
}));
export const openTopPresets = sp.opentops.map((c) => ({
  id: c.id, name: c.name, L: c.L, W: c.W, H: c.H, doorW: c.doorW, doorH: c.doorH, payload: c.payload, url: c.url,
  source: 'Hapag-Lloyd', group: 'opentop', kind: 'container',
  note: `Inside height with the roof bows in place${c.Hnobows ? ` (${c.Hnobows.toLocaleString('en-US')} mm without them)` : ''}. The plan loads through the end door (${c.doorW.toLocaleString('en-US')} × ${c.doorH.toLocaleString('en-US')} mm); cargo craned in through the roof opening (${c.roofL.toLocaleString('en-US')} × ${c.roofW.toLocaleString('en-US')} mm) is not limited by the door, so clear the door fields for that.`,
}));
export const specialPresets = [...reeferPresets, ...openTopPresets];
