// rig:interact — the prototype's grammar through a real Chrome, FROM THE WORLD (D2a-world; the
// prototype's test/harness/interact.mjs; the nesting — drop-into, ⌥ keeps, the vinyl key — since D2b).
// Page-level synthetic pointer and key events (CDP Input.* — nothing reaches the OS) on a desk of
// two notes and a mini mat spawned through `window.__desk`, the checks read off the WORLD and the
// builder's flux: a click selects a note and its ring springs to 1 without overshoot through
// intermediate frames; a hovered mini mat RISES (Q-j); a dragged note lifts while held, lands where
// it was let go with its Position committed in ONE undo step, and ⌘Z restores it; ⌫ fades the
// note out over 220 ms (a ghost, no entity) and the entity is gone — ⌘Z brings it back; shift-drag
// on the bare mat draws the marquee and selects both notes; the wheel zooms about the pointer by
// exp(−Δ · 0.0016) with the world point under it fixed; a bare drag pans; a click on the bare mat
// deselects. D4a (*Marks on the Mat*, the desk's chrome on the GPU): a selection wears BRACKETS (the marks pass) and its
// note no ring; the screen-space selection menu stands 10 px above them and steps aside during a drag, back 200 ms after;
// a snap lights the laser along the aligned edge; the vellum draws, touches, then folds onto the union; a taped note refuses
// a drag with a 2 px give (its Position never moves) and the vellum passes over it; ⌘⇧L tapes and lifts; inside a mini mat
// entered by a double-click, a selected note's brackets stand where the entered camera draws it.
// A click whose release shares its frame with a far move still selects its note, and nothing follows
// the cursor after (core's fold cut). Exit 0 = every check passed.
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { launchChrome, openTab } from "./cdp.mjs";
import { kindsRig } from "./interact-kinds.mjs";

const here = import.meta.dirname;
const app = resolve(here, "..");
const repo = resolve(app, "../..");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function freePort(from) {
  for (let port = from; port < from + 40; port++) {
    const free = await new Promise((r) => { const s = createServer(); s.once("error", () => r(false)); s.listen(port, "127.0.0.1", () => s.close(() => r(true))); });
    if (free) return port;
  }
  throw new Error(`no free CDP port in ${from}…${from + 39}`);
}
const server = spawn(process.execPath, [resolve(here, "server.mjs"), repo, "0"], { stdio: ["ignore", "pipe", "inherit"] });
const PORT = await new Promise((r) => server.stdout.once("data", (b) => r(Number(String(b).match(/PORT (\d+)/)[1]))));
const chrome = await launchChrome({ port: await freePort(9531), headless: !process.env.DESK_HEADED });
let done = false;
async function cleanup() { if (done) return; done = true; try { await chrome.close(); } catch {} try { server.kill("SIGKILL"); } catch {} }
setTimeout(async () => { console.log("WATCHDOG"); await cleanup(); process.exit(2); }, 300_000).unref();
let pass = 0;
let failN = 0;
const check = (ok, msg) => { console.log(`  ${ok ? "PASS" : "FAIL"}  ${msg}`); ok ? pass++ : failN++; };
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

