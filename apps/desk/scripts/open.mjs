// rig:open — THE OPENING (design-015 §8; D4b): *Marks on the Mat* v2's interaction pass (its page's `open.mjs`) re-aimed at
// apps/desk through a real Chrome. Page-level synthetic pointer and key events (CDP Input.* — nothing reaches the OS) on a desk
// of a notebook and a note spawned through `window.__desk`; the checks read the WORLD and the layer's hand. A double-click picks
// the notebook up: `Held`, the carry rising to 1 within the design's 560 ms + the cover, the frame the pose seam publishes AT the
// reading pose (the spread fits 1088 × 672: the height binds), the selection menu at the foot as the held bar (Send · four slots ·
// Done); the CAMERA IS IDENTICAL before and after every open/put-down (the ruling "no camera move", witnessed); idle-zero while held
// and still (no submit in 600 ms); the desk copy made once and standing through a held zoom; ⌘-wheel zooms the OBJECT about the
// pointer by exp(−Δ · 0.0105), a plain wheel and a middle-button drag pan it once brought close, and the camera never hears any of
// it; the desk behind is inert (a drag from the note moves nothing); EVERY WAY BACK — Esc, the bar's Done, a click on the soft desk,
// ⌘-wheel in past 0.72× (and the rest of that gesture MUTED: the desk's camera stands through its tail, a control past the mute),
// two taps on the object; the keyboard: Tab to the notebook, ⏎ opens, Esc lands it with the selection back; and THE COST (design-015
// §11.4): frames drawn back to back — a copy remade each frame, the hand alone over the standing copy, the rest frame — ms each.
// Exit 0 = every check passed; 1 = a check or a throw; 2 = the watchdog.
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
const chrome = await launchChrome({ port: await freePort(9611), headless: !process.env.DESK_HEADED });
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
  const click = async (x, y) => { await mouse("mouseMoved", x, y); await mouse("mousePressed", x, y); await sleep(30); await mouse("mouseReleased", x, y); };
  /** Two instant taps within the window — the desk's double-click (D-D2b.1). */
  const dbl = async (x, y) => { await mouse("mouseMoved", x, y); for (const [type, clickCount] of [["mousePressed", 1], ["mouseReleased", 1], ["mousePressed", 2], ["mouseReleased", 2]]) { await tab.send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount }); await sleep(16); } };
  const key = async (k, code, vk, modifiers = 0) => { await tab.send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, windowsVirtualKeyCode: vk, modifiers }); await tab.send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: vk, modifiers }); };
  /** A wheel as the PAGE receives it: Chrome hands a CDP mouseWheel to the page DIVIDED by the emulated dpr (interact.mjs §6), so the deltas are sent doubled. */
  const wheel = async (x, y, dy, modifiers = 0, dx = 0) => { await tab.send("Input.dispatchMouseEvent", { type: "mouseWheel", x, y, deltaX: dx * 2, deltaY: dy * 2, modifiers }); await sleep(20); };
  const drag = async (from, to, steps = 6) => {
    await mouse("mouseMoved", from[0], from[1]); await mouse("mousePressed", from[0], from[1]);
    for (let i = 1; i <= steps; i++) { await mouse("mouseMoved", from[0] + ((to[0] - from[0]) * i) / steps, from[1] + ((to[1] - from[1]) * i) / steps, { buttons: 1 }); await sleep(16); }
    await sleep(40);
    await mouse("mouseReleased", to[0], to[1]);
  };
  const META = 4;
  const hand = () => q("window.__desk.hand()");
  const cam = () => q("window.__desk.camera()");
  const same = (a, b) => a.x === b.x && a.y === b.y && a.zoom === b.zoom;
  /** Wait for a truth, bounded. */
  const until = async (pred, ms = 2000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await pred()) return true; await sleep(25); } return false; };
  const held = () => until(async () => (await hand()) !== null, 1000);
  const settledInHand = () => until(async () => { const h = await hand(); return h?.settled === true && h.e === 1; }, 1500);
  const landed = () => until(async () => (await hand()) === null, 2500);

  // the desk: a notebook (its case centred at (300, 200) — screen = world at zoom 1, camera (0, 0)) and a note off to the lower right, a still mat
  await q("window.__desk.setCamera({ x: 0, y: 0, zoom: 1 }); window.__desk.ambient('still')");
  const book = await q("window.__desk.spawn('desk.notebook', { seed: 3, angle: 0.08 }, { x: 300, y: 200 })");
  const note = await q("window.__desk.spawn('desk.note', { seed: 7 }, { x: 1120, y: 700 })");
  await settle();
  const cam0 = await cam();
  const notePos = await q(`(() => { const e = window.__desk.entity(${note}); return { x: e.x, y: e.y }; })()`);

  // ---- 1. the double-click picks it up; no camera move; the frame is the reading pose; the bar goes to the foot
  const t0 = Date.now();
  await dbl(300, 200);
  check(await held(), "a double-click on the notebook picks it up (Held; the hand's frame published)");
  const okSettle = await settledInHand();
  const dt = Date.now() - t0;
  check(okSettle && dt < 1400, `the pickup settles at e = 1 in ${dt} ms (the design's 560 ms flight; the cover follows)`);
  const h1 = await hand();
  check(same(await cam(), cam0), `the camera is IDENTICAL after the pickup (${cam0.x}, ${cam0.y}, ×${cam0.zoom})`);
  // the reading size: the spread (360 × 252) fits 1088 × 672 — the height binds: s = 672 / 252, centred at (600, 56 + 336)
  check(h1 !== null && near(h1.frame.cx, 600) && near(h1.frame.cy, 392) && near(h1.frame.s, 672 / 252), `the frame on screen is the reading pose: centre (${h1?.frame.cx.toFixed(1)}, ${h1?.frame.cy.toFixed(1)}), ${h1?.frame.s.toFixed(4)} px/unit, hx ${h1?.frame.hx.toFixed(1)}`);
  await sleep(400);   // the bar's travel (340 ms)
  const bar = await q("(() => { const el = document.querySelector('[data-ice-selection-menu]'); if (!el) return null; const r = el.getBoundingClientRect(); return { held: el.dataset.held, done: !!el.querySelector('[data-act=\"done\"]'), tools: [...el.querySelectorAll('[data-tool]')].map((b) => b.dataset.tool), top: r.top, bottom: r.bottom, label: el.getAttribute('aria-label') }; })()");
  check(bar !== null && bar.held === "true" && bar.done && bar.tools.length === 4 && bar.top > 720 && bar.bottom <= 800, `the selection menu became the held bar at the foot (y ${bar?.top.toFixed(0)}–${bar?.bottom.toFixed(0)}; ${bar?.tools.join(" · ")}; Done; "${bar?.label}")`);

  // ---- 2. idle-zero in hand; the desk copy made once
  await settle();
  const copies0 = await q("window.__desk.holdCopies()");
  const n0 = await q("window.__desk.submits().total");
  await sleep(600);
  const n1 = await q("window.__desk.submits().total");
  check(n1 === n0, `idle-zero while held and still: ${n1 - n0} submits in 600 ms`);
  check(copies0 >= 1, `the desk copy behind the hand: ${copies0} made for the pickup (once when it settled, plus the flight's frames the pointer disturbed)`);

  // ---- 3. the wheel is the held object's, never the camera's; the copy stands
  await wheel(700, 400, -60, META);
  await settle();
  const v1 = await q(`window.__desk.heldView(${book})`);
  // about the pointer: pan' = (p − C)(1 − r) with C the reading pose's centre (600, 392) and p (700, 400)
  const r1 = Math.exp(60 * 0.0105);
  check(v1 !== null && near(v1.zoom, r1, 1e-9) && near(v1.panX, 100 * (1 - r1), 1e-6) && near(v1.panY, 8 * (1 - r1), 1e-6), `⌘-wheel brings it closer about the pointer: zoom ${v1?.zoom.toFixed(4)} = exp(60 · 0.0105), pan (${v1?.panX.toFixed(1)}, ${v1?.panY.toFixed(1)}) = (p − C)(1 − r)`);
  check(same(await cam(), cam0), "…and the camera never heard it");
  const copies1 = await q("window.__desk.holdCopies()");
  check(copies1 === copies0, `the desk copy stands through the held zoom (${copies1} made)`);
  await wheel(700, 400, 30, 0, 20);
  await settle();
  const v2 = await q(`window.__desk.heldView(${book})`);
  check(v2 !== null && near(v2.panX, v1.panX - 20, 1e-6) && near(v2.panY, v1.panY - 30, 1e-6), `brought close, a plain wheel pans it (${v2?.panX.toFixed(1)}, ${v2?.panY.toFixed(1)})`);
  await tab.send("Input.dispatchMouseEvent", { type: "mousePressed", x: 600, y: 400, button: "middle", buttons: 4, clickCount: 1 });
  for (let i = 1; i <= 5; i++) { await tab.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 600 + i * 8, y: 400 + i * 4, button: "middle", buttons: 4 }); await sleep(16); }
  await sleep(30);
  await tab.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: 640, y: 420, button: "middle", buttons: 0, clickCount: 1 });
  await settle();
  const v3 = await q(`window.__desk.heldView(${book})`);
  check(v3 !== null && near(v3.panX, v2.panX + 40, 1e-6) && near(v3.panY, v2.panY + 20, 1e-6), `a middle-button drag pans it too (${v3?.panX.toFixed(1)}, ${v3?.panY.toFixed(1)})`);
  check(same(await cam(), cam0) && (await hand()) !== null, "…the camera still stands, the object still in hand");

  // ---- 4. Esc puts it down: it flies home and lands; the camera identical; still selected
  await key("Escape", "Escape", 27);
  check(await until(async () => { const h = await hand(); return h === null || h.landing; }, 600), "Esc: the object lets go and flies home");
  check(await landed(), "…and lands: nothing in hand");
  check(same(await cam(), cam0), "the camera is IDENTICAL after the put-down");
  const sel1 = await q("window.__desk.selection()");
  check(sel1.length === 1 && sel1[0] === book, "it stays selected (↩ opens it again)");
  await settle();
  await sleep(300);

  // ---- 5. ⏎ picks the selected notebook up; the desk behind is inert; a click on the soft desk puts it down
  await key("Enter", "Enter", 13);
  check(await settledInHand(), "↩ with the notebook selected picks it up again");
  await drag([1120, 700], [1000, 600]);   // from the note — outside the held frame: a drag on the soft desk at the reading size
  await settle();
  const noteAfter = await q(`(() => { const e = window.__desk.entity(${note}); return { x: e.x, y: e.y, selected: e.selected }; })()`);
  check(noteAfter.x === notePos.x && noteAfter.y === notePos.y && !noteAfter.selected && (await hand()) !== null, "the desk behind is inert: a drag from the note moves nothing, selects nothing, and (moved) is not a click");
  await wheel(1100, 700, -80);
  await settle();
  check(same(await cam(), cam0) && near((await q(`window.__desk.heldView(${book})`)).zoom, 1, 1e-9), "a plain wheel at the reading size is nobody's: neither the camera nor the held zoom moved");
  await click(1120, 760);
  check(await landed(), "a click on the soft desk puts it down");
  check(same(await cam(), cam0), "…the camera still identical");
  await settle();

  // ---- 6. the bar's Done puts it down
  await dbl(300, 200);
  check(await settledInHand(), "picked up again (double-click)");
  await sleep(400);
  await q("document.querySelector('[data-act=\"done\"]').click()");
  check(await landed(), "the held bar's Done puts it down");
  await settle();

  // ---- 7. ⌘-wheel in past 0.72× puts it down — and the rest of that gesture is MUTED
  await dbl(300, 200);
  check(await settledInHand(), "picked up again");
  // one gesture: the event that crosses the floor and its tail, 20 ms apart (a real wheel's cadence) — the tail lands inside the 400 ms mute
  await wheel(600, 400, 40, META);   // exp(−0.42) = 0.657 < 0.72
  for (let i = 0; i < 6; i++) await wheel(600, 400, 40, META);
  check(await landed(), "⌘-wheel in past 0.72× puts it down");
  await settle();
  check(same(await cam(), cam0), "…and the gesture's tail never zooms the desk (muted)");
  await sleep(500);
  await wheel(600, 400, 40);
  await settle();
  const camMoved = !same(await cam(), cam0);
  check(camMoved, "…past the mute a wheel is the desk's again (the control)");
  await q(`window.__desk.setCamera(${JSON.stringify(cam0)})`);
  await settle();

  // ---- 8. two taps on the object put it down (the notebook's case rule, generalised)
  await dbl(300, 200);
  check(await settledInHand(), "picked up again");
  await dbl(600, 392);
  check(await landed(), "two taps on the held object put it down");
  await settle();

  // ---- 9. the keyboard: Tab to the notebook, ⏎ opens, Esc lands it with the selection back
  await click(60, 760);   // the bare desk: nothing selected
  await settle();
  check((await q("window.__desk.selection()")).length === 0, "a click on the bare desk clears the selection");
  await key("Tab", "Tab", 9);
  const selTab = await q("window.__desk.selection()");
  check(selTab.length === 1 && selTab[0] === book, "Tab selects the first object in reading order: the notebook");
  await key("Enter", "Enter", 13);
  check(await settledInHand(), "⏎ picks it up");
  await key("Escape", "Escape", 27);
  check(await landed(), "Esc lands it");
  const selBack = await q("window.__desk.selection()");
  check(selBack.length === 1 && selBack[0] === book && same(await cam(), cam0), "…with the selection back on it and the camera identical");
  await settle();

  // ---- 10. the cost (design-015 §11.4): frames back to back — a copy remade each, the hand alone, the rest frame
  await dbl(300, 200);
  check(await settledInHand(), "picked up for the cost");
  await sleep(400);
  const cost = await tab.evaluate("window.__desk.holdCost(40)", { awaitPromise: true, timeoutMs: 60000 });
  const copyMs = cost.copy.ms; const handMs = cost.hand.ms; const restMs = cost.rest.ms;
  console.log(`  cost (ms/frame, 40 back to back, GPU drained): the copy remade each frame ${copyMs.toFixed(2)} (cpu ${(cost.copy.cpu * 1000).toFixed(0)} µs) · the hand alone ${handMs.toFixed(2)} (cpu ${(cost.hand.cpu * 1000).toFixed(0)} µs) · the rest frame ${restMs.toFixed(2)} (cpu ${(cost.rest.cpu * 1000).toFixed(0)} µs)`);
  check(copyMs - handMs <= 1.5, `the desk copy + its blur costs ${(copyMs - handMs).toFixed(2)} ms over the hand alone (design-015 §11.4: ≤ 1.5 ms, once per settled desk; 0 per held frame when still — the idle-zero above)`);
  console.log(`  note: a held frame is the OPEN spread at ${(672 / 252).toFixed(2)}× plus the hand's two composites — ${(handMs / restMs).toFixed(1)}× the rest frame's closed book at 1×; the object's own cost at its reading size, not the hand's overhead (the copy's is the number above)`);
  await key("Escape", "Escape", 27);
  await landed();

  if (logs.length) console.log(`  page log:\n  ${logs.slice(0, 8).join("\n  ")}`);
  check(logs.length === 0, `no page exceptions or errors (${logs.length})`);
} catch (e) {
  console.log(`THROW ${e?.stack ?? e}`);
  failN += 1;
} finally {
  await cleanup();
}
console.log(`\nrig:open — ${pass} passed, ${failN} failed`);
process.exit(failN > 0 ? 1 : 0);
