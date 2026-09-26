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
// deselects. Exit 0 = every check passed.
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { launchChrome, openTab } from "./cdp.mjs";

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

  // --- 9. quiet at the end: no spring, nothing dirty
  const s = await settle();
  check(s.settled === true, `the desk settles (${s.redraws} redraws so far)`);
  if (logs.length) console.log(`page errors:\n  ${logs.slice(0, 6).join("\n  ")}`);
  check(logs.length === 0, "no page errors");
  console.log(`\n${pass} passed, ${failN} failed`);
} catch (e) { console.log("THREW:", String(e.stack ?? e)); failN++; }
finally { await cleanup(); }
process.exit(failN ? 1 : 0);