try {
  const tab = await openTab(chrome.port, `http://127.0.0.1:${PORT}/apps/desk/dist/index.html`);
  const logs = [];
  await tab.send("Runtime.enable"); await tab.send("Log.enable"); await tab.send("Page.enable");
  tab.on("Runtime.exceptionThrown", (e) => logs.push(`EXCEPTION ${e.exceptionDetails.exception?.description ?? e.exceptionDetails.text}`));
  tab.on("Log.entryAdded", (e) => { if (e.entry.level === "error") logs.push(`[${e.entry.level}] ${e.entry.text}`); });
  await tab.send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 800, deviceScaleFactor: 2, mobile: false });
  for (let i = 0; i < 200; i++) { await tab.send("Page.bringToFront"); if (await tab.evaluate("typeof window.__desk === 'object' && window.__desk.state.ready", { timeoutMs: 20000 })) break; await sleep(200); }
  await tab.send("Page.bringToFront");
  const q = (js) => tab.evaluate(js, { timeoutMs: 15000 });
  const settle = () => tab.evaluate("window.__desk.settle(4000)", { awaitPromise: true, timeoutMs: 15000 });
  const mouse = async (type, x, y, extra = {}) => tab.send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1, ...extra });
  const click = async (x, y, extra = {}) => { await mouse("mouseMoved", x, y, extra); await mouse("mousePressed", x, y, extra); await sleep(30); await mouse("mouseReleased", x, y, extra); };
  const key = async (k, code, vk, modifiers = 0) => { await tab.send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, windowsVirtualKeyCode: vk, modifiers }); await tab.send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: vk, modifiers }); };
  const META = 4;
  const SHIFT = 8;
  const drag = async (from, to, extra = {}, steps = 8) => {
    await mouse("mouseMoved", from[0], from[1], extra); await mouse("mousePressed", from[0], from[1], extra);
    for (let i = 1; i <= steps; i++) { await mouse("mouseMoved", from[0] + ((to[0] - from[0]) * i) / steps, from[1] + ((to[1] - from[1]) * i) / steps, extra); await sleep(16); }
    await sleep(40);
    await mouse("mouseReleased", to[0], to[1], extra);
  };
  const entity = (id) => q(`window.__desk.entity(${id})`);
  const entities = () => q("window.__desk.entities()");

  // the desk: two notes and a mini mat at zoom 1, camera (0, 0) — screen = world; a still mat (no wind: the checks read numbers, not pixels)
  await q("window.__desk.setCamera({ x: 0, y: 0, zoom: 1 }); window.__desk.ambient('still')");
  const a = await q("window.__desk.spawn('desk.note', { seed: 7 }, { x: 300, y: 250 })");
  const b = await q("window.__desk.spawn('desk.note', { seed: 11 }, { x: 900, y: 250 })");
  const m = await q("window.__desk.spawn('desk.minimat', { name: 'Inbox' }, { x: 600, y: 560 })");
  await settle();
  check((await entities()).length === 3, `the desk holds two notes and a mini mat (${(await entities()).map((e) => e.type).join(", ")})`);

  // --- 1. click note B → selected; its ring springs to 1 with no overshoot, through intermediate frames
  await click(900, 250);
  const trace = [];
  let peak = 0;
  for (let t = 0; t <= 600; t += 100) { const r = (await entity(b)).flux?.ring ?? 0; trace.push(r.toFixed(2)); peak = Math.max(peak, r); await sleep(100); }
  console.log(`-- select --\n  ring 0..600ms: ${trace.join("  ")}`);
  const selB = await entity(b);
  check(selB.selected && (await q("window.__desk.selection()")).length === 1, "a click selects the note (and only it)");
  check(peak > 0.95 && peak <= 1.0000001 && selB.flux.ring === 1, `the ring reached ${peak.toFixed(3)} without overshoot and SNAPPED to 1`);
  check(trace.some((v) => Number(v) > 0.05 && Number(v) < 0.95), "intermediate frames observed — not a jump cut");

  // --- 2. hover the mini mat's face → it rises (Marks on the Mat Q-j); the notes never do
  await mouse("mouseMoved", 600, 560);
  await sleep(600);
  const hovered = await entity(m);
  check(hovered.flux.hover > 0.9 && hovered.geometry.lift > 1.9, `hovered, the mini mat rises (hover ${hovered.flux.hover.toFixed(2)}, lift ${hovered.geometry.lift.toFixed(2)} of 2)`);
  await mouse("mouseMoved", 300, 250);
  await sleep(600);
  check((await entity(m)).flux.hover === 0 && (await entity(a)).geometry.lift === 0, "off the mat it settles back; a hovered note does not rise");

  // --- 3. drag note A by (−60, −60): it lifts while held, lands where let go — ONE undo step — and ⌘Z restores it.
  //     The drag keeps the note's rect CLEAR of the mini mat (its top at y = 320): a release whose bounds overlap a
  //     container that accepts the type is CONSUMED into it (core's law, design-003 §5.5) — the mat's inside is D2b's.
  await mouse("mouseMoved", 300, 250); await mouse("mousePressed", 300, 250);
  for (let i = 1; i <= 6; i++) { await mouse("mouseMoved", 300 - 10 * i, 250 - 10 * i); await sleep(30); }
  await sleep(150);
  const held = await entity(a);
  await mouse("mouseReleased", 240, 190);
  await settle();
  const moved = await entity(a);
  check((await q("window.__desk.stats().active")) === 3, "the note stays a root member of the desk (not consumed by the mini mat)");
  check(held.grabbed && held.flux.lift > 0.2 && held.geometry.lift > 2, `held, the note lifts off the mat (lift ${held.flux.lift.toFixed(2)}, ${held.geometry.lift.toFixed(1)} units)`);
  // The landing is the HELD position exactly (the release commits where the hand was): the move's origin is the first
  // sample past core's drag slop (GESTURE_DEFAULTS.dragSlopPx = 10, claimed on the tick after the crossing), so how many
  // of the 6 samples the dead band eats is tick-quantised — one or two — and the exact landing is not this rig's to pin.
  check(near(moved.cx, held.cx) && near(moved.cy, held.cy) && !moved.grabbed && moved.flux.lift === 0, `let go, it lies exactly where it was held: (${moved.cx.toFixed(1)}, ${moved.cy.toFixed(1)}), settled (lift ${moved.flux.lift})`);
  check(moved.cx <= 270 && moved.cx >= 240 && near(300 - moved.cx, 250 - moved.cy), `it moved along the drag by ${(300 - moved.cx).toFixed(0)} of 60 (the slop ate ${((moved.cx - 240) / 10).toFixed(0)} sample${moved.cx - 240 === 10 ? "" : "s"})`);
  await key("z", "KeyZ", 90, META);
  await settle();
  const undone = await entity(a);
  check(near(undone.cx, 300) && near(undone.cy, 250), `⌘Z restores it in ONE step: (${undone.cx.toFixed(1)}, ${undone.cy.toFixed(1)})`);
  await key("z", "KeyZ", 90, META | SHIFT);
  await settle();
  const redone = await entity(a);
  check(near(redone.cx, moved.cx) && near(redone.cy, moved.cy), `⇧⌘Z redoes it exactly: (${redone.cx.toFixed(1)}, ${redone.cy.toFixed(1)})`);

  // --- 4. ⌫ deletes note A: the entity is gone at once, the ghost fades over 220 ms, then nothing; ⌘Z brings it back
  await click(redone.cx, redone.cy);
  check((await entity(a)).selected, "the moved note is selected by a click");
  // a tap WRITES (D2c, STICKY.md §4): the click put the pen on the note — ⌫ would erase a glyph. Escape puts the pen
  // down and keeps the selection; ⌫ on a selected, unfocused note deletes it (the prototype's grammar)
  await key("Escape", "Escape", 27);
  const before = (await entities()).length;
  await key("Backspace", "Backspace", 8);
  const ghosts = [];
  for (let t = 0; t <= 400; t += 50) { ghosts.push(await q("window.__desk.stats().ghosts")); await sleep(50); }
  const after = (await entities()).length;
  check(after === before - 1 && (await entity(a)) === null, `⌫ removes the entity (${before} → ${after})`);
  // the key lands on the next tick, so the first sample may still read 0; then ONE ghost for ~220 ms (≈ 3–5 samples at this
  // cadence), then none — never two, never a return
  const run = ghosts.join("");
  check(/^0?1{2,6}0+$/.test(run), `the ghost fades then is forgotten — one ghost over ~220 ms, then none (ghosts sampled over 400 ms: ${ghosts.join(" ")})`);
  await key("z", "KeyZ", 90, META);
  await settle();
  check((await entities()).length === before, `⌘Z brings the note back (${(await entities()).length})`);

  // --- 5. shift-drag on the bare mat: the vellum marquee gathers what it CROSSES (l3-marquee: the spatial index's
  //     intersection, a taped widget passed over) — both notes, not the mini mat below (its top at y = 320)
  await click(100, 700);   // the bare mat: deselect
  await drag([100, 60], [1050, 300], { modifiers: SHIFT }, 10);
  await sleep(200);
  const sel = await q("window.__desk.entities().filter((e) => e.selected).map((e) => e.type)");
  check(sel.length === 2 && sel.every((t) => t === "desk.note"), `shift-drag marquee selects the two notes (${sel.join(", ")})`);

  // --- 6. the wheel zooms about the pointer by exp(−Δ · 0.0016): the world point under it stays put. Chrome hands a CDP
  //     mouseWheel to the page DIVIDED by the emulated deviceScaleFactor (−120 → a DOM deltaY of −60 at dpr 2), so the law is
  //     witnessed against the delta the page received, which is what the engine's WheelPan carries.
  await q("window.__wheels = []; addEventListener('wheel', (e) => window.__wheels.push(e.deltaY), { capture: true, passive: true })");
  const cam0 = await q("window.__desk.camera()");
  const under0 = { x: cam0.x + 600 / cam0.zoom, y: cam0.y + 400 / cam0.zoom };
  await tab.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: 600, y: 400, deltaX: 0, deltaY: -120 });
  await sleep(250);
  const wheels = await q("window.__wheels");
  const dY = wheels.reduce((acc, v) => acc + v, 0);
  const cam1 = await q("window.__desk.camera()");
  const under1 = { x: cam1.x + 600 / cam1.zoom, y: cam1.y + 400 / cam1.zoom };
  check(wheels.length >= 1 && dY < 0 && near(cam1.zoom, cam0.zoom * Math.exp(-dY * 0.0016), 1e-4), `a wheel the page received as Δy ${dY} (CDP sent −120; Chrome divides by the dpr) zooms ×${(cam1.zoom / cam0.zoom).toFixed(4)} = exp(${(-dY * 0.0016).toFixed(4)})`);
  check(near(under1.x, under0.x, 1e-3) && near(under1.y, under0.y, 1e-3), `about the pointer: the world point under it stayed (${under1.x.toFixed(2)}, ${under1.y.toFixed(2)})`);

  // --- 7. a bare drag pans: the camera moves against the finger by Δ/zoom
  const cam2 = await q("window.__desk.camera()");
  await drag([100, 700], [150, 740], {}, 8);
  await sleep(200);
  const cam3 = await q("window.__desk.camera()");
  // against the finger by Δ/zoom, less the slop's samples (the same dead band as a move: the pan claims on the tick after 10 px)
  const dx = (cam3.x - cam2.x) * cam2.zoom;
  const dy = (cam3.y - cam2.y) * cam2.zoom;
  check(dx < 0 && dy < 0 && near(dx / dy, 50 / 40, 0.02) && -dx <= 50 && -dx >= 50 * 0.5, `a drag on the bare mat pans against the finger: ${(-dx).toFixed(1)} of 50 px by ${(-dy).toFixed(1)} of 40 (ratio ${(dx / dy).toFixed(3)}), i.e. (${(cam3.x - cam2.x).toFixed(2)}, ${(cam3.y - cam2.y).toFixed(2)}) world at zoom ${cam2.zoom.toFixed(3)}`);
  check(near(cam3.zoom, cam2.zoom), "a pan keeps the zoom");

  // --- 8. a click on the bare mat deselects
  await click(100, 700);
  await sleep(150);
  check((await q("window.__desk.selection()")).length === 0, "a click on the bare mat deselects");

  // ================================================================ D4a — the marks and the menu
  const marks = () => q("window.__desk.marks()");
  /** A click on the bare mat, clear of any tap window on either side: the selection is empty after it. */
  const deselect = async () => { await sleep(250); await click(100, 700); await settle(); await sleep(250); };
  const menuState = () => q(`(() => { const m = document.querySelector("[data-ice-selection-menu]"); if (!m) return null; const b = m.firstElementChild.getBoundingClientRect(); return { away: m.dataset.away, visible: m.dataset.visible, opacity: Number(getComputedStyle(m).opacity), bar: { x0: b.left, y0: b.top, x1: b.right, y1: b.bottom } }; })()`);
  await q("window.__desk.setCamera({ x: 0, y: 0, zoom: 1 })");
  await settle();
  const B0 = await entity(b);

  // --- 10. a selection wears BRACKETS — the marks pass's — and the note draws no ring of its own. The tap also puts the pen on the
  //     note (D2c): while it is being written the menu steps aside and the brackets stay; Escape puts the pen down, the menu returns
  await click(B0.cx, B0.cy);
  await settle();
  await sleep(200);
  const writing10 = await marks();
  const menuWriting = await menuState();
  check((await q("window.__desk.anchor()")).editing === true && (writing10?.objects ?? []).some((o) => o.style === "brackets" && o.alpha === 1) && menuWriting.away === "true", `while the note is being written the brackets stay on it and the menu steps aside (away ${menuWriting.away})`);
  await key("Escape", "Escape", 27);
  await settle();
  const m10 = await marks();
  const br = m10?.objects ?? [];
  check(br.length === 1 && br[0].style === "brackets" && br[0].t === 1 && br[0].alpha === 1, `the selected note wears brackets, locked on (${br.map((o) => `${o.style} t ${o.t} α ${o.alpha}`).join(", ")})`);
  check((await entity(b)).geometry.ring === 0 && m10.union === null, "and no ring: its kind is handed 0 (the kinds' own ring retired)");

  // --- 11. the menu: 10 px above the brackets, centred on them, in screen space (back 200 ms after the pen went down, 180 ms in)
  await sleep(500);
  const anchor11 = await q("window.__desk.anchor()");
  const menu11 = await menuState();
  const cx11 = (anchor11.box.x0 + anchor11.box.x1) / 2;
  check(menu11 !== null && menu11.visible === "true" && menu11.opacity === 1, `the selection menu shows (opacity ${menu11?.opacity})`);
  check(near(menu11.bar.y1, anchor11.box.y0 - 10, 1.01) && near((menu11.bar.x0 + menu11.bar.x1) / 2, cx11, 1.01), `it stands 10 px above the brackets, centred: its foot at ${menu11.bar.y1.toFixed(1)} vs ${(anchor11.box.y0 - 10).toFixed(1)}, its middle ${((menu11.bar.x0 + menu11.bar.x1) / 2).toFixed(1)} vs ${cx11.toFixed(1)}`);
  check(await q(`[...document.querySelectorAll("[data-ice-selection-menu] [data-act]")].map((b) => b.dataset.act).join() === "send,duplicate,tape,more,delete"`), "its acts: the app's Send first, then Duplicate · Tape · More, Delete last");

  // --- 12. a drag: the menu steps aside at once and returns 200 ms after the hand lets go (80 px straight up — a note let go
  //     overlapping the mini mat below (its top at y 320) would be CONSUMED into it, core's law)
  await mouse("mouseMoved", B0.cx, B0.cy); await mouse("mousePressed", B0.cx, B0.cy);
  for (let i = 1; i <= 5; i++) { await mouse("mouseMoved", B0.cx, B0.cy - 16 * i); await sleep(30); }
  await sleep(160);
  const during = await menuState();
  await mouse("mouseReleased", B0.cx, B0.cy - 80);
  await sleep(120);
  const justAfter = await menuState();
  await sleep(400);
  const back = await menuState();
  check(during.away === "true" && during.opacity < 0.05, `during the drag it stepped aside (away, opacity ${during.opacity.toFixed(2)})`);
  check(justAfter.away === "true" && back.away === "false" && back.opacity === 1, `back 200 ms after the release (120 ms after: away ${justAfter.away}; 520 ms after: opacity ${back.opacity})`);
  await key("z", "KeyZ", 90, META);
  await settle();

  // --- 13. a snap lights the laser: note B dragged up past note A's top edge — while held it snaps onto it and the guide shows
  // note A's id: ⌘Z brought it back in section 4 as a NEW entity (the undo respawns it), so it is looked up again
  const A13 = (await entities()).find((e) => e.type === "desk.note" && e.id !== b);
  const B13 = await entity(b);
  await deselect();
  await mouse("mouseMoved", B13.cx, B13.cy); await mouse("mousePressed", B13.cx, B13.cy);
  let lit = null;
  const trace13 = [];
  const reach = B13.y - A13.y;   // how far up B's top must go to meet A's
  for (let d = 0; d <= reach + 30; d += 2) {
    await mouse("mouseMoved", B13.cx, B13.cy - d);
    await sleep(60);
    const mk = await marks();
    const now = await entity(b);
    const guide = (mk?.guides ?? []).find((g) => g.axis === "y" && near(g.at, A13.y, 0.51));
    trace13.push(`${d}:${now.y}/${(mk?.guides ?? []).map((g) => g.at).join("+")}`);
    if (guide && near(now.y, A13.y, 1e-6)) { lit = { guide, y: now.y, strike: mk.strike }; break; }
  }
  await mouse("mouseReleased", B13.cx, B13.cy - reach);
  await settle();
  if (lit === null) console.log(`   (trace13) ${trace13.join(" ")}`);
  check(lit !== null, `a snap onto A's top edge lights the laser there (${lit ? `guide y ${lit.guide.at.toFixed(1)}, span ${lit.guide.span.map((v) => v.toFixed(0)).join("–")}, strike ${lit.strike.toFixed(2)}` : "no guide met while held"})`);
  check(lit !== null && lit.guide.span[0] < Math.min(A13.x, B13.x) && lit.guide.span[1] > Math.max(A13.x + A13.w, B13.x + B13.w), "bright over both notes and past them");
  check(((await marks())?.guides ?? []).length === 0, "let go, the laser is gone");
  await key("z", "KeyZ", 90, META);
  await settle();

  // --- 14. the vellum: drawn while the shift-drag runs, what it touches ticked, the count by the cursor — then it folds onto the union
  await deselect();
  await mouse("mouseMoved", 60, 40, { modifiers: SHIFT }); await mouse("mousePressed", 60, 40, { modifiers: SHIFT });
  for (let i = 1; i <= 10; i++) { await mouse("mouseMoved", 60 + 99 * i, 40 + 26 * i, { modifiers: SHIFT }); await sleep(25); }
  await sleep(120);
  const drawing = await marks();
  await mouse("mouseReleased", 1050, 300, { modifiers: SHIFT });
  await sleep(40);
  const folding = await marks();
  await settle();
  const gathered = await marks();
  check(drawing?.marquee !== null && drawing.marquee.count === 2 && drawing.objects.filter((o) => o.style === "member").length === 2, `mid-drag the vellum is drawn, touching two notes, their ticks shown and "${drawing?.marquee?.count}" by the cursor`);
  // the fold starts from the vellum as last DRAWN and eases onto the union: its first frames lie between the two, off the union
  const v = drawing?.marquee?.rect;
  const u0 = folding?.union?.box;
  const u1 = gathered?.union?.box;
  const between = (f, a0, a1) => f >= Math.min(a0, a1) - 1 && f <= Math.max(a0, a1) + 1;
  const vx0 = v ? Math.min(v.x0, v.x1) : 0;
  const vx1 = v ? Math.max(v.x0, v.x1) : 0;
  const folds = v !== undefined && u0 !== undefined && u1 !== undefined && between(u0.x0, vx0, u1.x0) && between(u0.x1, vx1, u1.x1) && Math.abs(u0.x0 - u1.x0) + Math.abs(u0.x1 - u1.x1) > 2;
  check(folds, `released, it folds: the union's first frame [${u0 ? `${u0.x0.toFixed(0)}, ${u0.x1.toFixed(0)}` : "–"}] lies between the vellum [${vx0.toFixed(0)}, ${vx1.toFixed(0)}] and the union it lands on [${u1 ? `${u1.x0.toFixed(0)}, ${u1.x1.toFixed(0)}` : "–"}]`);

  // --- 15. the tape: ⌘⇧L tapes B; a drag on it gives 2 px and it never moves; the vellum passes over it; ⌘⇧L lifts it
  await deselect();
  const B15 = await entity(b);
  await click(B15.cx, B15.cy);
  await settle();   // the tap's selection lands on the next tick: the key must find it
  await key("Escape", "Escape", 27);   // the tap put the pen on the note (D2c): put it down, or the keys are the editor's
  await settle();
  await key("L", "KeyL", 76, META | SHIFT);
  await sleep(100);   // the tape's transaction lands at the next sync — a settle before it would find the desk quiet too early
  await settle();
  const taped15 = (await marks())?.tape ?? [];
  check((await entity(b)).locked && taped15.length === 1 && taped15[0].press[0] === 1 && taped15[0].press[1] === 1, `⌘⇧L tapes the note: Locked, its tape pressed down (the layout lays it as two strips) — ${JSON.stringify(taped15.map((t) => t.press))}`);
  await mouse("mouseMoved", B15.cx, B15.cy); await mouse("mousePressed", B15.cx, B15.cy);
  const gives = [];
  for (let i = 1; i <= 8; i++) { await mouse("mouseMoved", B15.cx + 10 * i, B15.cy); gives.push((await entity(b)).geometry.centre[0] - B15.cx); await sleep(20); }
  await mouse("mouseReleased", B15.cx + 80, B15.cy);
  await settle();
  await sleep(200);
  const after15 = await entity(b);
  const peakGive = Math.max(...gives.map(Math.abs));
  check(near(after15.cx, B15.cx) && near(after15.cy, B15.cy) && after15.geometry.centre[0] === B15.cx, `it refuses the drag: its Position never moved (${after15.cx.toFixed(1)}, ${after15.cy.toFixed(1)})`);
  check(peakGive > 0.5 && peakGive <= 2.2 + 1e-9, `with a give: it shivered up to ${peakGive.toFixed(2)} px and settled (${gives.map((g) => g.toFixed(1)).join(" ")})`);
  await deselect();
  await drag([60, 40], [1050, 300], { modifiers: SHIFT }, 10);
  await sleep(200);
  const picked = await q("window.__desk.selection()");
  check(!picked.includes(b) && picked.includes(A13.id), `the vellum passes over the tape: it gathered A, not B (${picked.length} selected)`);
  await deselect();
  await click(B15.cx, B15.cy);
  await settle();
  await key("Escape", "Escape", 27);
  await settle();
  await key("L", "KeyL", 76, META | SHIFT);
  await sleep(100);   // the tape's transaction lands at the next sync — a settle before it would find the desk quiet too early
  await settle();
  const lifted = await entity(b);
  const tapeLeft = ((await marks())?.tape ?? []).length;
  check(!lifted.locked && tapeLeft === 0, `⌘⇧L lifts the tape (locked ${lifted.locked}, tape left ${tapeLeft}, selection ${JSON.stringify(await q("window.__desk.selection()"))} b ${b})`);
  await click(100, 700);

  // D2b's nesting rows run after D4a's: the drop-into below takes note B into the mini mat, and D4a's rows above hold B on
  // the root desk (each of them leaves it where it lay, untaped, the selection empty)
  // --- 8b. DROP-INTO (D2b, design-015 §9, MINIMAT.md §3): a note let go with its centre over the mini mat's FACE goes into its
  //     desk at the point where it lay, in the inside's own units — through the face's embedding M, so it takes the inside's scale.
  //     The note trails the pointer by the slop-eaten sample; the check reads the live centre just before the release. The camera
  //     is put back to (0, 0, 1) first — the wheel and the pan above moved it, and these drags are stated in screen = world.
  await q("window.__desk.setCamera({ x: 0, y: 0, zoom: 1 })");
  await settle();
  const M = (await q(`window.__desk.navFace(${m})`)).affine;
  await mouse("mouseMoved", 900, 250); await mouse("mousePressed", 900, 250);
  for (let i = 1; i <= 8; i++) { await mouse("mouseMoved", 900 - (300 * i) / 8, 250 + (310 * i) / 8); await sleep(16); }
  await sleep(40);
  const liveB = await entity(b);
  await mouse("mouseReleased", 600, 560);
  await settle();
  const dropped = await entity(b);
  check(dropped.parent === m && !dropped.active && (await q("window.__desk.stats().active")) === 2, `the note left the desk and lies inside the mini mat (parent = the mat, ${await q("window.__desk.stats().active")} root objects)`);
  check(near(dropped.cx, (liveB.cx - M.ox) / M.s, 1e-6) && near(dropped.cy, (liveB.cy - M.oy) / M.s, 1e-6) && dropped.w === 200, `where it was let go, in the inside's own units: (${dropped.cx.toFixed(1)}, ${dropped.cy.toFixed(1)}) = (n − M.o) / M.s at scale ${M.s.toFixed(3)}, its size kept`);
  // ⌥ held at the release keeps a note on this desk, over the face
  const c = await q("window.__desk.spawn('desk.note', { seed: 3 }, { x: 1000, y: 650 })");
  await settle();
  await drag([1000, 650], [600, 560], { modifiers: 1 }, 8);   // ⌥
  await settle();
  const kept = await entity(c);
  check(kept.parent !== m && kept.active && kept.cx > 312 && kept.cx < 888, `with ⌥ held the note stays on the desk, over the face (${kept.cx.toFixed(0)}, ${kept.cy.toFixed(0)})`);

  // --- 8c. `t` gives the selected mini mat the next vinyl (its inside is that vinyl too)
  await click(600, 336);   // the mat's top border: the frame part selects it
  await sleep(100);
  const t0 = (await entity(m)).props.vinyl;
  await key("t", "KeyT", 84); await sleep(100);
  const t1 = (await entity(m)).props.vinyl;
  await key("t", "KeyT", 84); await sleep(100);
  const t2 = (await entity(m)).props.vinyl;
  check((await entity(m)).selected && t0 === "sage" && t1 === "slate" && t2 === "charcoal", `t: ${t0} → ${t1} → ${t2}`);
  await click(100, 700);   // deselect

  // --- 8d. INSIDE an entered mini mat (D4a over D2b): a real double-click on the mat's face flies into it; a tap on the note inside
  //     (B, dropped in at 8b) selects it, and its BRACKETS stand where the ENTERED camera draws it — the marks are the root slot's,
  //     and once entered the root slot IS the mat's inside, its members under the entered camera; the menu's anchor goes with them.
  //     Then back out: Escape puts the pen down, a second leaves the frame.
  const dbl = async (x, y) => { for (const [type, clickCount] of [["mousePressed", 1], ["mouseReleased", 1], ["mousePressed", 2], ["mouseReleased", 2]]) { await tab.send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount }); await sleep(16); } };
  const land = async () => { for (let w = 0; w < 4000; w += 50) { await sleep(50); if (!(await q("window.__desk.flight()"))) return true; } return false; };
  await sleep(250);   // clear of the deselect's tap window
  await mouse("mouseMoved", 400, 700);
  await dbl(400, 700);   // the mat's face, clear of the note kept over it (8b) and of B's chip
  await sleep(40);
  const flight8 = await q("window.__desk.flight()");
  await land();
  await settle();
  // the entered camera off its 1:1 arrival by a real wheel (in, about a point off the note), so the witness sees its zoom too
  await tab.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: 500, y: 330, deltaX: 0, deltaY: -240 });
  await sleep(250);
  await settle();
  const camIn = await q("window.__desk.camera()");
  const Bin = await entity(b);
  await click((Bin.cx - camIn.x) * camIn.zoom, (Bin.cy - camIn.y) * camIn.zoom);
  await settle();
  const G8 = (await entity(b)).geometry;
  const z8 = camIn.zoom;
  const want8 = { cx: (G8.centre[0] - camIn.x) * z8, cy: (G8.centre[1] - camIn.y) * z8, hx: G8.half[0] * z8, hy: G8.half[1] * z8, angle: G8.angle };
  const got8 = (await marks())?.objects ?? [];
  const f8 = got8[0]?.frame;
  const a8 = (await q("window.__desk.anchor()")).box;
  const ex8 = want8.hx * Math.abs(Math.cos(want8.angle)) + want8.hy * Math.abs(Math.sin(want8.angle)) + 6;
  const ey8 = want8.hx * Math.abs(Math.sin(want8.angle)) + want8.hy * Math.abs(Math.cos(want8.angle)) + 6;
  const on8 = f8 !== undefined && near(f8.cx, want8.cx) && near(f8.cy, want8.cy) && near(f8.hx, want8.hx) && near(f8.hy, want8.hy) && near(f8.angle, want8.angle);
  const box8 = a8 !== null && near(a8.x0, want8.cx - ex8) && near(a8.y0, want8.cy - ey8) && near(a8.x1, want8.cx + ex8) && near(a8.y1, want8.cy + ey8);
  const depth8 = await q("window.__desk.depth()");
  check(flight8?.kind === "enter" && depth8 === 1 && (await entity(b)).selected && got8.length === 1 && got8[0].style === "brackets" && on8 && box8, `entered by a double-click (depth ${depth8}), the note inside wears its brackets where the entered camera draws it — (${f8?.cx.toFixed(1)}, ${f8?.cy.toFixed(1)}) ±(${f8?.hx.toFixed(1)}, ${f8?.hy.toFixed(1)}) turned ${f8?.angle.toFixed(4)}, its sheet's (${want8.cx.toFixed(1)}, ${want8.cy.toFixed(1)}) at zoom ${z8.toFixed(3)} — and the menu's anchor 6 px around them`);
  await key("Escape", "Escape", 27);   // the tap put the pen on the note (D2c): down
  await settle();
  await key("Escape", "Escape", 27);   // no gesture to cancel: Escape leaves the frame (D2b)
  await land();
  await settle();

  // --- 8e. a click whose release shares its frame with a FAR move (core, 2026-09-26): mousePressed, mouseReleased and a
  //     mouseMoved ~1000 px off go out back to back — sent without awaiting one another, no frame wait — so they fold into one
  //     or two engine ticks; then the shape it was found in: the press stepped alone (its recognizers are in flight), the release
  //     and the move together. Either way the click selects the note, nothing is captured, and the note stays put while the
  //     cursor wanders on. Before core's fold cut the release was judged at the MOVE's point: all in one tick, the click picked the
  //     bare mat and never selected; the release with the move, the drag went Active on the note and it followed the cursor (a
  //     ghost drag). The moves carry no button, as a hand's do. The note is the first one where 3 left it — looked up, as ⌘Z in 4
  //     brought it back as a new entity (B is inside the mat, C over its face). Each step waits on the WORLD, not a clock — no
  //     gesture in flight before the press, the press's recognizers live before the release (shape two), the wander's last point
  //     on the pointer before the checks — and the waits are a check of their own: on the old source a step EARLIER tripped the
  //     same defect (8c's click, then the far move to the note) and left a gesture in flight, which a timed row would misread.
  const inFlight = () => q("window.__desk.engine.engine.frame.settling().includes('gestures')");
  const until = async (fn) => { for (let i = 0; i < 400; i++) { if (await fn()) return true; await sleep(5); } return false; };
  const foldedClick = async (label, pressAlone) => {
    const n0 = (await entities()).find((e) => e.type === "desk.note" && e.active && e.id !== c);
    await mouse("mouseMoved", n0.cx, n0.cy, { button: "none" });
    const idle = await until(async () => !(await inFlight()));
    const press = mouse("mousePressed", n0.cx, n0.cy);
    let alone = true;
    if (pressAlone) { await press; alone = await until(inFlight); }
    await Promise.all([press, mouse("mouseReleased", n0.cx, n0.cy), mouse("mouseMoved", 1100, 700, { button: "none" })]);
    for (const [x, y] of [[1040, 730], [1150, 660], [980, 760]]) { await sleep(40); await mouse("mouseMoved", x, y, { button: "none" }); }
    const landed = await until(async () => { const p = await q("window.__desk.pointer()"); return p !== null && near(p.x, 980, 0.5) && near(p.y, 760, 0.5); });
    await sleep(100);
    const n1 = await entity(n0.id);
    const live = await inFlight();
    check(idle && alone && landed, `${label}: the shape held (idle before the press ${idle}${pressAlone ? `, the press stepped alone ${alone}` : ""}, the wander landed ${landed})`);
    check(n1.selected && (await q("window.__desk.selection()")).length === 1, `${label}: the click still selects the note (and only it)`);
    check(!n1.grabbed && !live && near(n1.cx, n0.cx) && near(n1.cy, n0.cy), `${label}: nothing is captured, the note stays put while the cursor wanders — (${n1.cx.toFixed(1)}, ${n1.cy.toFixed(1)}), grabbed ${n1.grabbed}, a gesture in flight ${live}`);
    await key("Escape", "Escape", 27);   // the tap put the pen on the note: put it down,
    await click(100, 700);               // and deselect, as 8c left the desk
  };
  await foldedClick("press, release and a far move back to back", false);
  await foldedClick("the press stepped alone, then the release and a far move together", true);

  // --- D3w: the whiteboard, the print, the notebook and the desk calendar at rest (interact-kinds.mjs) — after D2b's rows: 8d has
  //     flown back out to the root desk (the exit clears the selection), and each kind lays its object in a stretch of the desk
  //     of its own, far from the notes and the mini mat
  await kindsRig({ q, qa: (js) => tab.evaluate(js, { awaitPromise: true, timeoutMs: 30000 }), entity, entities, mouse, click, key, sleep, settle, check, near, META, SHIFT });

  // --- 9. quiet at the end: no spring, nothing dirty
  const s = await settle();
  check(s.settled === true, `the desk settles (${s.redraws} redraws so far)`);
  if (logs.length) console.log(`page errors:\n  ${logs.slice(0, 6).join("\n  ")}`);
  check(logs.length === 0, "no page errors");
  console.log(`\n${pass} passed, ${failN} failed`);
} catch (e) { console.log("THREW:", String(e.stack ?? e)); failN++; }
finally { await cleanup(); }
process.exit(failN ? 1 : 0);
