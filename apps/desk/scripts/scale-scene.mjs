// rig:scale's scene (K7b, design-016 §6 K7) — its own module so a probe can stage the same desk the rig measures.

// ── THE SCENE: N root objects on a golden spiral, each index's kind from a seeded hash — 6 % mini mats (two notes inside each, one
//    written), 14 % prints (K6a's 24 real pictures, up to 4096², in turn), 3 % whiteboards with three strokes, 77 % notes (70 % of
//    them written); six notebooks and three desk calendars laid at fixed indices. The spacing ≈ 155 units (a 200-unit note just
//    touches its neighbours): at zoom 0.2 the view is 6,000 × 4,000 units and the root slot draws ≈ 2,000 (its 200 CSS px margin
//    included). The camera on the field's centre.
const TEXTS = ["Remember the milk", "Call the studio back before five", "The desk is the document", "idle-zero is a law", "one renderer under the camera", "a pan writes the camera and nothing else"];
const scribble = (i) => [
  { ink: "blue", tip: "bullet", points: Array.from({ length: 12 }, (_, k) => [40 + k * 32, 80 + Math.sin(k * 0.9 + i) * 30]) },
  { ink: "green", tip: "fine", points: Array.from({ length: 10 }, (_, k) => [60 + k * 36, 200 + Math.cos(k * 1.1 + i) * 25]) },
  { ink: "red", tip: "chisel", points: Array.from({ length: 6 }, (_, k) => [260 + k * 30, 120 + Math.sin(k + i) * 20]) },
];
/** K6a's real pictures (stress.mjs `PICTURES`): every size up to 4096², two seeds each — 24 distinct, decoded by the product's decoder. */
export const PICTURES = [[4096, 4096], [4096, 3072], [3072, 4096], [3264, 2448], [2048, 1536], [1600, 1200], [1024, 768], [800, 600], [640, 480], [512, 512], [384, 256], [256, 256]]
  .flatMap(([w, h], i) => [{ w, h, seed: 1 + 2 * i }, { w, h, seed: 2 + 2 * i }]);
/** A seeded hash in [0, 1) — the index's kind and whether a note is written, the same on every run. */
const hash = (i, salt) => { let h = (i * 0x9e3779b1 + salt * 0x85ebca77) >>> 0; h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16; return (h >>> 0) / 4294967296; };
export const SPACING = 155;
export function scaleScene(n) {
  const R = Math.round(Math.sqrt((n * SPACING * SPACING) / Math.PI));
  const minimats = [];
  const things = [];
  const calendars = [];
  const count = { note: 0, written: 0, print: 0, board: 0, minimat: 0, book: 0, pad: 0 };
  const books = new Set(Array.from({ length: 6 }, (_, k) => Math.floor(((k + 0.5) * n) / 6)));
  const pads = new Set(Array.from({ length: 3 }, (_, k) => Math.floor(((k + 0.3) * n) / 3)));
  for (let i = 0; i < n; i++) {
    const a = i * 2.399963;
    const rad = R * Math.sqrt((i + 1) / n);
    const x = Math.round(Math.cos(a) * rad);
    const y = Math.round(Math.sin(a) * rad);
    const u = hash(i, 1);
    if (books.has(i)) { things.push({ kind: "book", x, y, cover: "orbit", seed: 7 + i }); count.book++; }
    else if (pads.has(i)) { calendars.push({ x, y, month: "2026-09", weekStart: 1 }); count.pad++; }
    else if (u < 0.06) { minimats.push({ x, y, w: 320 + ((i * 37) % 160), h: 240 + ((i * 53) % 120), name: `Mat ${i}`, inside: { notes: [{ x: -60, y: -30, seed: 100 + i }, { x: 70, y: 40, seed: 200 + i, text: "inside" }], minimats: [] } }); count.minimat++; }
    else if (u < 0.2) { things.push({ kind: "print", x, y, angle: (((i * 7) % 21) - 10) / 100, picture: PICTURES[count.print % PICTURES.length] }); count.print++; }
    else if (u < 0.23) { things.push({ kind: "board", x, y, strokes: scribble(i) }); count.board++; }
    else { const written = hash(i, 2) < 0.7; things.push({ kind: "note", x, y, seed: 1 + i, text: written ? TEXTS[i % TEXTS.length] : "" }); count.note++; if (written) count.written++; }
  }
  return { scene: { camX: -3000, camY: -2000, zoom: 0.2, theme: "light", minimats, things, calendars }, count, R };
}
