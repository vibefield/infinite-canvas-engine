// THE DESK CLOCK'S STILLS (design-016 K8b) — a plugin kind's rows in ICE's golden (packages/objects/oracle/shas.json), drawn
// through the oracle's OPEN kind list: each clock a generic object (`{ type, x, y, props, asset }`) its kind resolves and
// records. Pure data (no import: the Node oracle, the parity page and rig:world read it alike). Every clock shows a PINNED time —
// 10:08:42 UTC, the handle's generic `pinAsset` in the world (`asset: { at }`) — in an explicit zone, so no host's clock or
// zone moves a pixel. By day and by night (the Moon, the lume); close up (the numerals, the facets, the glint); and in mini
// mats — one with its face past the gate (the live inside: the clocks drawn by their own pass, lit by the host desk's lamp),
// one far (the far LOD: each clock its chip, a disc of its dial).

/** 2026-09-28 10:08:42 UTC — the stills' time. */
export const CLOCK_AT = Date.UTC(2026, 8, 28, 10, 8, 42);
/** The clock's durable type (src/object.ts `CLOCK_TYPE` — restated: this module imports nothing). */
export const CLOCK_TYPE_ID = "ice-examples.desk-clock";
/** The fault fixture's clock whose WGSL does not compile (src/broken.ts `BROKEN_CLOCK_TYPE` — restated; petition I24): its kind is refused at create. */
export const BROKEN_CLOCK_TYPE_ID = "ice-examples.desk-clock.broken";

const matStill = { time: 3.7, goboTime: 57.14, noise: [0.37, 0.61] };
const base = { camX: 13.7, camY: -21.3, theme: "light", zoom: 1, mat: matStill };
const clock = (x, y, props = {}) => ({ type: CLOCK_TYPE_ID, x, y, props: { zone: "+00:00", ...props }, asset: { at: CLOCK_AT } });

/** A desk of the three dials: seconds on and off, the 24-hour ring, three zones (UTC, Tokyo's +09:00, New York's −05:00 as set). */
export const CLOCK_DESK = [
  clock(260, 250),
  clock(520, 290, { style: "station" }),
  clock(780, 250, { style: "graphite", ring24: true }),
  clock(1040, 290, { seconds: false, ring24: true }),
  clock(390, 560, { style: "station", seconds: false, zone: "+09:00" }),
  clock(650, 560, { style: "graphite", zone: "-05:00" }),
];
const mm = (theme) => ({
  ...base, theme, camX: 0, camY: 0,
  minimats: [
    { x: 380, y: 330, w: 640, h: 480, name: "Time zones", inside: { notes: [], minimats: [], objects: [clock(-150, -40), clock(150, -40, { style: "station", zone: "+09:00" }), clock(0, 150, { style: "graphite", zone: "-05:00" })] } },
    { x: 985, y: 555, w: 250, h: 190, name: "Far", inside: { notes: [], minimats: [], objects: [clock(-120, 0), clock(120, 0, { style: "graphite" })] } },
  ],
});

export const CLOCK_SCENES = [
  { name: "clock-day-z1", scene: { ...base, objects: CLOCK_DESK } },
  { name: "clock-night-z1", scene: { ...base, theme: "dark", objects: CLOCK_DESK } },
  { name: "clock-z3", scene: { ...base, zoom: 3, camX: 60, camY: 117, objects: [clock(260, 250, { ring24: true })] } },
  { name: "clock-minimat-z1", scene: mm("light") },
  { name: "clock-minimat-night-z1", scene: mm("dark") },
];
