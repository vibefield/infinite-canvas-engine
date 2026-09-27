// rig:tray — THE PEGBOARD TRAY (design-017 §10; K3), on the product desk in headless Chrome (rig.html, 1200 × 800 at dpr 2 = the
// 2400 × 1600 the budget names). Open and close by `a`, by the lip, by Esc and by a click on the dimmed desk; the drawer's rect; the
// slide on its curve (sampled on the frame clock at t ≈ 0 · 170 · 340 ms, and the motion's wall time); a scroll of Δ moves the
// pattern by exactly Δ — the carry's uniforms and a screenshot shift-compare; exact 10⁶ rows down (the same carry fraction, the same
// holes); the wheel over the drawer scrolls it and never moves the camera; the desk inert while open; 0 submits at rest open and
// closed (240 frames each), one frame per frame of motion; the drawer's GPU cost at 2400 × 1600 (≤ 0.3 ms: a saturated batch of it
// alone, drained around, medians and minima of 7 rounds with the load beside them); the night; no page errors. Exit 0 = every row
// passed.
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { loadavg } from "node:os";
import { resolve } from "node:path";
import { faultsOf, launchChrome, openTab, watchPage } from "./cdp.mjs";
import { decodePng } from "./png.mjs";

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
const t0 = Date.now();
const server = spawn(process.execPath, [resolve(here, "server.mjs"), repo, "0"], { stdio: ["ignore", "pipe", "inherit"] });
const PORT = await new Promise((r) => server.stdout.once("data", (b) => r(Number(String(b).match(/PORT (\d+)/)[1]))));
const chrome = await launchChrome({ port: await freePort(9611), headless: !process.env.DESK_HEADED });
let done = false;
async function cleanup() { if (done) return; done = true; try { await chrome.close(); } catch {} try { server.kill("SIGKILL"); } catch {} }
setTimeout(async () => { console.log("WATCHDOG"); await cleanup(); process.exit(2); }, 180_000).unref();
let pass = 0;
let failN = 0;
const check = (ok, msg) => { console.log(`  ${ok ? "PASS" : "FAIL"}  ${msg}`); ok ? pass++ : failN++; };

// the curve (cubic-bezier(0.32,0.72,0,1)) — the kernel's, restated for the witness: x(u) solved by bisection, y(u) read
const bez = (a, b, u) => 3 * (1 - u) * (1 - u) * u * a + 3 * (1 - u) * u * u * b + u * u * u;
const ease = (t) => { if (t <= 0) return 0; if (t >= 1) return 1; let lo = 0;
let hi = 1; for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (bez(0.32, 0, m) < t) lo = m; else hi = m; } return bez(0.72, 1, (lo + hi) / 2); };

