// 53' dry van presets for the load planner (container mode), from trailers.json (Hyundai Translead).
// The maker publishes no rear door opening or payload on these pages, so both stay empty:
// no door check and no weight limit until the user enters their own.
import tdata from './trailers.json';
export const trailers = tdata.trailers;
export const trailerPresets = tdata.trailers.map((t) => ({
  id: t.id, name: t.name, L: t.L, W: t.W, H: t.H, doorW: null, doorH: null, payload: null, url: t.url,
  source: `Hyundai Translead (${t.model})`,
  note: `Inside ${t.printed.length.replace(/.*Interior /, '')} long, ${t.Win}″ wide, ${t.Hin}″ high as printed by the maker; models are customized, so check your trailer. No door opening or payload is published there: those fields are empty (no door check, no weight limit) until you enter your own.`,
}));
