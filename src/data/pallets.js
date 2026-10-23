// Pallet presets for the planners, from pallets.json (EPAL / CHEP). Footprint and height as the maker prints
// them (the CHEP pallet uses its printed inch size, 48 × 40 in = 1,219.2 × 1,016 mm), the safe working load as
// the starting max load, and the pallet's own weight where the maker prints it (EPAL "approx."; CHEP prints none).
import data from './pallets.json';
const KG_PER_LB = 0.45359237, MM_PER_IN = 25.4;
export const palletPresets = data.pallets.map((x) => ({
  id: x.id, name: x.name, source: x.publisher, url: x.url,
  L: x.Lin ? x.Lin * MM_PER_IN : x.L, W: x.Win ? x.Win * MM_PER_IN : x.W, H: x.H,
  maxWeight: x.swlKg ?? x.swlLb * KG_PER_LB,
  weightKg: x.weightKg ?? null,
  stackNote: x.stackNote || '',
}));