try {
  const tab = await openTab(chrome.port, `http://127.0.0.1:${PORT}/apps/desk/dist/rig.html`);
  const logs = [];
  await tab.send("Runtime.enable"); await tab.send("Log.enable"); await tab.send("Page.enable");
  watchPage(tab, logs);
  await tab.send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 800, deviceScaleFactor: 2, mobile: false });
  for (let i = 0; i < 200; i++) { await tab.send("Page.bringToFront"); if (await tab.evaluate("typeof window.__desk === 'object' && window.__desk.state.ready", { timeoutMs: 20000 })) break; await sleep(200); }
  const front = () => tab.send("Page.bringToFront");
  const q = async (js) => { await front(); return tab.evaluate(js, { timeoutMs: 20000 }); };
  const qa = async (js, ms = 30000) => { await front(); return tab.evaluate(js, { awaitPromise: true, timeoutMs: ms }); };
  const mouse = (type, x, y, extra = {}) => tab.send("Input.dispatchMouseEvent", { type, x, y, button: type === "mouseMoved" || type === "mouseWheel" ? "none" : "left", clickCount: 1, ...extra });
  const click = async (x, y) => { await mouse("mouseMoved", x, y); await mouse("mousePressed", x, y, { buttons: 1 }); await sleep(30); await mouse("mouseReleased", x, y); };
  const key = async (k, code, vk) => { await front(); await tab.send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, windowsVirtualKeyCode: vk, text: k.length === 1 ? k : undefined }); await tab.send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: vk }); };
  const settle = () => qa("window.__desk.settle(4000)");
  const shot = async () => { await front(); const { data } = await tab.send("Page.captureScreenshot", { format: "png" }); return decodePng(Buffer.from(data, "base64")); };
  const idle = (n = 240) => qa(`(async () => { await window.__desk.settle(4000); const b = window.__desk.submits().total; await new Promise((r) => { let i = 0; const f = () => { if (++i >= ${n}) r(); else requestAnimationFrame(f); }; requestAnimationFrame(f); }); return window.__desk.submits().total - b; })()`);
  const tray = () => q("({ ...window.__desk.tray.state(), facts: window.__desk.tray.facts() })");
  const lum = (img, x, y) => { const i = (y * img.width + x) * 4; return 0.2126 * img.rgba[i] + 0.7152 * img.rgba[i + 1] + 0.0722 * img.rgba[i + 2]; };

  // a still desk (no wind frames), a note on it and one under where the drawer comes
  await q("window.__desk.ambient('still'); window.__desk.setTheme('light')");
  const note = await q("window.__desk.spawn('desk.note', { seed: 7 }, { x: 300, y: 250 })");
  await q("window.__desk.spawn('desk.note', { seed: 11 }, { x: 600, y: 640 })");
  await settle();
  const cam0 = await q("window.__desk.camera()");

  // 1. CLOSED: the lip at the bottom, the whole drawer's width; nothing moves at rest
  let s = await tray();
  check(s.facts !== null && s.facts.open === false && s.frame?.p === 0 && s.frame.x === 40 && s.frame.w === 1120 && s.frame.y === 788 && s.laid?.dim === 0,
    `closed: the lip — rect x ${s.frame?.x} y ${s.frame?.y} w ${s.frame?.w} (40 · 788 · 1120), no dim (${s.laid?.dim})`);
  const restClosed = await idle();
  check(restClosed === 0, `closed at rest: ${restClosed} submits over 240 frames`);
  // the lip lifts under the mouse (and not beside it), and settles back when it leaves
  await mouse("mouseMoved", 600, 795); await settle();
  const lifted = await tray();
  await mouse("mouseMoved", 600, 400); await settle();
  const fell = await tray();
  check(lifted.facts.lip === true && lifted.frame.y === 782 && fell.facts.lip === false && fell.frame.y === 788,
    `hovered, the lip lifts to ${800 - lifted.frame.y} px (18) and falls back to ${800 - fell.frame.y} (12) when the mouse leaves`);

  // 2. `a` opens it, on the curve — sampled on the frame clock; the motion's wall time
  const lit0 = await shot();
  const sub0 = await q("window.__desk.submits().total");
  const trace = await qa("window.__desk.tray.trace(420)");   // toggles: opens
  const near = (t) => trace.reduce((a, b) => (Math.abs(b.t - t) < Math.abs(a.t - t) ? b : a));
  const rows = [0, 170, 340].map((t) => { const o = near(t); return { t: o.t, p: o.p, want: ease(o.t / 340) }; });
  const worst = Math.max(...trace.map((o) => Math.abs(o.p - ease(o.t / 340))));
  const reached = trace.find((o) => o.p === 1);
  check(rows.every((r) => Math.abs(r.p - r.want) < 1e-6) && worst < 1e-6 && rows[0].p === 0,
    `the slide on cubic-bezier(0.32,0.72,0,1): ${rows.map((r) => `p(${r.t.toFixed(0)} ms) ${r.p.toFixed(4)}`).join(" · ")} — every one of ${trace.length} frames on the curve (worst ${worst.toExponential(1)})`);
  check(reached !== undefined && reached.t >= 340 && reached.t < 340 + 40 && trace.filter((o) => o.t < 323).every((o) => o.p < 1),
    `it arrives at 340 ms and not before (first p = 1 at t ${reached?.t.toFixed(1)} ms of the frame clock, ${reached?.wall.toFixed(0)} ms of wall time after the toggle)`);
  await settle();
  const slid = (await q("window.__desk.submits().total")) - sub0;
  const moving = trace.filter((o) => o.p < 1).length;
  check(slid >= moving && slid <= moving + 2, `one frame per frame of motion: ${slid} submits for the slide's ${moving} frames in motion (+ its last), then asleep`);
  s = await tray();
  check(s.facts.open === true && s.frame.p === 1 && s.frame.y === 448 && s.frame.h === 352 && s.frame.w === 1120 && Math.abs(s.laid.dim - 0.1) < 1e-9,
    `open: rect y ${s.frame.y} h ${s.frame.h} (448 · 352, ≈ 44 % of 800), the dim at ${s.laid?.dim} by day`);
  const restOpen = await idle();
  check(restOpen === 0, `open at rest: ${restOpen} submits over 240 frames`);

  // 3. what it draws: the face's colour, the holes' share of the board, the dimmed desk above it
  const lit1 = await shot();
  const inside = []; for (let y = 1000; y < 1560; y += 3) for (let x = 180; x < 2220; x += 3) inside.push(y * lit1.width + x);
  const dark = inside.filter((i) => lum(lit1, i % lit1.width, Math.floor(i / lit1.width)) < 110).length / inside.length;
  const faceL = inside.map((i) => lum(lit1, i % lit1.width, Math.floor(i / lit1.width))).sort((a, b) => a - b)[Math.floor(inside.length * 0.6)];
  check(dark > 0.12 && dark < 0.19 && faceL > 165 && faceL < 200, `the board: holes darken ${(dark * 100).toFixed(1)} % of it (the stadium's 15.7 % of a cell), the face's luminance ${faceL.toFixed(0)} (≈ #cdb491's 182)`);
  const deskBefore = lum(lit0, 1200, 200);
  const deskAfter = lum(lit1, 1200, 200);
  check(Math.abs(deskAfter / deskBefore - 0.9) < 0.03, `the desk dims 10 % by day: luminance ${deskBefore.toFixed(1)} → ${deskAfter.toFixed(1)} (× ${(deskAfter / deskBefore).toFixed(3)})`);

  // 4. a scroll of Δ moves the pattern by exactly Δ: the carry's uniforms, and the pixels shifted by Δ·dpr
  const S0 = 13;
  const D = 17;
  await q(`window.__desk.tray.scroll(${S0})`); await settle();
  const A = await shot(); const la = (await tray()).laid;
  await q(`window.__desk.tray.scroll(${S0 + D})`); await settle();
  const B = await shot(); const lb = (await tray()).laid;
  check(la.rowBase === 0 && Math.abs(la.frac - S0 / 40) < 1e-12 && lb.rowBase === 0 && Math.abs(lb.frac - (S0 + D) / 40) < 1e-12,
    `the carry's uniforms: rowBase ${la.rowBase} frac ${la.frac} → rowBase ${lb.rowBase} frac ${lb.frac} (Δ ${D} px = ${D / 40} of a row)`);
  let maxd = 0;
  let moved = 0;
  let sum = 0;
  let n = 0;
  for (let y = 940; y < 1560 - 2 * D; y += 1) for (let x = 140; x < 2260; x += 2) { const d = Math.abs(lum(B, x, y) - lum(A, x, y + 2 * D)); maxd = Math.max(maxd, d); sum += d; n++; if (d > 0) moved++; }
  // the same board point is reached by two float paths (its rows on screen plus a different fraction of one): exact, but for an f32's
  // rounding across a quantisation step — at most one step, on a vanishing share of the pixels
  check(maxd <= 1 && moved / n < 1e-3, `the board ${D} px on is the same pixels ${2 * D} device px up: ${moved} of ${n.toLocaleString()} px differ (max |Δ| ${maxd.toFixed(2)} — an f32's rounding, ≤ 1 step), mean ${(sum / n).toFixed(4)}`);

  // 5. exact 10⁶ rows down: the same fraction of a row, the same holes where they were (an even carry keeps the stagger)
  await q(`window.__desk.tray.scroll(${1e6 * 40 + S0})`); await settle();
  const C = await shot(); const lc = (await tray()).laid;
  // a pixel CLEARLY hole in one and clearly face in the other is a hole moved (the face's tone drift is other rows' there, so an
  // anti-aliased edge may sit either side of one threshold — never across both)
  let holes = 0;
  let crossed = 0;
  for (let y = 940; y < 1560; y += 2) for (let x = 140; x < 2260; x += 2) {
    const a = lum(A, x, y);
    const c = lum(C, x, y);
    if (a < 95) holes++;
    if ((a < 95 && c > 140) || (c < 95 && a > 140)) crossed++;
  }
  check(lc.rowBase === 1e6 && Math.abs(lc.frac - S0 / 40) < 1e-9 && holes > 10000 && crossed === 0,
    `10⁶ rows down: rowBase ${lc.rowBase} frac ${lc.frac.toFixed(6)}; of ${holes.toLocaleString()} hole px at the top, ${crossed} are face down there (or the reverse)`);
  await q("window.__desk.tray.scroll(0)"); await settle();

  // 6. the wheel over the drawer scrolls it and never moves the camera; ⌘-wheel there and a wheel on the dimmed desk do nothing
  await mouse("mouseMoved", 600, 650);
  await settle();
  const w0 = (await tray()).facts.scroll;
  const ws0 = await q("window.__desk.submits().total");
  for (let i = 0; i < 3; i++) { await mouse("mouseWheel", 600, 650, { deltaX: 0, deltaY: 120 }); await sleep(30); }
  await settle();
  const w1 = (await tray()).facts.scroll;
  const wheeled = (await q("window.__desk.submits().total")) - ws0;
  check(wheeled >= 1 && wheeled <= 3, `a scroll costs a frame per wheel tick: ${wheeled} submits for 3 wheel events, then asleep`);
  await mouse("mouseWheel", 600, 650, { deltaX: 0, deltaY: 120, modifiers: 4 });   // ⌘
  await mouse("mouseWheel", 600, 200, { deltaX: 0, deltaY: 120 });                 // the dimmed desk
  await sleep(200);
  const w2 = (await tray()).facts.scroll;
  const cam1 = await q("window.__desk.camera()");
  check(w1 > w0 && w2 === w1 && cam1.x === cam0.x && cam1.y === cam0.y && cam1.zoom === cam0.zoom,
    `the wheel over the drawer scrolled it ${w0} → ${w1} px; ⌘-wheel there and a wheel on the desk: ${w2}; the camera ${JSON.stringify(cam1)} unmoved`);
  await q("window.__desk.tray.scroll(0)");

  // 7. the desk inert while open: a drag on the note moves nothing and selects nothing; the drawer stays
  const p0 = await q(`window.__desk.entity(${note})`);
  await mouse("mouseMoved", 300, 250); await mouse("mousePressed", 300, 250, { buttons: 1 });
  for (let i = 1; i <= 8; i++) { await mouse("mouseMoved", 300 + i * 12, 250 + i * 5, { buttons: 1 }); await sleep(16); }
  await mouse("mouseReleased", 396, 290); await sleep(150);
  const p1 = await q(`window.__desk.entity(${note})`);
  const sel = await q("window.__desk.selection()");
  check(p1.x === p0.x && p1.y === p0.y && sel.length === 0 && (await tray()).facts.open === true, `inert: a drag on the note moved it (${p0.x},${p0.y}) → (${p1.x},${p1.y}), selected ${sel.length}, the drawer still open`);

  // 8. a click on the dimmed desk closes it (selecting nothing); the lip's click opens it; Esc closes it; `a` again
  await click(300, 250); await sleep(150);
  s = await tray();
  check(s.facts.open === false && (await q("window.__desk.selection()")).length === 0, "a click on the dimmed desk closed it, and selected nothing under it");
  await settle();
  await click(600, 794); await sleep(150);
  check((await tray()).facts.open === true, "a click on the lip opened it");
  await settle();
  await key("Escape", "Escape", 27); await sleep(150);
  check((await tray()).facts.open === false, "Esc closed it");
  await settle();
  await key("a", "KeyA", 65); await sleep(150);
  check((await tray()).facts.open === true, "`a` opened it");
  await settle();

  // 9. THE COST (design-017 §6.7): the drawer open at 2400 × 1600 — n of it alone per batch, and whole frames with it open and closed,
  //    each batch drained around; medians and minima of 7 rounds, the host's load beside them
  const rounds = [];
  for (let i = 0; i < 7; i++) rounds.push(await qa("window.__desk.tray.cost(60)", 90000));
  const med = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  const alone = rounds.map((r) => r.alone.ms);
  const whole = rounds.map((r) => r.open.ms);
  const bare = rounds.map((r) => r.closed.ms);
  const load = loadavg().map((v) => v.toFixed(1)).join(" ");
  check(med(alone) <= 0.3, `the drawer's GPU cost at 2400 × 1600, open: alone median ${med(alone).toFixed(3)} ms, min ${Math.min(...alone).toFixed(3)} (≤ 0.3); whole frames open ${med(whole).toFixed(3)} vs closed ${med(bare).toFixed(3)} ms (Δ ${(med(whole) - med(bare)).toFixed(3)}) · load ${load}`);
  await settle();

  // 10. the night: the Moon on the board, the desk dimmed 40 %
  await q("window.__desk.setTheme('dark')"); await settle();
  const night = await shot(); const ln = (await tray()).laid;
  const nightFace = inside.map((i) => lum(night, i % night.width, Math.floor(i / night.width))).sort((a, b) => a - b)[Math.floor(inside.length * 0.6)];
  check(Math.abs(ln.dim - 0.4) < 1e-9 && nightFace < faceL * 0.8 && nightFace > 40, `by night: the dim ${ln.dim}, the face's luminance ${faceL.toFixed(0)} → ${nightFace.toFixed(0)} under the Moon`);
  const restNight = await idle(120);
  check(restNight === 0, `open by night at rest: ${restNight} submits over 120 frames`);
  await q("window.__desk.setTheme('light')");
  await key("a", "KeyA", 65); await settle();

  logs.push(...(await faultsOf(tab)));
  if (logs.length) console.log(`page errors:\n  ${logs.slice(0, 6).join("\n  ")}`);
  check(logs.length === 0, "no page errors");
  console.log(`\n${pass} passed, ${failN} failed · ${((Date.now() - t0) / 1000).toFixed(1)} s`);
} catch (e) { console.log("THREW:", String(e.stack ?? e)); failN++; }
finally { await cleanup(); }
process.exit(failN ? 1 : 0);
