// rig:tray — THE PEGBOARD TRAY (design-017 §10; K3), on the product desk in headless Chrome (rig.html, 1200 × 800 at dpr 2 = the
// 2400 × 1600 the budget names). Open and close by `a`, by Esc and by a click on the dimmed desk (the lip retired — design-018 §5); the drawer's rect; the
// slide on its curve (sampled on the frame clock at t ≈ 0 · 170 · 340 ms, and the motion's wall time); a scroll of Δ moves the
// pattern by exactly Δ — the carry's uniforms and a screenshot shift-compare; exact 10⁶ rows down (the same carry fraction, the same
// holes); the wheel over the drawer scrolls it and never moves the camera — nor does the rest of a flick shut mid-way (K9); the desk inert while open; 0 submits at rest open and
// closed (240 frames each), one frame per frame of motion; the drawer's GPU cost at 2400 × 1600 (≤ 0.3 ms: a saturated batch of it
// alone, drained around, medians and minima of 7 rounds with the load beside them); the night; no page errors. K5a — THE SPECIMENS:
// the six kinds in the world where the lattice law lays them (read back; never Active, selected or durable), every peg on a punched
// hole's centre, the scroll's range from the laid content, each drawn by its own kind, a scroll of Δ moving board and specimens by Δ,
// the band carrying them, the hover lifting one and settling, a PLUGIN fixture kind on the tray by its entry alone, idle with them
// open and closed, and what they cost. K5b — TAKING ONE: each kind dragged off its specimen made where it is dropped (the grab point kept,
// selected, one undo step), the copy lifted at ×1.06 with the specimen still hung, the hand-off without a pop (the copy's rect and the
// ghost's first, measured), the ways back (Esc, over the drawer as drawn — still sliding away — inside it) making nothing and leaving nothing
// in undo, the ghost flying home shrinking; K9: a drop where the drawer stood open, once it has shut, made there; into a mini mat by the
// kinds' rules; K9: inside an entered mini mat the drawer hangs only what it takes; the plugin kind taken too, idle after. design-018
// (R2) — THE BAR: the drawer's DOM handle opens and shuts it by real clicks on its rect, sits on the drawer's top edge open and at the
// foot shut, shows the categories the drawer hangs as chips — a chip lays only its entries from the board's top and leaves the drawer
// open, All lays them all — and the plugin's category is its own chip. Every other row reads the canvas alone (the bar hidden).
// Exit 0 = every row passed.
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { faultsOf, launchChrome, openTab, watchPage } from "./cdp.mjs";
import { decodePng } from "./png.mjs";
import { hostLoad, median, minOf, watchdog } from "./timing.mjs";
import { layTray, PEG_LATTICE } from "../../../packages/kernel/src/tray.ts";
import { carry, cellOf, holeSdf, pointAt, punched } from "../../../packages/desk/src/tray/lattice.ts";

const here = import.meta.dirname;
const app = resolve(here, "..");
const repo = resolve(app, "../..");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();
const server = spawn(process.execPath, [resolve(here, "server.mjs"), repo, "0"], { stdio: ["ignore", "pipe", "inherit"] });
const PORT = await new Promise((r) => server.stdout.once("data", (b) => r(Number(String(b).match(/PORT (\d+)/)[1]))));
const chrome = await launchChrome({ headless: !process.env.DESK_HEADED });
let done = false;
async function cleanup() { if (done) return; done = true; try { await chrome.close(); } catch {} try { server.kill("SIGKILL"); } catch {} }
const kick = watchdog(180_000, cleanup);   // no row in 180 s: a hang (K-H — a slow host is not one)
let pass = 0;
let failN = 0;
const check = (ok, msg) => { console.log(`  ${ok ? "PASS" : "FAIL"}  ${msg}`); ok ? pass++ : failN++; kick(); };

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
  await tab.evaluate("window.__desk.bar(false)", { timeoutMs: 20000 });   // design-018 §5 (R2): its pixels are the renderer's alone — the tray's bar hidden
  const front = () => tab.send("Page.bringToFront");
  const q = async (js) => { await front(); return tab.evaluate(js, { timeoutMs: 20000 }); };
  const qa = async (js, ms = 30000) => { await front(); return tab.evaluate(js, { awaitPromise: true, timeoutMs: ms }); };
  const mouse = (type, x, y, extra = {}) => tab.send("Input.dispatchMouseEvent", { type, x, y, button: type === "mouseMoved" || type === "mouseWheel" ? "none" : "left", clickCount: 1, ...extra });
  const click = async (x, y) => { await mouse("mouseMoved", x, y); await mouse("mousePressed", x, y, { buttons: 1 }); await sleep(30); await mouse("mouseReleased", x, y); };
  const key = async (k, code, vk) => { await front(); await tab.send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, windowsVirtualKeyCode: vk, text: k.length === 1 ? k : undefined }); await tab.send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: vk }); };
  const settle = () => qa("window.__desk.settle(4000)");
  const shot = async () => { await front(); const { data } = await tab.send("Page.captureScreenshot", { format: "png", optimizeForSpeed: true }); return decodePng(Buffer.from(data, "base64")); };
  const idle = (n = 240) => qa(`(async () => { await window.__desk.settle(4000); const b = window.__desk.submits().total; await new Promise((r) => { let i = 0; const f = () => { if (++i >= ${n}) r(); else requestAnimationFrame(f); }; requestAnimationFrame(f); }); return window.__desk.submits().total - b; })()`);
  const tray = () => q("({ ...window.__desk.tray.state(), facts: window.__desk.tray.facts() })");
  const lum = (img, x, y) => { const i = (y * img.width + x) * 4; return 0.2126 * img.rgba[i] + 0.7152 * img.rgba[i + 1] + 0.0722 * img.rgba[i + 2]; };
  // design-018 §5 (R2): the tray's BAR as the page lays it out — its pill's rect, its button's centre, each chip's (CSS px)
  const BAR = `(() => { const root = document.querySelector("[data-ice-tray-bar]"); if (!root) return null; const pill = root.querySelector(".ice-tb-bar").getBoundingClientRect(); const t = root.querySelector("[data-act=tray]"); const tr = t.getBoundingClientRect();
    return { open: root.dataset.open, visible: root.dataset.visible, x0: pill.left, y0: pill.top, x1: pill.right, y1: pill.bottom, toggle: { x: tr.left + tr.width / 2, y: tr.top + tr.height / 2, expanded: t.getAttribute("aria-expanded") },
      chips: [...root.querySelectorAll(".ice-tb-chip")].map((c) => { const r = c.getBoundingClientRect(); return { id: c.dataset.category, label: c.textContent, pressed: c.getAttribute("aria-pressed"), x: r.left + r.width / 2, y: r.top + r.height / 2 }; }) }; })()`;
  const bar = () => q(BAR);
  // the board's own FACE at a device pixel for a shown scroll: clear of every punched hole by 1.5 CSS px (the lattice's CPU mirror) — a
  // hole shows the desk under the drawer (design-018 §3), which does not scroll with the board
  const onFace = (rect, xd, yd, S) => { const c = cellOf(pointAt((xd / 2 - rect.x) / 40, yd / 2 - rect.y, 40, carry(S, 40))); return !punched(c, rect.w / 40) || holeSdf(c.qx, c.qy) * 40 > 1.5; };

  // a still desk (no wind frames), a note on it and one under where the drawer comes
  await q("window.__desk.ambient('still'); window.__desk.setTheme('light')");
  const note = await q("window.__desk.spawn('desk.note', { seed: 7 }, { x: 300, y: 250 })");
  const under = await q("window.__desk.spawn('desk.note', { seed: 11 }, { x: 600, y: 640 })");
  await settle();
  const cam0 = await q("window.__desk.camera()");

  // 1. CLOSED: wholly below the view with its shadows' reach (design-018 §5 — no lip), the whole drawer's width; nothing moves at rest
  let s = await tray();
  check(s.facts !== null && s.facts.open === false && s.frame?.p === 0 && s.frame.x === 40 && s.frame.w === 1120 && s.frame.y === 862 && s.laid?.dim === 0,
    `closed: wholly below the view — rect x ${s.frame?.x} y ${s.frame?.y} w ${s.frame?.w} (40 · 800 + the shadows' reach 62 · 1120), no dim (${s.laid?.dim})`);
  const restClosed = await idle();
  check(restClosed === 0, `closed at rest: ${restClosed} submits over 240 frames`);
  // design-018 §5: the lip's hover retired with its handle — the mouse at the bottom centre lifts nothing (the drawer as drawn stays)
  await mouse("mouseMoved", 600, 795); await settle();
  const atFoot = await tray();
  await mouse("mouseMoved", 600, 400); await settle();
  check(atFoot.facts.open === false && atFoot.frame.y === s.frame.y,
    `closed, the mouse at the bottom centre lifts nothing: the drawer's top stays at y ${atFoot.frame.y} (${s.frame.y})`);
  // (d) SHUT, IT DRAWS NOTHING (design-018 §5, §8 R1 d): the frames the desk draws with the drawer shut — a note selected, then not —
  //     carry no tray draw (the lip's quad and the rim were two in every such frame); the GPU profiler counts draws by the pipeline's kind
  const shutDraws = await qa(`(async () => {
    const g = window.__desk.perf.gpu(); const release = g.arm(); g.take();
    window.__desk.engine.ops.setSelection([${note}], 'replace'); await window.__desk.settle(4000);
    window.__desk.engine.ops.setSelection([], 'replace'); await window.__desk.settle(4000);
    await new Promise((r) => setTimeout(r, 300));
    const frames = g.take().filter((f) => f.kind === 'frame'); release();
    return { frames: frames.length, draws: frames.reduce((a, f) => a + f.counts.draws, 0), tray: frames.reduce((a, f) => a + (f.byKind.tray?.draws ?? 0), 0), p: window.__desk.tray.state().p };
  })()`);
  check(shutDraws.p === 0 && shutDraws.frames >= 2 && shutDraws.draws > 0 && shutDraws.tray === 0,
    `shut, the drawer draws nothing: ${shutDraws.frames} frames the desk drew (a selection set and cleared) — ${shutDraws.draws} draws, ${shutDraws.tray} of them the tray's`);

  // K5a: the FIRST open makes, once, what the specimens need (the composite kinds' tray passes, their slots) — its submits are that setup's;
  //      every slide after it is one frame per frame of motion (row 2)
  const first0 = await q("window.__desk.submits().total");
  await q("window.__desk.tray.open()"); await settle(); await sleep(300); await settle();
  // the setup DONE, not two 4 s settles and a sleep standing in for it (K-H): the desk SETTLED, however long a slow host takes (30 s
  // at most). Twice at load 150–193, with another session's oracle on the GPU, the first open drew 17 frames, not its ~26, before
  // the settles gave up unsettled; the rest of its setup landed in the next open, and the slide row below counted it as the slide's
  // (24 submits for 21 frames of motion). Shutting the first open after ONE frame puts the setup's tail in the slide's window here too
  let firstSettled = (await settle()).settled;
  for (let i = 0; i < 7 && !firstSettled; i++) firstSettled = (await settle()).settled;
  const firstOpen = (await q("window.__desk.submits().total")) - first0;
  const slots = (await tray()).slots;
  await q("window.__desk.tray.close()"); await settle();
  check(slots === 6 && firstOpen > 0 && firstSettled, `the first open made the six specimens' slots (${slots}) — ${firstOpen} submits, the slide's and the setup's, once; the desk settled after it: ${firstSettled}`);

  // 2. `a` opens it, on the curve — sampled on the frame clock; the motion's wall time
  const lit0 = await shot();
  // ONE FRAME'S COUNT, FRAME BY FRAME (K-H): a sampler IN THE PAGE reads the drawer's p, the frames the desk drew and the submits,
  // every frame, beside the trace — running before the toggle (its first sample waited for), until 60 frames after the drawer
  // arrived. The row counted submits from before the trace to after a settle against the trace's frames in motion — a window a slow
  // host fills with frames the slide did not make (the first open's tail: 24 for 21) and that the trace, stopping at 620 ms of wall
  // time, empties (6 frames in motion sampled and 22 drawn, at 6× throttle); and a frame that also lays a layer submits twice
  await qa("(() => { const d = window.__desk; const out = (window.__slideFrames = []); let rest = -1; const f = () => { const p = d.tray.state().p; out.push({ p, drawn: d.handle.redraws(), sub: d.submits().total }); if (p === 1 && rest < 0) rest = out.length; if ((rest < 0 || out.length - rest < 60) && out.length < 600) requestAnimationFrame(f); }; requestAnimationFrame(f); return 0; })()");
  await qa("new Promise((r) => { const f = () => (window.__slideFrames.length > 0 ? r(0) : requestAnimationFrame(f)); f(); })");
  const trace = await qa("window.__desk.tray.trace(420)");   // toggles: opens
  const near = (t) => trace.reduce((a, b) => (Math.abs(b.t - t) < Math.abs(a.t - t) ? b : a));
  const rows = [0, 170, 340].map((t) => { const o = near(t); return { t: o.t, p: o.p, want: ease(o.t / 340) }; });
  const worst = Math.max(...trace.map((o) => Math.abs(o.p - ease(o.t / 340))));
  const reached = trace.find((o) => o.p === 1);
  check(rows.every((r) => Math.abs(r.p - r.want) < 1e-6) && worst < 1e-6 && rows[0].p === 0,
    `the slide on cubic-bezier(0.32,0.72,0,1): ${rows.map((r) => `p(${r.t.toFixed(0)} ms) ${r.p.toFixed(4)}`).join(" · ")} — every one of ${trace.length} frames on the curve (worst ${worst.toExponential(1)})`);
  // the FIRST frame at or past 340 ms of the frame clock, whatever the frame rate (K-H): the bound was 340 + 40 ms, one frame at 25 fps, and
  // at 8× throttle the first frame past 340 came at 383.3 ms — the frame before it still short of 340 is the claim, not the host's frame time
  const beforeReached = trace[trace.indexOf(reached) - 1];
  check(reached !== undefined && reached.t >= 340 && beforeReached !== undefined && beforeReached.t < 340 && trace.filter((o) => o.t < 323).every((o) => o.p < 1),
    `it arrives at 340 ms and not before (first p = 1 at t ${reached?.t.toFixed(1)} ms of the frame clock — the frame before it at ${beforeReached?.t.toFixed(1)} — ${reached?.wall.toFixed(0)} ms of wall time after the toggle)`);
  const slideFrames = await qa("new Promise((r) => { const f = () => { const o = window.__slideFrames; const rest = o.findIndex((x) => x.p === 1); if (o.length >= 600 || (rest >= 0 && o.length - rest >= 60)) r(o); else requestAnimationFrame(f); }; f(); })", 60000);
  const slideSteps = slideFrames.slice(1).map((o, i) => ({ dp: o.p - slideFrames[i].p, dd: o.drawn - slideFrames[i].drawn, ds: o.sub - slideFrames[i].sub }));
  const slideFirst = slideSteps.findIndex((x) => x.dp > 0);
  const slideLast = slideSteps.findLastIndex((x) => x.dp > 0);
  const slideMoving = slideSteps.slice(slideFirst, slideLast + 1);
  const slideBegan = slideSteps.slice(0, Math.max(slideFirst, 0)).reduce((a, x) => a + x.dd, 0);
  const slideRest = slideSteps.slice(slideLast + 1);
  check(slideFirst >= 0 && slideMoving.length >= 5 && slideMoving.every((x) => x.dp > 0 && x.dd === 1) && slideBegan <= 1 && slideRest.length >= 59 && slideRest.every((x) => x.dd === 0 && x.ds === 0),
    `one frame per frame of motion: each of the slide's ${slideMoving.length} frames in motion drew one frame (${slideMoving.map((x) => x.dd).join("")}; ${slideMoving.reduce((a, x) => a + x.ds, 0)} submits), ${slideBegan} as it began, then asleep — ${slideRest.reduce((a, x) => a + x.dd, 0)} frames, ${slideRest.reduce((a, x) => a + x.ds, 0)} submits in the ${slideRest.length} frames after`);
  await settle();
  s = await tray();
  check(s.facts.open === true && s.frame.p === 1 && s.frame.y === 448 && s.frame.h === 352 && s.frame.w === 1120 && Math.abs(s.laid.dim - 0.1) < 1e-9,
    `open: rect y ${s.frame.y} h ${s.frame.h} (448 · 352, ≈ 44 % of 800), the dim at ${s.laid?.dim} by day`);
  const restOpen = await idle();
  check(restOpen === 0, `open at rest: ${restOpen} submits over 240 frames`);

  // 3. what it draws: the face's colour, the holes' share of the board, the dimmed desk above it — the board BARE (its specimens pinned away, K5a)
  await q("window.__desk.tray.pin({ bare: true })"); await settle();
  const lit1 = await shot();
  // the note laid under the drawer, on screen in device px (design-018 §3: the holes over it show it — row 3b), kept out of the hole share
  const un = await q(`window.__desk.entity(${under})`);
  const uBox = [(un.x - cam0.x) * cam0.zoom * 2, (un.y - cam0.y) * cam0.zoom * 2, (un.x + un.w - cam0.x) * cam0.zoom * 2, (un.y + un.h - cam0.y) * cam0.zoom * 2];
  const nearNote = (x, y, m) => x >= uBox[0] - m && x <= uBox[2] + m && y >= uBox[1] - m && y <= uBox[3] + m;
  const inside = []; for (let y = 1000; y < 1560; y += 3) for (let x = 180; x < 2220; x += 3) if (!nearNote(x, y, 40)) inside.push(y * lit1.width + x);
  const dark = inside.filter((i) => lum(lit1, i % lit1.width, Math.floor(i / lit1.width)) < 110).length / inside.length;
  const faceL = inside.map((i) => lum(lit1, i % lit1.width, Math.floor(i / lit1.width))).sort((a, b) => a - b)[Math.floor(inside.length * 0.6)];
  check(dark > 0.12 && dark < 0.19 && faceL > 165 && faceL < 200, `the board: holes darken ${(dark * 100).toFixed(1)} % of it (the stadium's 15.7 % of a cell), the face's luminance ${faceL.toFixed(0)} (≈ #cdb491's 182)`);
  // (c) NO NOTCH (design-018 §2, §5; §8 R1 c): the top edge's centre is BOARD — the tan face under its lit edge (R ≥ G ≥ B, bright),
  //     never the desk seen through a finger notch (56 × 8 was cut there). The lattice's own holes are skipped: at scroll 0 the tips of
  //     the row above the board's top (its centres ¼ pitch over it) show 3.2 px under the edge — the board runs on above the window
  const litRect = (await tray()).frame;
  let notchN = 0;
  let notchDesk = 0;
  for (let y = 900; y < 914; y++) for (let x = 1152; x < 1248; x++) {
    if (!onFace(litRect, x, y, 0)) continue;
    const i = (y * lit1.width + x) * 4;
    notchN++;
    if (!(lit1.rgba[i] >= lit1.rgba[i + 1] && lit1.rgba[i + 1] >= lit1.rgba[i + 2] && lum(lit1, x, y) > 120)) notchDesk++;
  }
  check(notchN > 0 && notchDesk === 0, `no notch: the top edge's centre is board — the ${notchN} px 1–7 px under the edge within 24 of its centre all the tan face (${notchDesk} not)`);
  const deskBefore = lum(lit0, 1200, 200);
  const deskAfter = lum(lit1, 1200, 200);
  check(Math.abs(deskAfter / deskBefore - 0.9) < 0.03, `the desk dims 10 % by day: luminance ${deskBefore.toFixed(1)} → ${deskAfter.toFixed(1)} (× ${(deskAfter / deskBefore).toFixed(3)})`);
  // 3b. THE HOLES SEE THE DESK (design-018 §3): a hole shows what lies under the drawer AS DRAWN, in the board's shadow — black laid over
  //     it — so through each hole's lit patch (below and right of its centre, clear of the lamp's crescent) the open frame is the shut one
  //     (lit0, the same pixel) times ONE factor for all three channels, the dim's and the light's share: the note laid under the drawer
  //     keeps its yellow, the bare mat its green (the research's plaster showed a grey in every hole)
  const patch = (img, x, y) => { const c = [0, 0, 0]; for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) { const k = ((y + j) * img.width + x + i) * 4; for (let n = 0; n < 3; n++) c[n] += img.rgba[k + n] / 9; } return c; };
  const through = { note: [], mat: [] };
  for (let row = 0; row < 8; row++) for (let col = 0; col < 28; col++) {
    const hx = col + 0.25 + (row & 1 ? 0.5 : 0);
    if (hx < 0.75 || hx > 28 - 0.75) continue;
    const x = Math.round((40 + (hx + 0.04) * 40) * 2);
    const y = Math.round((448 + (row + 0.75 + 0.12) * 40) * 2);
    const shut = patch(lit0, x, y);
    const open = patch(lit1, x, y);
    const k = open.map((v, n) => v / Math.max(shut[n], 1));
    const h = { k, open };
    if (x > uBox[0] + 16 && x < uBox[2] - 16 && y > uBox[1] + 16 && y < uBox[3] - 16) through.note.push(h);
    else if (!nearNote(x, y, 40)) through.mat.push(h);
  }
  const oneFactor = (h) => Math.max(...h.k) - Math.min(...h.k) < 0.08 && Math.min(...h.k) > 0.7 && Math.max(...h.k) < 0.98;
  const yellow = (h) => h.open[0] > h.open[2] + 40 && h.open[1] > h.open[2] + 40;
  const green = (h) => h.open[1] > 1.15 * h.open[0] && h.open[1] > 1.15 * h.open[2];
  const kOf = (hs) => hs.flatMap((h) => h.k);
  check(through.note.length >= 4 && through.note.every((h) => oneFactor(h) && yellow(h)) && through.mat.length >= 40 && through.mat.every((h) => oneFactor(h) && green(h)),
    `the holes see the desk as drawn: ${through.note.length} holes over the note laid under the drawer keep its yellow (e.g. ${through.note[0]?.open.map((v) => v.toFixed(0)).join(",")}), ${through.mat.length} over the bare mat its green (e.g. ${through.mat[0]?.open.map((v) => v.toFixed(0)).join(",")}) — each the shut frame × one factor for all three channels (${Math.min(...kOf(through.note), ...kOf(through.mat)).toFixed(3)} … ${Math.max(...kOf(through.note), ...kOf(through.mat)).toFixed(3)}; the dim's 0.9)`);

  // 4. a scroll of Δ moves the pattern by exactly Δ: the carry's uniforms, and the pixels shifted by Δ·dpr — the board's own FACE: a hole
  //    shows the desk under the drawer (design-018 §3), which does not scroll with the board, so the compare reads the pixels clear of
  //    every punched hole (`onFace`)
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
  for (let y = 940; y < 1560 - 2 * D; y += 1) for (let x = 140; x < 2260; x += 2) { if (!onFace(lb.rect, x, y, S0 + D)) continue; const d = Math.abs(lum(B, x, y) - lum(A, x, y + 2 * D)); maxd = Math.max(maxd, d); sum += d; n++; if (d > 0) moved++; }
  // the same board point is reached by two float paths (its rows on screen plus a different fraction of one): exact, but for an f32's
  // rounding across a quantisation step — at most one step, on a vanishing share of the pixels
  check(maxd <= 1 && moved / n < 1e-3, `the board ${D} px on is the same pixels ${2 * D} device px up (its face — the holes show the unscrolled desk): ${moved} of ${n.toLocaleString()} px differ (max |Δ| ${maxd.toFixed(2)} — an f32's rounding, ≤ 1 step), mean ${(sum / n).toFixed(4)}`);

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
  await q("window.__desk.tray.scroll(0); window.__desk.tray.pin(null)"); await settle();

  // 6. the wheel over the drawer scrolls it and never moves the camera; ⌘-wheel there and a wheel on the dimmed desk do nothing — over
  //    the board where no specimen hangs at any scroll (a specimen under the mouse would lift: K5a's hover, its own row)
  await mouse("mouseMoved", 1100, 650);
  await settle();
  const w0 = (await tray()).facts.scroll;
  const ws0 = await q("window.__desk.submits().total");
  for (let i = 0; i < 3; i++) { await mouse("mouseWheel", 1100, 650, { deltaX: 0, deltaY: 120 }); await sleep(30); }
  await settle();
  const w1 = (await tray()).facts.scroll;
  const wheeled = (await q("window.__desk.submits().total")) - ws0;
  check(wheeled >= 1 && wheeled <= 3, `a scroll costs a frame per wheel tick: ${wheeled} submits for 3 wheel events, then asleep`);
  await mouse("mouseWheel", 1100, 650, { deltaX: 0, deltaY: 120, modifiers: 4 });   // ⌘
  await mouse("mouseWheel", 600, 200, { deltaX: 0, deltaY: 120 });                 // the dimmed desk
  await sleep(200);
  const w2 = (await tray()).facts.scroll;
  const cam1 = await q("window.__desk.camera()");
  check(w1 > w0 && w2 === w1 && cam1.x === cam0.x && cam1.y === cam0.y && cam1.zoom === cam0.zoom,
    `the wheel over the drawer scrolled it ${w0} → ${w1} px; ⌘-wheel there and a wheel on the desk: ${w2}; the camera ${JSON.stringify(cam1)} unmoved`);
  await q("window.__desk.tray.scroll(0)");

  // 6b (K9, S7). shut mid-flick, the rest of the flick stays the tray's until the wheel goes quiet — the desk never zooms. A flick is
  //    24 decaying deltas (× 0.9) a FRAME apart, dispatched in the page (the adapter's own listener takes them: the first six must
  //    scroll the drawer, or the row has nothing to say), the drawer shut by its op (Esc's) before the 7th. The latch runs on the
  //    frame clock (design-017's let-go clock): a flick with a frame gap ≥ `letGoMs` is not this row's case — tried again, ≤ 3
  {
    let fl = null;
    for (let tries = 1; tries <= 3; tries++) {
      await q("window.__desk.tray.scroll(0)"); await settle();
      const camA = await q("window.__desk.camera()");
      const s0 = (await tray()).facts.scroll;
      const run = await qa(`new Promise((res) => { const el = document.elementFromPoint(1100, 650); let i = 0; let dy = 60; let last = 0; let gap = 0; let s6 = 0;
        const f = (t) => { if (i > 0) gap = Math.max(gap, t - last); last = t;
          if (i === 6) { s6 = window.__desk.tray.facts().scroll; window.__desk.tray.close(); }
          el.dispatchEvent(new WheelEvent("wheel", { clientX: 1100, clientY: 650, deltaX: 0, deltaY: Math.max(1, Math.round(dy)), deltaMode: 0, bubbles: true, cancelable: true }));
          dy *= 0.9; i += 1; if (i < 24) requestAnimationFrame(f); else res({ gap, s6 }); };
        requestAnimationFrame(f); })`);
      await sleep(300); await settle();
      const camB = await q("window.__desk.camera()");
      fl = { ...run, s0, shut: (await tray()).facts.open === false, moved: camB.x !== camA.x || camB.y !== camA.y || camB.zoom !== camA.zoom, camB, tries };
      if (fl.moved) await q(`window.__desk.setCamera(${JSON.stringify(cam0)})`);   // a red here must not move every row after it
      await q("window.__desk.tray.open()"); await settle();
      if (run.gap < 120) break;
    }
    check(fl.gap < 120 && fl.s6 > fl.s0 && fl.shut && !fl.moved,
      `shut mid-flick (its op before the 7th of 24 decaying deltas a frame apart, frame gaps ≤ ${fl.gap.toFixed(0)} ms), the rest never reached the desk: the first six scrolled the drawer ${fl.s0} → ${fl.s6} px; the camera ${JSON.stringify(fl.camB)} ${fl.moved ? "MOVED" : "unmoved"}${fl.tries > 1 ? ` (${fl.tries} tries)` : ""}`);
    await q("window.__desk.tray.scroll(0)"); await settle();
  }

  // 6c (K9, S10). a resize that moves the scroll's range under it clamps the scroll to the new end, in the frames the resize itself
  //    draws — no input after it (p9: a taller view, the drawer's face with it, left it 123 px past its content; the next wheel jumped)
  {
    const end0 = (await tray()).frame.max;
    await q(`window.__desk.tray.scroll(${end0})`); await settle();
    await tab.send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 1080, deviceScaleFactor: 2, mobile: false });
    await sleep(600); await settle();
    const tall = await tray();
    await tab.send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 800, deviceScaleFactor: 2, mobile: false });
    await sleep(600); await settle();
    const back = await tray();
    check(tall.frame.max < end0 && tall.facts.scroll === tall.frame.max && tall.facts.stretch === 0 && back.frame.max === end0 && back.facts.scroll === tall.frame.max,
      `a taller view (the face ${tall.frame.face} px) shrinks the range under the scroll, ${end0} → ${tall.frame.max}, and the scroll follows it to the new end with no input after the resize: ${tall.facts.scroll}; back at 800 high the range is ${back.frame.max} again and the scroll stays at ${back.facts.scroll} (nothing jumps)`);
    await q("window.__desk.tray.scroll(0)"); await settle();
  }

  // 6d (K9, S11). the band lets go on a FADING tail — p9's fling, measured frame by frame in the page: 70 synthetic deltas decaying ×0.95
  //    from 60, a frame apart, toward the top from scroll 120 (the fact's pull and the band as shown, each frame). K5's band held for the
  //    whole tail (p9: its last delta at 3.4 s, the band home 0.2 s after it); now it lets go on the third shrinking delta it takes, is
  //    home while the tail still arrives, and the rest of the tail never pulls it again. A run with a frame gap ≥ `letGoMs` (the quiet
  //    let-go would blur the two rules) is tried again, ≤ 3
  {
    let m = null;
    for (let tries = 1; tries <= 3; tries++) {
      await q("window.__desk.tray.scroll(120)"); await settle();
      m = await qa(`new Promise((res) => { const el = document.elementFromPoint(1100, 650); const rec = []; let i = 0; let dy = -60; let last = 0; let gap = 0; let end = -1;
        const f = (t) => { if (last > 0) gap = Math.max(gap, t - last); last = t;
          if (i < 70) { el.dispatchEvent(new WheelEvent("wheel", { clientX: 1100, clientY: 650, deltaX: 0, deltaY: Math.round(dy), deltaMode: 0, bubbles: true, cancelable: true })); dy *= 0.95; i += 1; if (i === 70) end = t; }
          rec.push({ t, s: window.__desk.tray.facts().stretch, b: window.__desk.tray.state().band });
          if (end < 0 || t - end < 500) requestAnimationFrame(f); else res({ rec, gap, end, tries: ${tries} }); };
        requestAnimationFrame(f); })`, 60000);
      if (m.gap < 120) break;
    }
    const r = m.rec;
    const i0 = r.findIndex((x) => x.s !== 0);
    const i1 = i0 < 0 ? -1 : r.findIndex((x, i) => i > i0 && x.s === 0);
    const i2 = i1 < 0 ? -1 : r.findIndex((x, i) => i > i1 && Math.abs(x.b) < 0.5);
    const again = i1 < 0 || r.some((x, i) => i > i1 && x.s !== 0);
    const peak = Math.max(...r.map((x) => Math.abs(x.b)));
    const ms = (i) => (i < 0 ? Number.NaN : r[i].t - r[i0].t);
    check(m.gap < 120 && i0 >= 0 && i1 > i0 && i1 - i0 <= 4 && i2 > i1 && r[i2].t < m.end && !again,
      `a fading tail lets the band go on its third shrinking delta: pulled for ${i1 - i0} frames (${ms(i1).toFixed(0)} ms, the band ${peak.toFixed(1)} px at most), home ${ms(i2).toFixed(0)} ms after the pull began — the tail's last delta ${(m.end - r[i0].t).toFixed(0)} ms after it; never pulled again (${!again}); frame gaps ≤ ${m.gap.toFixed(0)} ms${m.tries > 1 ? ` (${m.tries} tries)` : ""}`);
    await q("window.__desk.tray.scroll(0)"); await settle();
  }

  // 7. the desk inert while open: a drag on the note moves nothing and selects nothing; the drawer stays
  const p0 = await q(`window.__desk.entity(${note})`);
  await mouse("mouseMoved", 300, 250); await mouse("mousePressed", 300, 250, { buttons: 1 });
  for (let i = 1; i <= 8; i++) { await mouse("mouseMoved", 300 + i * 12, 250 + i * 5, { buttons: 1 }); await sleep(16); }
  await mouse("mouseReleased", 396, 290); await sleep(150);
  const p1 = await q(`window.__desk.entity(${note})`);
  const sel = await q("window.__desk.selection()");
  check(p1.x === p0.x && p1.y === p0.y && sel.length === 0 && (await tray()).facts.open === true, `inert: a drag on the note moved it (${p0.x},${p0.y}) → (${p1.x},${p1.y}), selected ${sel.length}, the drawer still open`);

  // 8. a click on the dimmed desk closes it (selecting nothing); a click where the lip was is the desk's (design-018 §5); Esc closes it; `a` again
  await click(300, 250); await sleep(150);
  s = await tray();
  check(s.facts.open === false && (await q("window.__desk.selection()")).length === 0, "a click on the dimmed desk closed it, and selected nothing under it");
  await settle();
  await click(600, 794); await sleep(150);
  check((await tray()).facts.open === false && (await q("window.__desk.selection()")).length === 0, "a click at the bottom centre, where the lip's handle was, is the bare desk's: the drawer stays shut (design-018 §5)");
  await q("window.__desk.tray.open()"); await settle();
  await key("Escape", "Escape", 27); await sleep(150);
  check((await tray()).facts.open === false, "Esc closed it");
  await settle();
  await key("a", "KeyA", 65); await sleep(150);
  check((await tray()).facts.open === true, "`a` opened it");
  await settle();

  // design-018 §5–§6 (R2) — THE BAR, by REAL clicks on its rect (CDP): shown for these rows alone (the rest read the canvas's pixels)
  await q("window.__desk.bar(true)"); await settle();
  let b = await bar();
  s = await tray();
  const cats = await q("window.__desk.handle.tray.categories()");
  check(b !== null && b.open === "true" && b.visible === "true" && Math.abs(b.y1 - (s.frame.y - 10)) <= 1 && Math.abs((b.x0 + b.x1) / 2 - 600) <= 1
    && b.chips.map((c) => c.label).join(" · ") === ["All", ...cats.map((c) => c.label)].join(" · ") && cats.map((c) => c.id).join() === "paper,surfaces" && b.chips[0]?.pressed === "true",
    `open, the bar rides the drawer's top edge at rest: its bottom at ${b?.y1.toFixed(1)} — the board's top ${s.frame.y} less 10 (±1) — centred (${b === null ? "?" : ((b.x0 + b.x1) / 2).toFixed(1)}); its chips ${b?.chips.map((c) => c.label).join(" · ")}: All and the categories the drawer hangs (${cats.map((c) => `${c.id} ${c.count}`).join(", ")}), All pressed`);
  await q("window.__desk.tray.scroll(120)"); await settle();
  const surf = b?.chips.find((c) => c.id === "surfaces");
  await click(surf.x, surf.y); await sleep(150); await settle();
  const barLaw = await q("window.__desk.tray.law()");
  const surfWant = layTray(barLaw.items.filter((i) => i.category === "surfaces"), barLaw.width, barLaw.pitch).placed;
  const surfHeld = await q("window.__desk.tray.specimens()");
  s = await tray(); b = await bar();
  check(s.facts.open === true && s.facts.category === "surfaces" && s.facts.scroll === 0 && surfHeld.length === 2 && surfWant.every((w) => surfHeld.some((h) => h.type === w.type && h.x === w.x && h.y === w.y)) && b.chips.find((c) => c.id === "surfaces")?.pressed === "true",
    `a click on the Surfaces chip lays only its entries where the law lays them alone (${surfHeld.map((h) => `${h.type} ${h.x},${h.y}`).join(" · ")}), the board at its top (scroll ${s.facts.scroll} from 120), the chip pressed — and the drawer still open: a chip is no click on the dim`);
  // scrolled while Surfaces shows (the door takes any value until the range next moves): All's change must zero it — the six's range
  // (their foot + a pitch − the face, ≈ 300 px) would keep 120, so no clamp can stand in for the change here (Surfaces alone ranges 0)
  await q("window.__desk.tray.scroll(120)"); await settle();
  const allChip = b.chips.find((c) => c.id === "");
  await click(allChip.x, allChip.y); await sleep(150); await settle();
  const allHeld = await q("window.__desk.tray.specimens()");
  s = await tray();
  check(s.facts.open === true && s.facts.category === "" && s.facts.scroll === 0 && allHeld.length === 6,
    `…and All lays the six again (${allHeld.length}), the board back at its top (scroll ${s.facts.scroll} from 120 — the six's range would keep 120: the change zeroed it), the drawer open`);
  const barRest = await idle(120);
  check(barRest === 0, `open at rest with the bar over the desk: ${barRest} submits over 120 frames`);
  // no rAF of its own (design-018 §5): the page's every ask for a frame counted over 1 s at rest — the loop's own included (it
  // looks the global up at each call), so a written scroll that wakes it is the control
  const rafs = (poke) => qa(`(async () => { let n = 0; const raf = window.requestAnimationFrame; window.requestAnimationFrame = (f) => { n += 1; return raf.call(window, f); }; ${poke} await new Promise((r) => setTimeout(r, 1000)); window.requestAnimationFrame = raf; return n; })()`);
  const rafRest = await rafs("");
  const rafWoken = await rafs("window.__desk.tray.scroll(1);");
  await q("window.__desk.tray.scroll(0)"); await settle();
  check(rafRest === 0 && rafWoken > 0, `at rest with the bar out the page asks for no frame: ${rafRest} rAF in 1 s (control: a scroll written wakes the loop — ${rafWoken} in 1 s)`);
  b = await bar();
  await click(b.toggle.x, b.toggle.y); await sleep(150); await settle(); await sleep(400); await settle();
  s = await tray(); b = await bar();
  const barFoot = Math.min(800 - 16, s.frame.y - 10);
  check(s.facts.open === false && b.open === "false" && b.toggle.expanded === "false" && Math.abs(b.y1 - barFoot) <= 1 && Math.abs((b.x0 + b.x1) / 2 - 600) <= 1,
    `a click on its button (the ×) shut the drawer, and the bar came down to the foot: its bottom at ${b.y1.toFixed(1)} — min(800 − 16, the drawer's top ${s.frame.y} − 10) = ${barFoot} (±1), not expanded`);
  await click(b.toggle.x, b.toggle.y); await sleep(150); await settle(); await sleep(400); await settle();
  s = await tray(); b = await bar();
  check(s.facts.open === true && s.frame.p === 1 && b.open === "true" && b.toggle.expanded === "true" && Math.abs(b.y1 - (s.frame.y - 10)) <= 1,
    `…and a click on it opened the drawer again (p ${s.frame.p}): the bar back on the top edge (${b.y1.toFixed(1)} for ${s.frame.y - 10}), expanded`);
  await q("window.__desk.bar(false)"); await settle();

  // K5a — THE SPECIMENS (design-017 §8)
  await q("window.__desk.tray.scroll(0)"); await settle();
  // S1. the world holds the six, each exactly where the lattice law lays them — read back from core's facts, the law run here
  const law = await q("window.__desk.tray.law()");
  const want = layTray(law.items, law.width, law.pitch);
  const held = await q("window.__desk.tray.specimens()");
  const placedOk = want.placed.every((p) => held.some((h) => h.type === p.type && h.x === p.x && h.y === p.y && h.w === p.w && h.h === p.h));
  check(held.length === 6 && want.placed.length === 6 && placedOk && held.every((h) => !h.active && !h.selected && !h.durable),
    `the world holds ${held.length} specimens, each at its lattice place (${held.map((h) => `${h.type.replace("desk.", "")} ${h.x},${h.y}`).join(" · ")}) — none Active, selected or durable`);
  // S2. every peg on a punched hole's centre, as drawn: back from the screen to the board (the frame's x, top and shown scroll)
  s = await tray();
  const pegs = s.specimens.flatMap((q) => q.pegs.map(([x, y]) => [(x - s.frame.x) / 40, (y - s.frame.y + s.frame.scroll) / 40]));
  const onHole = ([x, y]) => { const r = Math.round(y - PEG_LATTICE.rowPhase); const c = x - PEG_LATTICE.colPhase - ((r & 1) !== 0 ? 0.5 : 0); return Math.abs(y - PEG_LATTICE.rowPhase - r) < 1e-9 && Math.abs(c - Math.round(c)) < 1e-9 && x >= PEG_LATTICE.border && x <= s.frame.w / 40 - PEG_LATTICE.border; };
  check(pegs.length >= 6 && pegs.every(onHole), `every peg on a punched hole's centre: ${pegs.length} pegs of ${s.specimens.length} specimens in view (${pegs.slice(0, 4).map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" ")} …)`);
  // S3. the scroll's range is the laid content's: its foot plus a pitch less the face (K3's 26-row stub retired)
  check(s.frame.max === s.facts.bottom + 40 - 352 && s.facts.bottom === want.bottom, `the range ${s.frame.max} px = the content's foot ${s.facts.bottom} + 40 − the face 352 (the whole drawer: its face runs to the outline — design-018 §2; the law's foot ${want.bottom})`);
  // S4. each is drawn by its own kind: its rect on screen is far from the bare board there — at the top, and scrolled to the end
  const drawnBy = async () => {
    const A = await shot();
    const st = await tray();
    await q("window.__desk.tray.pin({ bare: true })"); await settle();
    const B = await shot();
    await q("window.__desk.tray.pin(null)"); await settle();
    return st.specimens.filter((q) => q.screen.y0 >= st.frame.y + 6 && q.screen.y1 <= 800).map((q) => {
      let sum = 0; let n = 0;
      for (let y = Math.ceil(q.screen.y0 * 2); y < q.screen.y1 * 2; y += 2) for (let x = Math.ceil(q.screen.x0 * 2); x < q.screen.x1 * 2; x += 2) { sum += Math.abs(lum(A, x, y) - lum(B, x, y)); n++; }
      return [q.type, sum / Math.max(n, 1)];
    });
  };
  const top = await drawnBy();
  await q(`window.__desk.tray.scroll(${s.frame.max})`); await settle();
  const end = await drawnBy();
  const every = [...top, ...end];
  check(new Set(every.map(([t]) => t)).size === 6 && every.every(([, d]) => d > 12), `all six drawn by their own kinds (mean |Δ| from the bare board over each rect): ${every.map(([t, d]) => `${t.replace("desk.", "")} ${d.toFixed(0)}`).join(" · ")}`);
  await q("window.__desk.tray.scroll(0)"); await settle();
  // S5. a scroll of Δ moves board and specimens by Δ: every rect on screen by exactly Δ (read back); the pixels Δ·dpr up — the board and
  //     the flat kinds to a float's rounding; the notebook and the calendar are seen through the desk eye (their kinds' own 3D law: a
  //     book passing the view's centre turns a little, D-K5a.3) — bounded, never a jump. Clear of the holes (row 4: they show the desk)
  await q(`window.__desk.tray.scroll(${S0})`); await settle();
  const SA = await shot(); const ra = (await tray()).specimens;
  await q(`window.__desk.tray.scroll(${S0 + D})`); await settle();
  const SB = await shot(); const rb = (await tray()).specimens;
  const rectsOk = ra.length > 0 && ra.every((a) => { const b = rb.find((q) => q.type === a.type); return b !== undefined && b.screen.y0 === a.screen.y0 - D && b.screen.x0 === a.screen.x0 && b.screen.y1 === a.screen.y1 - D; });
  const eyed = ra.filter((q) => q.kind === "notebook" || q.kind === "calendar").map((q) => [q.screen.x0 - 12, q.screen.x1 + 30]);
  let flatMax = 0; let flatMoved = 0; let flatN = 0; let eyeMax = 0;
  const sRect = (await tray()).frame;
  for (let y = 940; y < 1560 - 2 * D; y += 1) for (let x = 140; x < 2260; x += 2) {
    if (!onFace(sRect, x, y, S0 + D)) continue;
    const d = Math.abs(lum(SB, x, y) - lum(SA, x, y + 2 * D));
    if (eyed.some(([x0, x1]) => x / 2 >= x0 && x / 2 <= x1)) { eyeMax = Math.max(eyeMax, d); continue; }
    flatMax = Math.max(flatMax, d); flatN++; if (d > 1) flatMoved++;
  }
  const rectsSaid = ra.map((a) => { const b = rb.find((q) => q.type === a.type); return b === undefined ? `${a.type} gone` : `${a.type.replace("desk.", "")} ${a.screen.y0}→${b.screen.y0}`; }).join(" · ");
  check(rectsOk && flatMax < 2.5 && flatMoved / flatN < 1e-2, `a scroll of ${D} px: every specimen's rect ${D} px up exactly (${rectsSaid}); the board and the flat kinds the same pixels ${2 * D} device px up (max |Δ| ${flatMax.toFixed(2)}, ${flatMoved} of ${flatN.toLocaleString()} px past 1); the notebook and the calendar through the desk eye: max |Δ| ${eyeMax.toFixed(1)}`);
  await q("window.__desk.tray.scroll(0)"); await settle();
  // S6. the band carries them: a wheel past the end pulls the board AND the specimens by the band's shown pull, then lets them go
  await q(`window.__desk.tray.scroll(${s.frame.max})`); await settle();
  await mouse("mouseMoved", 1100, 650);
  // the PULL read IN THE PAGE, every frame from before the first wheel (K-H): the band lets go 120 ms of `now` after the last wheel,
  // and a read two frames after the wheels' round trips came after it at load 400 (pulled 0 px). The frame of the deepest pull is read
  await qa("(() => { const out = (window.__bandFrames = []); let seen = -1; const f = () => { const st = window.__desk.tray.state(); out.push(st); if (st.facts.stretch > 0) seen = out.length; if ((seen < 0 || out.length - seen < 20) && out.length < 900) requestAnimationFrame(f); }; requestAnimationFrame(f); return 0; })()");
  await qa("new Promise((r) => { const f = () => (window.__bandFrames.length > 0 ? r(0) : requestAnimationFrame(f)); f(); })");
  for (let i = 0; i < 4; i++) { await mouse("mouseWheel", 1100, 650, { deltaX: 0, deltaY: 60 }); await sleep(12); }
  const bandFrames = await qa("new Promise((r) => { const f = () => { const o = window.__bandFrames; const seen = o.findLastIndex((x) => x.facts.stretch > 0); if (o.length >= 900 || (seen >= 0 && o.length - 1 - seen >= 20)) r(o); else requestAnimationFrame(f); }; f(); })", 60000);
  const pulled = bandFrames.reduce((a, b) => (b.facts.stretch > a.facts.stretch ? b : a));
  const carried = pulled.specimens.length > 0 && pulled.specimens.every((q) => { const w = held.find((h) => h.type === q.type); return w !== undefined && Math.abs(q.screen.y0 - (pulled.frame.y + w.y - pulled.frame.scroll)) < 1e-9; }) && Math.abs(pulled.frame.scroll - (pulled.facts.scroll + pulled.band)) < 1e-9;
  await sleep(300); await settle();   // quiet past the let-go (120 ms), then the settle's spring
  const let0 = await tray();
  check(pulled.facts.stretch > 0 && pulled.band > 0 && carried && let0.facts.stretch === 0 && let0.band === 0, `the band carries them: pulled ${pulled.facts.stretch.toFixed(0)} px past the end, shown ${pulled.band.toFixed(1)} — each specimen at its board place less the scroll and the band; let go, back to ${let0.band}`);
  await q("window.__desk.tray.scroll(0)"); await settle();
  // S7. the hover: the mouse over the note lifts it (the kinds' own lift — its shadow grows) and it settles; off it, down again; asleep after each
  const noteAt = (await tray()).specimens.find((q) => q.type === "desk.note");
  const nx = (noteAt.screen.x0 + noteAt.screen.x1) / 2;
  const ny = (noteAt.screen.y0 + noteAt.screen.y1) / 2;
  const H0 = await shot();
  const h0 = await q("window.__desk.submits().total");
  await mouse("mouseMoved", nx, ny); await settle();
  const hovered = await tray();
  const liftFrames = (await q("window.__desk.submits().total")) - h0;
  const cursorAt = (x, y) => q(`getComputedStyle(document.elementFromPoint(${x}, ${y})).cursor`);   // the reflector's, inherited
  const curOn = await cursorAt(nx, ny);
  const H1 = await shot();
  let grew = 0; let gn = 0;
  for (let y = Math.floor(noteAt.screen.y0 * 2); y < (noteAt.screen.y1 + 30) * 2; y += 2) for (let x = Math.floor(noteAt.screen.x0 * 2); x < (noteAt.screen.x1 + 30) * 2; x += 2) { grew += Math.abs(lum(H1, x, y) - lum(H0, x, y)); gn++; }
  const restHover = await idle(120);
  await mouse("mouseMoved", 1100, 650); await settle();
  const dropped = await tray();
  const curOff = await cursorAt(1100, 650);
  const restDown = await idle(120);
  check(hovered.facts.hover === "desk.note" && hovered.hovers["desk.note"] === 1 && liftFrames > 3 && grew / gn > 1 && restHover === 0 && dropped.facts.hover === "" && Object.keys(dropped.hovers).length === 0 && restDown === 0 && curOn === "grab" && curOff !== "grab",
    `the hover: the note under the mouse lifts (${hovered.hovers["desk.note"]}, ${liftFrames} frames, mean |Δ| ${(grew / gn).toFixed(2)} round it — its shadow grew), asleep hovered (${restHover}); off it, down (${JSON.stringify(dropped.hovers)}), asleep (${restDown}); the cursor over it "${curOn}", off it "${curOff}" (K9)`);
  // S8. a PLUGIN fixture kind — declared in the app, not in @ice/objects — hangs on the tray by its entry alone
  const plug = await openTab(chrome.port, `http://127.0.0.1:${PORT}/apps/desk/dist/rig.html?trayPlugin=1`);
  await plug.send("Runtime.enable");
  await plug.send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 800, deviceScaleFactor: 2, mobile: false });
  for (let i = 0; i < 200; i++) { await plug.send("Page.bringToFront"); if (await plug.evaluate("typeof window.__desk === 'object' && window.__desk.state.ready", { timeoutMs: 20000 })) break; await sleep(200); }
  await plug.evaluate("window.__desk.ambient('still'); window.__desk.tray.open(); window.__desk.settle(4000)", { awaitPromise: true, timeoutMs: 20000 });
  await sleep(600);
  await plug.evaluate("window.__desk.settle(4000)", { awaitPromise: true, timeoutMs: 20000 });
  const plugLaw = await plug.evaluate("window.__desk.tray.law()", { timeoutMs: 20000 });
  const plugHeld = await plug.evaluate("window.__desk.tray.specimens()", { timeoutMs: 20000 });
  const plugWant = layTray(plugLaw.items, plugLaw.width, plugLaw.pitch).placed.find((p) => p.type === "rig.swatch");
  const plugOn = plugHeld.find((h) => h.type === "rig.swatch");
  await plug.evaluate(`window.__desk.tray.scroll(${Math.max(0, (plugOn?.y ?? 0) - 120)}); window.__desk.settle(4000)`, { awaitPromise: true, timeoutMs: 20000 });
  const plugDrawn = (await plug.evaluate("window.__desk.tray.state().specimens", { timeoutMs: 20000 })).find((q) => q.type === "rig.swatch");
  // K5b: the plugin kind is TAKEN as the built-ins are — its specimen dragged out makes one, selected, one undo step
  const pm = (type, x, y, extra = {}) => plug.send("Input.dispatchMouseEvent", { type, x, y, button: type === "mouseMoved" ? "none" : "left", clickCount: 1, ...extra });
  const pf = (n) => plug.evaluate(`new Promise((r) => { let i = 0; const f = () => { if (++i >= ${n}) r(true); else requestAnimationFrame(f); }; requestAnimationFrame(f); })`, { awaitPromise: true, timeoutMs: 20000 });
  const pents = () => plug.evaluate("window.__desk.entities().map((e) => ({ id: e.id, type: e.type, selected: e.selected }))", { timeoutMs: 20000 });
  await plug.send("Page.bringToFront");
  const po = plugDrawn?.object ?? { x0: 0, y0: 0, x1: 0, y1: 0 };
  const pg = [(po.x0 + po.x1) / 2, (po.y0 + po.y1) / 2];
  const pBefore = new Set((await pents()).map((e) => e.id));
  await pm("mouseMoved", pg[0], pg[1]); await pm("mousePressed", pg[0], pg[1], { buttons: 1 }); await pf(1);
  for (let i = 1; i <= 8; i++) { await pm("mouseMoved", pg[0] + ((600 - pg[0]) * i) / 8, pg[1] + ((250 - pg[1]) * i) / 8, { buttons: 1 }); await pf(2); }
  await pm("mouseMoved", 600, 250, { buttons: 1 }); await pf(3);
  await pm("mouseReleased", 600, 250, { buttons: 0 }); await pf(6);
  const pMade = (await pents()).filter((e) => !pBefore.has(e.id));
  const pUndo = await plug.evaluate("window.__desk.engine.docs.undo()", { timeoutMs: 20000 }); await pf(2);
  const pGone = (await pents()).every((e) => pBefore.has(e.id));
  // K9 (S13): the plugin kind is judged as the built-ins are, by the placement authority — a mini mat holds what provides
  // `CONTAINABLE` and the swatch provides `DESK_OBJECT` alone, so inside an entered one it does not hang (the note does); at the desk it does
  const pqa = (js) => plug.evaluate(js, { awaitPromise: true, timeoutMs: 30000 });
  await pqa("(async () => { window.__desk.tray.close(); await window.__desk.settle(4000); })()");
  const pmm = await plug.evaluate("window.__desk.spawn('desk.minimat', { name: 'In' }, { x: 600, y: 300 })", { timeoutMs: 20000 }); await pf(2);
  await pqa(`(async () => { window.__desk.engine.ops.enterContainer(${pmm}, { transition: "none" }); await window.__desk.settle(4000); window.__desk.tray.open(); await window.__desk.settle(4000); })()`);
  const pInside = (await plug.evaluate("window.__desk.tray.specimens()", { timeoutMs: 20000 })).map((s) => s.type);
  const pTakes = await plug.evaluate(`window.__desk.engine.placement.canIngress("rig.swatch", ${pmm}).ok`, { timeoutMs: 20000 });
  await pqa(`(async () => { window.__desk.tray.close(); await window.__desk.settle(4000); window.__desk.engine.ops.exitContainer({ transition: "none" }); await window.__desk.settle(4000); window.__desk.tray.open(); await window.__desk.settle(4000); })()`);
  const pBack = (await plug.evaluate("window.__desk.tray.specimens()", { timeoutMs: 20000 })).map((s) => s.type);
  // design-018 §6 (R2): the plugin's category is ITS OWN CHIP — a real click on it lays the swatch alone, one on All lays the seven again
  const pbar = () => plug.evaluate(BAR, { timeoutMs: 20000 });
  const pclick = async (c) => { await pm("mouseMoved", c.x, c.y); await pm("mousePressed", c.x, c.y, { buttons: 1 }); await sleep(30); await pm("mouseReleased", c.x, c.y); await pqa("window.__desk.settle(4000)"); };
  const pb0 = await pbar();
  const plugChip = pb0?.chips.find((c) => c.id === "plugin");
  if (plugChip !== undefined) await pclick(plugChip);
  const pAlone = (await plug.evaluate("window.__desk.tray.specimens()", { timeoutMs: 20000 })).map((x) => x.type);
  const pb1 = await pbar();
  const pAllChip = pb1?.chips.find((c) => c.id === "");
  if (pAllChip !== undefined) await pclick(pAllChip);
  const pSeven = (await plug.evaluate("window.__desk.tray.specimens()", { timeoutMs: 20000 })).length;
  const pOpen = await plug.evaluate("window.__desk.tray.isOpen()", { timeoutMs: 20000 });
  const plugFaults = await plug.evaluate("window.__desk.faults ?? []", { timeoutMs: 20000 });
  await plug.close?.();
  check(plugHeld.length === 7 && plugOn !== undefined && plugWant !== undefined && plugOn.x === plugWant.x && plugOn.y === plugWant.y && plugDrawn?.kind === "paper" && plugDrawn.accessory === "clip" && plugFaults.length === 0 && held.every((h) => h.type !== "rig.swatch"),
    `a plugin kind by its entry alone: with it registered the world holds ${plugHeld.length} (rig.swatch at ${plugOn?.x},${plugOn?.y} — the law's ${plugWant?.x},${plugWant?.y}), drawn by its kind on its clip; without it, none (${held.length})`);
  check(pMade.length === 1 && pMade[0].type === "rig.swatch" && pMade[0].selected && pUndo === true && pGone,
    `…and TAKEN as the built-ins are (K5b): dragged off its clip to the desk, one made (${pMade.map((m) => `${m.type}${m.selected ? ", selected" : ""}`).join(" · ") || "none"}), one undo step takes it back (${pUndo}, gone ${pGone})`);
  check(pTakes === false && !pInside.includes("rig.swatch") && pInside.includes("desk.note") && pBack.includes("rig.swatch"),
    `…and judged as the built-ins are (K9): inside an entered mini mat — whose ingress refuses it (${pTakes}) — it does not hang (${pInside.join(", ")}); at the desk it does (${pBack.length} hung)`);
  check(pb0?.chips.map((c) => c.label).join(" · ") === "All · Paper · Plugin · Surfaces" && pAlone.join() === "rig.swatch" && pb1?.chips.find((c) => c.id === "plugin")?.pressed === "true" && pSeven === 7 && pOpen === true,
    `…and its category is its own chip (design-018 §6): ${pb0?.chips.map((c) => c.label).join(" · ")} — a click on Plugin lays the swatch alone (${pAlone.join(", ")}), one on All the seven (${pSeven}), the drawer open`);
  await front();

  // 9. THE COST (design-017 §6.7): the drawer open at 2400 × 1600 — n of it alone per batch, and whole frames with it open and closed,
  //    each batch drained around; 7 rounds, the host's load beside them — K5a: whole frames open with the specimens and open bare,
  //    the difference what the specimens cost. K-H: WARM (an untimed round first — the rows before leave the GPU idle, and a
  //    round's first batch is the board's), and the bound on the MINIMUM of the rounds: load only ever adds time to a drained
  //    batch, and the median of 7 read 0.301 and 0.334 ms on loaded hosts where the minimum stood near 0.2
  await qa("window.__desk.tray.cost(60)", 90000);
  const rounds = [];
  for (let i = 0; i < 7; i++) rounds.push(await qa("window.__desk.tray.cost(60)", 90000));
  const alone = rounds.map((r) => r.alone.ms);
  const whole = rounds.map((r) => r.open.ms);
  const plain = rounds.map((r) => r.bare.ms);
  const bare = rounds.map((r) => r.closed.ms);
  const aloneBare = rounds.map((r) => r.aloneBare.ms);
  check(minOf(aloneBare) <= 0.3, `the drawer's GPU cost at 2400 × 1600, open: the board alone ${minOf(aloneBare).toFixed(3)} ms, the minimum of 7 warm rounds (≤ 0.3; median ${median(aloneBare).toFixed(3)}) · with its six accessories ${minOf(alone).toFixed(3)} (median ${median(alone).toFixed(3)}); whole frames open with the specimens ${minOf(whole).toFixed(3)} (${median(whole).toFixed(3)}) · open bare ${minOf(plain).toFixed(3)} (${median(plain).toFixed(3)}) — the specimens Δ ${(minOf(whole) - minOf(plain)).toFixed(3)} · closed ${minOf(bare).toFixed(3)} ms · load ${hostLoad()}`);
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

  // S9. the tray's notebook and calendar passes (their own, beside the root's) follow D-K6a.3: their layers made when the drawer shows
  //     them, let go once undrawn LAYER_IDLE_MS (5 s) — the ledger's rows, open, then 6 s after the drawer shut
  const ledger = () => q("(() => { const m = window.__desk.handle.gpuMemory()?.read().byLabel ?? {}; return { notebook: m.notebook?.bytes ?? 0, calendar: m.calendar?.bytes ?? 0 }; })()");
  await q("window.__desk.tray.open()"); await settle(); await sleep(300); await settle();
  const memOpen = await ledger();
  const tilesOpen = await q("window.__desk.handle.local('calendar')?.tiles().resident ?? -1");
  await q("window.__desk.tray.close()"); await settle();
  // the let-go WAITED FOR (K-H), not 6 s of wall time against LAYER_IDLE_MS 5000: the let-go is a registered wake, late on a loaded host;
  // 12 s at most, and the time it took printed
  const shut0 = Date.now();
  let memShut = await ledger();
  let tilesShut = await q("window.__desk.handle.local('calendar')?.tiles().resident ?? -1");
  while (Date.now() - shut0 < 12000 && !(memShut.notebook < memOpen.notebook / 4 && memShut.calendar < memOpen.calendar / 4 && tilesShut === 0)) {
    await sleep(250);
    memShut = await ledger();
    tilesShut = await q("window.__desk.handle.local('calendar')?.tiles().resident ?? -1");
  }
  const shutS = ((Date.now() - shut0) / 1000).toFixed(1);
  const mb = (b) => (b / 1048576).toFixed(1);
  check(memOpen.notebook > 0 && memOpen.calendar > 0 && memShut.notebook < memOpen.notebook / 4 && memShut.calendar < memOpen.calendar / 4, `the tray's notebook and calendar layers let go once undrawn (each row under a quarter of its open size): the ledger's notebook ${mb(memOpen.notebook)} → ${mb(memShut.notebook)} MB, calendar ${mb(memOpen.calendar)} → ${mb(memShut.calendar)} MB, open → 6 s after the drawer shut`);
  // K5b: the pad specimen PRINTS its month with the desk's print (its tray pass reads the root's tiles) — and lets it go with the drawer shut
  check(tilesOpen > 0 && tilesShut === 0, `the pad specimen's print is the desk's, and let go with the drawer: its tiles resident ${tilesOpen} open → ${tilesShut} ${shutS} s after it shut (the layers' let-go 5 s)`);

  // S10. TAKING ONE (design-017 §9; K5b): a press on a specimen + 4 px lifts a COPY (the specimen stays hung); out of the drawer it slides
  //      away and the desk takes it — the insert ghost under the same grab point (no centre-snap), the ordinary drag, ONE create, selected,
  //      one undo step; the hand-off without a pop; Esc mid-drag, a release back over the drawer and a release inside it cancel with
  //      NOTHING in undo, the ghost flying home shrinking; into a mini mat by the kinds' rules; a plugin kind the same; idle after.
  const ents = () => q("window.__desk.entities().map((e) => ({ id: e.id, type: e.type, x: e.x, y: e.y, w: e.w, h: e.h, selected: e.selected, parent: e.parent }))");
  const rootParent = (await ents()).find((e) => e.id === note)?.parent;
  const undo = () => q("window.__desk.engine.docs.undo()");
  const redo = () => q("window.__desk.engine.docs.redo()");
  /** Open the drawer with `type`'s specimen in view; its object's rect on screen. */
  const slide = () => frames(26);   // the slide's 340 ms and a little
  const specimenIn = async (type) => {
    if (!(await q("window.__desk.tray.isOpen()"))) { await q("window.__desk.tray.open()"); await slide(); }
    let sp = (await tray()).specimens.find((x) => x.type === type);
    if (sp === undefined || sp.object.y1 > 780) {
      const all = await q("window.__desk.tray.specimens()");
      const w = all.find((x) => x.type === type);
      await q(`window.__desk.tray.scroll(${Math.max(0, w.y - 60)})`); await frames(3);
      sp = (await tray()).specimens.find((x) => x.type === type);
    }
    return sp.object;
  };
  const frames = (n) => qa(`new Promise((r) => { let i = 0; const f = () => { if (++i >= ${n}) r(true); else requestAnimationFrame(f); }; requestAnimationFrame(f); })`);
  /** Press `type`'s specimen at (u, v) across its object and carry it to `to` in steps; `release` at the end (default). */
  const carryOut = async (type, u, v, to, { release = true, steps = 8 } = {}) => {
    const o = await specimenIn(type);
    const g = [o.x0 + u * (o.x1 - o.x0), o.y0 + v * (o.y1 - o.y0)];
    await mouse("mouseMoved", g[0], g[1]); await mouse("mousePressed", g[0], g[1], { buttons: 1 }); await frames(1);
    for (let i = 1; i <= steps; i++) { await mouse("mouseMoved", g[0] + ((to[0] - g[0]) * i) / steps, g[1] + ((to[1] - g[1]) * i) / steps, { buttons: 1 }); await frames(2); }
    await mouse("mouseMoved", to[0], to[1], { buttons: 1 }); await frames(3);
    if (release) { await mouse("mouseReleased", to[0], to[1], { buttons: 0 }); await frames(6); }
    return g;
  };
  // THE FACES (K5b, live — drawn with the kinds' own desk state, `tray.local`): the note carries its word in its own hand, the print the
  // kind's sample picture, the pad the month of its today — each counted in the specimen's own pixels (K5a's were blank)
  {
    await q("window.__desk.tray.open()"); await settle();
    // the pad's print is the host's raster, tile by tile over frames (S9 shut the drawer long enough for its state to be let go): until none is pending
    const printed = await qa(`(async () => { const t0 = performance.now(); for (;;) { const t = window.__desk.handle.local('calendar')?.tiles(); if (t !== undefined && t.drawn > 0 && t.pending === 0) return t; if (performance.now() - t0 > 6000) return t ?? null; await new Promise((r) => requestAnimationFrame(r)); } })()`, 15000);
    await settle();
    const img = await shot();
    const st = await tray();
    const count = (type, inset, pred) => {
      const o = st.specimens.find((x) => x.type === type)?.object;
      if (o === undefined) return -1;
      let n = 0;
      const x0 = Math.round((o.x0 + inset.l * (o.x1 - o.x0)) * 2); const x1 = Math.round((o.x1 - inset.r * (o.x1 - o.x0)) * 2);
      const y0 = Math.round((o.y0 + inset.t * (o.y1 - o.y0)) * 2); const y1 = Math.round((o.y1 - inset.b * (o.y1 - o.y0)) * 2);
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = (y * img.width + x) * 4; if (pred(img.rgba[i], img.rgba[i + 1], img.rgba[i + 2])) n++; }
      return n;
    };
    const L = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const word = count("desk.note", { l: 0.08, r: 0.08, t: 0.08, b: 0.08 }, (r, g, b) => b > r + 25 && L(r, g, b) < 150);        // the pen's blue ink on the yellow
    const picture = count("desk.photo", { l: 0.12, r: 0.12, t: 0.12, b: 0.12 }, (r, g, b) => b > r + 30);                     // the dusk's blues on the white
    const month = count("desk.calendar", { l: 0.06, r: 0.06, t: 0.16, b: 0.06 }, (r, g, b) => L(r, g, b) < 200);             // the print's ink on the paper (a blank pad has none this dark)
    // over K6b's frame raster queue: the note specimen's word was ASKED as a desk note's first raster is, and RUN (the queue's `shows` is
    // the builder's and the tray's) — none let go, and at rest nothing is asked again
    const qa0 = await q("window.__desk.handle.rasters()");
    await idle(120);
    const qa1 = await q("window.__desk.handle.rasters()");
    check(qa0.ran >= 1 && qa0.dropped === 0 && qa1.ran === qa0.ran && qa1.turns === qa0.turns && qa1.waiting === 0 && qa1.held === 0,
      `the specimens' rasters ride K6b's queue: ${qa0.ran} run, ${qa0.dropped} let go; at rest 120 frames on, ${qa1.ran - qa0.ran} more runs, ${qa1.turns - qa0.turns} turns, ${qa1.waiting} waiting, ${qa1.held} held`);
    check(word > 60 && picture > 2000 && month > 150, `the specimens read as the real objects (live — K5a's were blank): the note's word ${word} px of ink, the print's sample ${picture} px of sky and water, the pad's month ${month} px of print (its tiles ${printed?.drawn ?? "?"} drawn, ${printed?.pending ?? "?"} pending)`);
  }

  // each kind taken: made where it is dropped, the grab point kept, selected, one undo step (undo removes it, redo restores it)
  const TAKEN = ["desk.note", "desk.photo", "desk.notebook", "desk.calendar", "desk.minimat", "desk.board"];
  const takeRows = [];
  for (const type of TAKEN) {
    const before = new Set((await ents()).map((e) => e.id));
    const to = [640, 260];
    await carryOut(type, 0.3, 0.2, to);
    const made = (await ents()).filter((e) => !before.has(e.id));
    const m = made[0];
    const at = m === undefined ? null : [m.x + 0.3 * m.w - to[0], m.y + 0.2 * m.h - to[1]];
    const sel = await q("window.__desk.selection()");
    const madeProps = m === undefined ? null : (await q(`window.__desk.entity(${m.id})?.props ?? null`));
    const shut = (await tray()).facts.open === false;
    const u1 = await undo(); await frames(2);
    const goneAfterUndo = m !== undefined && !(await ents()).some((e) => e.id === m.id || (e.type === type && !before.has(e.id)));
    const r1 = await redo(); await frames(2);
    const back = (await ents()).filter((e) => !before.has(e.id) && e.type === type).length === 1;
    await undo(); await frames(2);
    takeRows.push({ type, n: made.length, made: m?.type, at, selected: m !== undefined && sel.length === 1 && sel[0] === m.id, root: m?.parent === rootParent, shut, u1, goneAfterUndo, r1, back, props: madeProps });
  }
  const snapTol = 12;
  // what one taken is made with (D-K5b.1): not the face — a note blank, a print without a picture (it asks for one), a pad on its today's month
  const propsOf = (type) => takeRows.find((r) => r.type === type)?.props ?? {};
  check(propsOf("desk.note").text === "" && propsOf("desk.photo").blob === "" && propsOf("desk.calendar").month === "",
    `one taken is made with the entry's take, never its face: the note's text "${propsOf("desk.note").text}" (its specimen says hello), the print's picture "${propsOf("desk.photo").blob}" (its specimen shows the sample), the pad's month "${propsOf("desk.calendar").month}" (its today's)`);
  check(takeRows.every((r) => r.n === 1 && r.made === r.type && r.at !== null && Math.abs(r.at[0]) <= snapTol && Math.abs(r.at[1]) <= snapTol && r.selected && r.root && r.shut && r.u1 && r.goneAfterUndo && r.r1 && r.back),
    `each kind taken (press at 0.3, 0.2 of its specimen, dropped at 640,260): made where dropped with the grab point kept (|Δ| ≤ ${snapTol}, the drag's snap — a centre-snap is 20–30 % of the object), selected, the drawer away, ONE undo step (undo removes it, redo restores it): ${takeRows.map((r) => `${r.type.replace("desk.", "")} ${r.at === null ? "—" : r.at.map((x) => x.toFixed(1)).join(",")}${r.n === 1 && r.selected && r.u1 && r.goneAfterUndo && r.r1 && r.back ? "" : ` ✗${JSON.stringify(r)}`}`).join(" · ")}`);

  // the ghost is CORE'S while it is carried: no kind's driver takes it — the print's own carry (its physics) never holds a ghost print
  {
    const before = new Set((await ents()).map((e) => e.id));
    await carryOut("desk.photo", 0.5, 0.5, [600, 250], { release: false });
    await frames(10);
    const held = await q("(() => { const p = window.__desk.handle.local('photo'); return window.__desk.entities().filter((e) => e.type === 'desk.photo').map((e) => ({ id: e.id, lifted: p.lifted(e.id), grabbed: e.grabbed })); })()");
    await mouse("mouseReleased", 600, 250, { buttons: 0 }); await frames(6);
    const made = (await ents()).filter((e) => !before.has(e.id));
    await undo(); await frames(2);
    check(held.length === 1 && held[0].grabbed && !held[0].lifted && made.length === 1,
      `the ghost is core's while it is carried: the print's ghost grabbed by the ordinary drag (${held[0]?.grabbed}), its kind's own carry not holding it (lifted ${held[0]?.lifted}); dropped, one print`);
  }

  // the lift: past 4 px the copy lifts (×1.06 of its specimen, under the grab point), the specimen stays hung; the drawer slides away as it leaves
  {
    const o = await specimenIn("desk.note");
    const spec0 = (await tray()).specimens.find((x) => x.type === "desk.note");
    const g = [o.x0 + 0.5 * (o.x1 - o.x0), o.y0 + 0.5 * (o.y1 - o.y0)];
    // the press to the move past the slop in as few round trips as the rows allow (K-H): the desk's long press is 500 ms of its clamped
    // clock, and at load 337 (and 8× throttle) a frame waited after the press, three after the move within the slop and a round trip
    // for the read handed the press that clock first — the copy never lifted. The state within the slop is read IN THE PAGE, two
    // frames after that move was taken, in the same evaluate
    await mouse("mouseMoved", g[0], g[1]); await mouse("mousePressed", g[0], g[1], { buttons: 1 });
    await mouse("mouseMoved", g[0] + 2, g[1] - 2, { buttons: 1 });
    const within = await qa("new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r({ ...window.__desk.tray.state(), facts: window.__desk.tray.facts() }))))");
    await mouse("mouseMoved", g[0] + 20, g[1] - 30, { buttons: 1 }); await frames(30);
    const lifted = await tray();
    const copy = lifted.carried.find((c) => c.phase === "lift");
    const spec1 = lifted.specimens.find((x) => x.type === "desk.note");
    const cw = copy === undefined ? 0 : copy.screen.x1 - copy.screen.x0;
    check(within.carried.length === 0 && within.facts.take === "" && copy !== undefined && lifted.facts.take === "desk.note" && Math.abs(cw / (o.x1 - o.x0) - 1.06) < 0.002
      && Math.abs(copy.screen.x0 + 0.5 * cw - (g[0] + 20)) < 0.5 && JSON.stringify(spec1?.object) === JSON.stringify(spec0?.object) && lifted.facts.open === true,
      `within the slop nothing lifts (${within.carried.length} carried); past it the copy lifts at × ${(cw / (o.x1 - o.x0)).toFixed(4)} of its specimen under the grab point, the specimen still hung where it was, the drawer open`);
    // THE HAND-OFF: out through the top in one move, then still — the frame that hands it and the first the ghost is drawn coincide
    const top = lifted.frame.y;
    await front();
    // the trace RUNNING before the move (K-H): K5b sent its evaluate first, but CDP orders its own messages only — the input reaches the
    // page's main thread by another road, and at load 290 the move landed first and the handing frame went unsampled (−1). So the
    // sampler starts, the rig waits in the page for its FIRST sample, and only then moves
    await qa("(() => { const out = (window.__trayTrace = []); let shut = -1; const f = () => { const s = window.__desk.tray.state(); const facts = window.__desk.tray.facts(); out.push({ carried: s.carried, facts, p: s.p }); if (facts.open === false && shut < 0) shut = out.length; if ((shut < 0 || out.length - shut < 40) && out.length < 600) requestAnimationFrame(f); }; requestAnimationFrame(f); return 0; })()");
    await qa("new Promise((r) => { const f = () => (window.__trayTrace.length > 0 ? r(0) : requestAnimationFrame(f)); f(); })");
    await mouse("mouseMoved", g[0] + 20, top - 24, { buttons: 1 });
    // until 40 frames after the drawer shut (600 at most): the frames before the move — a few, or forty at load 337 — are "lift"
    const trace = await qa("new Promise((r) => { const f = () => { const o = window.__trayTrace; const shut = o.findIndex((x) => x.facts.open === false); if (o.length >= 600 || (shut >= 0 && o.length - shut >= 40)) r(o); else requestAnimationFrame(f); }; f(); })", 60000);
    const i0 = trace.findIndex((t) => t.carried.some((c) => c.phase === "handing"));
    const i1 = trace.findIndex((t) => t.carried.some((c) => c.phase === "grow"));
    const hand = i0 >= 0 ? trace[i0].carried.find((c) => c.phase === "handing") : undefined;
    const grow0 = i1 >= 0 ? trace[i1].carried.find((c) => c.phase === "grow") : undefined;
    const pop = hand === undefined || grow0 === undefined ? Number.POSITIVE_INFINITY : Math.max(...["x0", "y0", "x1", "y1"].map((k) => Math.abs(hand.screen[k] - grow0.screen[k])));
    const lastGrow = [...trace].reverse().find((t) => t.carried.some((c) => c.phase === "grow"));
    const grownW = lastGrow === undefined ? 0 : (() => { const c = lastGrow.carried.find((x) => x.phase === "grow"); return c.screen.x1 - c.screen.x0; })();
    const shutAt = trace.findIndex((t) => t.facts.open === false);
    const pEnd = trace[trace.length - 1].p;
    const handedTo = trace[trace.length - 1].carried.length === 0;
    check(i0 >= 0 && i1 === i0 + 1 && pop < 0.5 && shutAt >= 0 && shutAt <= i0 && pEnd === 0 && handedTo && Math.abs(grownW - 200) < 1,
      `the hand-off: the drawer shut as it left (frame ${shutAt}), the copy held for the frame that handed it (${i0}) and the ghost drawn the next (${i1}) on the SAME rect — |Δ| ${pop.toFixed(4)} px (no pop); it grew to its own ${grownW.toFixed(1)} px as the drawer went (p ${pEnd}), then the desk drew it`);
    await mouse("mouseReleased", g[0] + 20, top - 24, { buttons: 0 }); await frames(6);
    await undo(); await frames(2);
  }

  // the ways back — Esc mid-drag, a release back over the drawer, a release inside it: NOTHING in undo (a sentinel spawned just before
  // is what one undo takes back), no object made, and the ghost flying HOME shrinking to nothing
  /** The carried poses, one sample a frame, IN THE PAGE from BEFORE `act` (K-H): the sampler runs (its first sample waited for), then the act
   *  — a release, Esc — then frames until the hand is empty for 10 (600 at most). the trace used to start AFTER the act's round trip, and at
   *  load 400 the glide back was over but for its last frame ("inside": 1 frame of "back" sampled) */
  const traceAround = async (act) => {
    await qa("(() => { const out = (window.__carryTrace = []); let empty = 0; const f = () => { const s = window.__desk.tray.state(); out.push({ carried: s.carried, facts: window.__desk.tray.facts(), p: s.p }); empty = s.carried.length === 0 ? empty + 1 : 0; if (!(window.__carryActed && empty >= 10) && out.length < 600) requestAnimationFrame(f); else window.__carryDone = true; }; window.__carryActed = false; window.__carryDone = false; requestAnimationFrame(f); return 0; })()");
    await qa("new Promise((r) => { const f = () => (window.__carryTrace.length > 0 ? r(0) : requestAnimationFrame(f)); f(); })");
    await act();
    await q("window.__carryActed = true");
    return qa("new Promise((r) => { const f = () => (window.__carryDone ? r(window.__carryTrace) : requestAnimationFrame(f)); f(); })", 60000);
  };
  /** The drawer's slide `p` the renderer last drew when the next pointerup reaches the page — the pose the tick after tests the release
   *  against (no frame is drawn between the event and that tick's step); read by `pAtUp()` once the release is in */
  const armPAtUp = () => q("window.__pAtUp = null; window.__yAtUp = null; window.addEventListener('pointerup', () => { const t = window.__desk.tray.state(); window.__pAtUp = t.p; window.__yAtUp = t.frame?.y ?? null; }, { capture: true, once: true }); 0");
  const pAtUp = () => q("window.__pAtUp");
  const yAtUp = () => q("window.__yAtUp");
  const wayBack = async (how) => {
    const sentinel = await q("window.__desk.spawn('desk.note', { seed: 5 }, { x: 1000, y: 150 })");
    await frames(2);
    const before = new Set((await ents()).map((e) => e.id));
    let homes = [];
    let p = null;
    let late = 0;
    if (how === "inside") {
      await carryOut("desk.note", 0.5, 0.5, [700, 600], { release: false, steps: 4 });
      homes = await traceAround(() => mouse("mouseReleased", 700, 600, { buttons: 0 }));
    } else if (how === "esc") {
      await carryOut("desk.note", 0.5, 0.5, [600, 250], { release: false });
      homes = await traceAround(() => key("Escape", "Escape", 27)); await mouse("mouseReleased", 600, 250, { buttons: 0 });
    } else {
      // RE-TIMED at K9 (S2): a release is tested against the drawer AS DRAWN, so this one must land while the drawer still slides
      // away — lifted, out past the open top in ONE move (the hand-off), and straight back down onto the view's last row, released
      // there. Shut, the drawer lies below the view with its shadows (design-018 §5), so it covers that row for the first ~130 ms of
      // its slide away, not the whole of it: the slide's `p` and the drawer's top at the release are read in the page, and a release
      // the host could not land while the drawer still covered the row (made, as it should be: the next row's case) is undone and
      // tried again, ≤ 3
      for (let tries = 1; ; tries++) {
        const o = await specimenIn("desk.note");
        const g = [(o.x0 + o.x1) / 2, (o.y0 + o.y1) / 2];
        await mouse("mouseMoved", g[0], g[1]); await mouse("mousePressed", g[0], g[1], { buttons: 1 }); await frames(1);
        await mouse("mouseMoved", g[0] + 8, g[1], { buttons: 1 }); await frames(2);
        const h0 = await q("window.__desk.tray.facts().handed");
        await mouse("mouseMoved", 300, 430, { buttons: 1 });
        await qa(`new Promise((r) => { const t0 = performance.now(); const f = () => (window.__desk.tray.facts().handed > ${h0} || performance.now() - t0 > 4000 ? r(0) : requestAnimationFrame(f)); f(); })`);
        await armPAtUp();
        homes = await traceAround(async () => { await mouse("mouseMoved", 300, 799, { buttons: 1 }); await mouse("mouseReleased", 300, 799, { buttons: 0 }); });
        p = await pAtUp();
        const top = await yAtUp();
        await frames(4);
        const landed = (await ents()).filter((e) => !before.has(e.id));
        if (!((p === 0 || top === null || top > 799) && landed.length > 0 && tries < 3)) break;
        late += 1;
        await undo(); await frames(2);
      }
    }
    await frames(4);
    const made = (await ents()).filter((e) => !before.has(e.id));
    const phases = homes.map((t) => t.carried.map((c) => `${c.phase}:${(c.screen.x1 - c.screen.x0).toFixed(0)}`).join("|"));
    const home = homes.flatMap((t) => t.carried.filter((c) => c.phase === (how === "inside" ? "back" : "home")));
    const widths = home.map((c) => c.screen.x1 - c.screen.x0);
    const shrank = how === "inside" ? widths.length > 3 : widths.length > 3 && widths.every((w, i) => i === 0 || w <= widths[i - 1] + 1e-6) && widths[widths.length - 1] < 8;
    const u = await undo(); await frames(2);
    const sentinelGone = !(await ents()).some((e) => e.id === sentinel);
    await redo(); await frames(2);
    const r = await undo(); await frames(2);   // tidy: the sentinel away again
    return { how, made: made.length, shrank, first: widths[0], last: widths[widths.length - 1], frames: widths.length, u, sentinelGone, r, phases: phases.slice(0, 3), p, late };
  };
  const backs = [await wayBack("esc"), await wayBack("over"), await wayBack("inside")];
  const backOk = (b) => b.made === 0 && b.shrank && b.u && b.sentinelGone && (b.how !== "over" || b.p > 0);
  check(backs.every(backOk),
    `the ways back make nothing and leave nothing in undo (one undo takes back the sentinel spawned before): ${backs.map((b) => `${b.how} — ${b.how === "inside" ? "the copy glided back onto its specimen" : "the ghost flew home shrinking"} ${b.first?.toFixed(0)} → ${b.last?.toFixed(1)} px over ${b.frames} frames${b.how === "over" ? ` (released over the drawer as drawn, p ${b.p?.toFixed(3)} of its slide away${b.late > 0 ? `; ${b.late} release(s) the host landed after it shut, made and undone` : ""})` : ""}${backOk(b) ? "" : ` ✗${JSON.stringify(b)}`}`).join(" · ")}`);

  // K9 (S2): once the drawer has slid shut, where it stood open is the DESK's — the 44 % of the view it covers open refused every
  // drop before (its open rect was tested, no pixel of it drawn): a take carried there and released is made there, selected, one undo
  {
    const before = new Set((await ents()).map((e) => e.id));
    await carryOut("desk.note", 0.5, 0.5, [600, 250], { release: false });
    const shut = await qa("new Promise((r) => { const t0 = performance.now(); const f = () => { const p = window.__desk.tray.state().p; if (p === 0 || performance.now() - t0 > 4000) r(p); else requestAnimationFrame(f); }; f(); })");
    for (let i = 1; i <= 4; i++) { await mouse("mouseMoved", 600 - (i * 300) / 4, 250 + (i * 428) / 4, { buttons: 1 }); await frames(2); }
    await armPAtUp();
    await mouse("mouseReleased", 300, 678, { buttons: 0 }); await frames(20);   // a CANCELLED drop's ghost has flown home by then (12 frames)
    const p = await pAtUp();
    const made = (await ents()).filter((e) => !before.has(e.id));
    const m = made[0];
    const sel = await q("window.__desk.selection()");
    const at = m === undefined ? null : [m.x + 0.5 * m.w - 300, m.y + 0.5 * m.h - 678];
    const u = await undo(); await frames(2);
    const gone = m !== undefined && !(await ents()).some((e) => e.id === m.id);
    check(shut === 0 && p === 0 && made.length === 1 && m.type === "desk.note" && Math.hypot(at[0], at[1]) < 1.5 && sel.length === 1 && sel[0] === m.id && u && gone,
      `a take dropped where the drawer stood open, once it has slid shut (p ${shut} at the drop, ${p} at the release), is made THERE: ${made.length} ${m?.type ?? "—"} at (${m?.x}, ${m?.y}), its grab point ${at === null ? "—" : Math.hypot(at[0], at[1]).toFixed(2)} px from the release, selected ${m !== undefined && sel.length === 1 && sel[0] === m.id}, one undo takes it (${u && gone})`);
  }

  // into a mini mat by the kinds' rules: a note goes inside it; a notebook (`drop: never`) lands on the desk over it
  {
    const mm = await q("window.__desk.spawn('desk.minimat', { name: 'Inbox' }, { x: 760, y: 230 })");
    await frames(2);
    const before = new Set((await ents()).map((e) => e.id));
    await carryOut("desk.note", 0.5, 0.5, [760, 230]);
    const noteIn = (await ents()).find((e) => !before.has(e.id) && e.type === "desk.note");
    await undo(); await frames(2);
    await carryOut("desk.notebook", 0.5, 0.5, [760, 230]);
    const bookOn = (await ents()).find((e) => !before.has(e.id) && e.type === "desk.notebook");
    await undo(); await frames(2);
    await undo(); await frames(2);   // the mini mat
    check(noteIn !== undefined && noteIn.parent === mm && bookOn !== undefined && bookOn.parent === rootParent,
      `into a mini mat by the kinds' rules: a note dropped on it went inside (its parent ${noteIn?.parent}, the mat ${mm}); a notebook did not — drop: never (its parent ${bookOn?.parent}, the desk's ${rootParent})`);
  }

  // K9 law #1 (design-017 §4 "anywhere else — inert"): a click on a SPECIMEN hanging over a note under the drawer changes nothing under
  // it — the editor lent to nothing (the desk's tap reads the pick, which answers the bare canvas while the drawer is out), nothing
  // selected, the drawer still open; shut, the same click lends the editor to that note (control). The note is spawned under the note
  // specimen's centre (world from screen through the camera), and undone after.
  {
    const o = await specimenIn("desk.note");
    const c = [(o.x0 + o.x1) / 2, (o.y0 + o.y1) / 2];
    await q("window.__desk.tray.close()"); await settle();
    const cam = await q("window.__desk.camera()");
    const underNote = await q(`window.__desk.spawn('desk.note', { seed: 9 }, { x: ${cam.x + c[0] / cam.zoom}, y: ${cam.y + c[1] / cam.zoom} })`);
    await frames(2);
    await q("window.__desk.tray.open()"); await slide(); await settle();
    await click(c[0], c[1]); await frames(4);
    const lent = await q("window.__desk.note.editing()");
    const sel = await q("window.__desk.selection()");
    const stillOpen = (await tray()).facts.open;
    await q("window.__desk.tray.close()"); await settle();
    await click(c[0], c[1]); await frames(4);
    const lentShut = await q("window.__desk.note.editing()");
    await q("window.__desk.handle.editor().blur()"); await frames(2);
    await q("window.__desk.engine.ops.setSelection([], 'replace')");
    await undo(); await frames(2);   // the note away again
    check(lent === -1 && sel.length === 0 && stillOpen === true && lentShut === underNote,
      `inert under the drawer: a click on the note specimen over a note lent the editor to ${lent} (−1: nothing), selected ${sel.length}, the drawer ${stillOpen ? "still open" : "SHUT"}; shut, the same click lends it to that note (${lentShut}, the note ${underNote})`);
  }

  // K9 S3: the app's OWN keys are quiet on the inert desk (design-017 §4) — with the drawer out, `w` `m` `b` ⇧W ⇧C make nothing, Tab and
  // ⇧Tab walk the selection nowhere, ⇧→ nudges the selected note nowhere, while `d` (the theme — no touch on the desk) stays live; shut,
  // `w` makes a note (control). And in HAND: ⇧→ moves the held notebook nowhere; put down and selected, it moves one lattice cell (control).
  {
    const keyMod = async (k, code, vk, modifiers = 0) => { await front(); await tab.send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, windowsVirtualKeyCode: vk, modifiers, text: k.length === 1 ? k : undefined }); await tab.send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: vk, modifiers }); };
    await q(`window.__desk.engine.ops.setSelection([${note}], 'replace')`); await frames(2);
    const n0 = (await ents()).length;
    const p0 = (await ents()).find((e) => e.id === note);
    await q("window.__desk.tray.open()"); await slide(); await settle();
    const theme0 = await q("window.__desk.theme()");
    for (const [k, code, vk, mods] of [["w", "KeyW", 87, 0], ["m", "KeyM", 77, 0], ["b", "KeyB", 66, 0], ["W", "KeyW", 87, 8], ["C", "KeyC", 67, 8], ["Tab", "Tab", 9, 0], ["Tab", "Tab", 9, 8], ["ArrowRight", "ArrowRight", 39, 8], ["d", "KeyD", 68, 0]]) await keyMod(k, code, vk, mods);
    await frames(4);
    const n1 = (await ents()).length;
    const p1 = (await ents()).find((e) => e.id === note);
    const sel1 = await q("window.__desk.selection()");
    const theme1 = await q("window.__desk.theme()");
    await keyMod("d", "KeyD", 68); await frames(2);   // the theme back
    const stillOpen = (await tray()).facts.open;
    await q("window.__desk.tray.close()"); await settle();
    await keyMod("w", "KeyW", 87); await frames(4);
    const n2 = (await ents()).length;
    await undo(); await frames(2);   // the control's note away
    check(n1 === n0 && p1.x === p0.x && p1.y === p0.y && sel1.length === 1 && sel1[0] === note && theme1 !== theme0 && stillOpen === true && n2 === n0 + 1,
      `the app's keys on the inert desk: w m b ⇧W ⇧C Tab ⇧Tab ⇧→ under the open drawer made ${n1 - n0} objects, moved the selected note (${p0.x},${p0.y}) → (${p1.x},${p1.y}), left the selection ${JSON.stringify(sel1)} (the note ${note}), the drawer ${stillOpen ? "open" : "SHUT"}; \`d\` stayed live (${theme0} → ${theme1}); shut, \`w\` made ${n2 - n0} (control)`);
    const book = await q("window.__desk.spawn('desk.notebook', { seed: 5, angle: 0 }, { x: 900, y: 300 })"); await frames(2);
    const b0 = (await ents()).find((e) => e.id === book);
    await q(`window.__desk.open(${book})`); await settle();
    const inHand = (await q("window.__desk.hand()")) !== null;
    await keyMod("ArrowRight", "ArrowRight", 39, 8); await frames(4);
    const b1 = (await ents()).find((e) => e.id === book);
    await q("window.__desk.putDown()"); await settle();
    await q(`window.__desk.engine.ops.setSelection([${book}], 'replace')`); await frames(2);
    await keyMod("ArrowRight", "ArrowRight", 39, 8); await frames(4);
    const b2 = (await ents()).find((e) => e.id === book);
    await undo(); await frames(2); await undo(); await frames(2);   // the nudge, then the notebook
    await q("window.__desk.engine.ops.setSelection([], 'replace')"); await frames(2);
    check(inHand && b1.x === b0.x && b1.y === b0.y && b2.x === b0.x + 20 && b2.y === b0.y,
      `…and in hand (held ${inHand}): ⇧→ moved the held notebook (${b0.x},${b0.y}) → (${b1.x},${b1.y}); put down and selected, ⇧→ moved it to (${b2.x},${b2.y}) — one lattice cell right (control)`);
    // …and K8b's clock keys, on the page that registers the plugin (`rig.html?plugins` — this page registers none, so `c` finds no type
    // here): with the drawer out `c` sets no clock down and `s` flips no seconds hand; shut, `c` makes one and `s` flips it (control);
    // a notebook in hand, `s` flips nothing
    {
      const plug = await openTab(chrome.port, `http://127.0.0.1:${PORT}/apps/desk/dist/rig.html?plugins=1`);
      for (let i = 0; i < 200; i++) { await plug.send("Page.bringToFront"); if (await plug.evaluate("typeof window.__desk === 'object' && window.__desk.state.ready", { timeoutMs: 20000 })) break; await sleep(200); }
      const pq = (js) => plug.evaluate(js, { timeoutMs: 20000 });
      const psettle = () => plug.evaluate("window.__desk.settle(4000)", { awaitPromise: true, timeoutMs: 30000 });
      const pf = (n) => plug.evaluate(`new Promise((r) => { let i = 0; const f = () => { if (++i >= ${n}) r(true); else requestAnimationFrame(f); }; requestAnimationFrame(f); })`, { awaitPromise: true, timeoutMs: 20000 });
      const pkey = async (k, code, vk) => { await plug.send("Page.bringToFront"); await plug.send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, windowsVirtualKeyCode: vk, text: k }); await plug.send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: vk }); };
      const CLOCK = "ice-examples.desk-clock";
      const clocks = () => pq(`window.__desk.entities().filter((e) => e.type === ${JSON.stringify(CLOCK)}).map((e) => ({ id: e.id, selected: e.selected, seconds: e.props.seconds }))`);
      await pq("window.__desk.ambient('still')"); await psettle();
      await plug.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 600, y: 300, button: "none" });
      await pkey("c", "KeyC", 67); await pf(4);
      const made = await clocks();   // shut: one clock, its seconds hand on
      await pq(`window.__desk.engine.ops.setSelection([${made[0]?.id ?? 0}], 'replace')`); await pf(2);
      await pq("window.__desk.tray.open()"); await psettle();
      await pkey("c", "KeyC", 67); await pkey("s", "KeyS", 83); await pf(4);
      const under = await clocks();   // the drawer out: still one, its seconds untouched
      await pq("window.__desk.tray.close()"); await psettle();
      await pkey("s", "KeyS", 83); await pf(4);
      const shut = await clocks();    // shut: flipped
      const book2 = await pq("window.__desk.spawn('desk.notebook', { seed: 5, angle: 0 }, { x: 900, y: 300 })"); await pf(2);
      await pq(`window.__desk.open(${book2})`); await psettle();
      const heldNow = (await pq("window.__desk.hand()")) !== null;
      await pkey("s", "KeyS", 83); await pf(4);
      const held2 = await clocks();   // in hand: untouched
      await pq("window.__desk.putDown()"); await psettle();
      const pfaults = await pq("window.__desk.faults ?? []");
      await plug.close?.();
      await front();
      check(made.length === 1 && made[0].seconds === true && under.length === 1 && under[0].seconds === true && shut.length === 1 && shut[0].seconds === false && heldNow && held2[0]?.seconds === false && pfaults.length === 0,
        `…and K8b's clock keys on the plugin page: shut, \`c\` set ${made.length} clock down (seconds ${made[0]?.seconds}); the drawer out, \`c\` made ${under.length - made.length} more and \`s\` left its seconds ${under[0]?.seconds}; shut, \`s\` flipped it to ${shut[0]?.seconds} (control); a notebook in hand (${heldNow}, the clock ${held2[0]?.selected ? "still" : "no longer"} selected), \`s\` left it ${held2[0]?.seconds}; faults ${pfaults.length}`);
    }
  }

  // K9 (S13, law #3): the drawer hangs what the CURRENT frame takes — inside an entered mini mat, exactly the kinds its ingress takes
  // (the placement authority a take's commit asks, read beside it); K5's drawer hung every kind there, and a refused one's take died at
  // the hand-off with a console warning. Back at the desk, every kind again
  {
    await q("window.__desk.tray.close()"); await settle();
    const hungAtDesk = (await q("window.__desk.tray.specimens()")).map((s) => s.type).sort();
    const mm = await q("window.__desk.spawn('desk.minimat', { name: 'In' }, { x: 600, y: 300 })");
    await frames(2);
    await q(`window.__desk.engine.ops.enterContainer(${mm}, { transition: "none" })`); await settle();
    await q("window.__desk.tray.open()"); await settle();
    const inside = (await q("window.__desk.tray.specimens()")).map((s) => s.type).sort();
    const takes = await q(`${JSON.stringify(hungAtDesk)}.filter((t) => window.__desk.engine.placement.canIngress(t, ${mm}).ok)`);
    await q("window.__desk.tray.close()"); await settle();
    await q(`window.__desk.engine.ops.exitContainer({ transition: "none" })`); await settle();
    await q("window.__desk.tray.open()"); await settle();
    const back = (await q("window.__desk.tray.specimens()")).map((s) => s.type).sort();
    await q("window.__desk.tray.close()"); await settle();
    await undo(); await frames(2);   // the mini mat
    const refused = hungAtDesk.filter((t) => !takes.includes(t));
    check(refused.length > 0 && JSON.stringify(inside) === JSON.stringify([...takes].sort()) && JSON.stringify(back) === JSON.stringify(hungAtDesk),
      `inside an entered mini mat the drawer hangs what it takes — ${inside.join(", ")} — and not ${refused.join(", ")} (refused by its ingress); back at the desk all ${back.length} again`);
    await q("window.__desk.tray.open()"); await settle();
  }
  // (a) THE FADE (design-018 §4, §8 R1 a): each kind's specimen — the clock included (this page registers the plugin) — placed with its
  //     top 12 px above the face's top edge (the band pinned: a still's shown scroll) fades in across the band F below that edge, as the
  //     face's feather has every kind's own `portal_cover` (and the layered kinds' composite) do. Its visibility per device row is read
  //     pixel by pixel against the SAME content fully shown — the board a pitch further on, 80 device px down (the face is the same
  //     pixels moved; a hole in either frame is skipped: it shows the desk) — (frame − bare) ÷ (frame′ − bare′), the row's median:
  //     nothing above the edge, the band's four quarters rising on the smoothstep's (0.05 · 0.32 · 0.68 · 0.95), no row a step
  {
    const ft = await openTab(chrome.port, `http://127.0.0.1:${PORT}/apps/desk/dist/rig.html?plugins=1`);
    await ft.send("Page.enable");
    await ft.send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 800, deviceScaleFactor: 2, mobile: false });
    for (let i = 0; i < 200; i++) { await ft.send("Page.bringToFront"); if (await ft.evaluate("typeof window.__desk === 'object' && window.__desk.state.ready", { timeoutMs: 20000 })) break; await sleep(200); }
    const fq = async (js) => { await ft.send("Page.bringToFront"); return ft.evaluate(js, { timeoutMs: 20000 }); };
    const fsettle = async () => { await ft.send("Page.bringToFront"); return ft.evaluate("window.__desk.settle(4000)", { awaitPromise: true, timeoutMs: 30000 }); };
    const fshot = async () => { await ft.send("Page.bringToFront"); const { data } = await ft.send("Page.captureScreenshot", { format: "png", optimizeForSpeed: true }); return decodePng(Buffer.from(data, "base64")); };
    await fq("window.__desk.ambient('still'); window.__desk.setTheme('light'); window.__desk.tray.open(); window.__desk.tray.scroll(0)");
    // a pinned slide never moves (a still), so the drawer is pinned open: p 1
    await fq("window.__desk.tray.pin({ p: 1, band: 0 })"); await fsettle(); await fsettle();
    const fr = (await fq("window.__desk.tray.state()")).frame;
    const faceTop = fr.y + 1.5;   // the face's top edge, inside the arris (tray/drawer.ts DRAWER.arris)
    const F = 28;                 // DRAWER.fade
    const Y0 = Math.round(faceTop * 2);
    const drawnOf = async (type) => (await fq("window.__desk.tray.state()")).specimens.find((q) => q.type === type)?.object;
    const frames2 = async (band) => {
      await fq(`window.__desk.tray.pin({ p: 1, band: ${band} })`); await fsettle();
      const A = await fshot();
      await fq(`window.__desk.tray.pin({ p: 1, band: ${band}, bare: true })`); await fsettle();
      return [A, await fshot()];
    };
    const ramp = (t) => { const u = Math.min(Math.max(t, 0), 1); return u * u * (3 - 2 * u); };
    const fades = [];
    for (const s of await fq("window.__desk.tray.specimens()")) {
      // the shown scroll that lays the object's top 12 px above the face's top edge: from its hang on the board, then its object as drawn
      let want = s.y + fr.y - faceTop + 12;
      await fq(`window.__desk.tray.pin({ p: 1, band: ${want} })`); await fsettle();
      const o0 = await drawnOf(s.type);
      if (o0 === undefined) { fades.push({ type: s.type, missing: true }); continue; }
      want += o0.y0 - (faceTop - 12);
      await fq(`window.__desk.tray.pin({ p: 1, band: ${want} })`); await fsettle();
      const o = await drawnOf(s.type);
      const [A, B] = await frames2(want);
      const [A2, B2] = await frames2(want - 40);
      const x0 = Math.ceil((o.x0 + 4) * 2);
      const x1 = Math.floor((o.x1 - 4) * 2);
      let above = 0;
      for (let y = Y0 - 8; y < Y0 - 1; y++) for (let x = x0; x < x1; x += 2) above = Math.max(above, Math.abs(lum(A, x, y) - lum(B, x, y)));
      const vis = [];
      for (let y = Y0; y < Y0 + 2 * F; y++) {
        const r = [];
        for (let x = x0; x < x1; x += 2) {
          if (!onFace(fr, x, y, want) || !onFace(fr, x, y + 80, want - 40)) continue;
          const den = lum(A2, x, y + 80) - lum(B2, x, y + 80);
          if (Math.abs(den) >= 16) r.push((lum(A, x, y) - lum(B, x, y)) / den);
        }
        r.sort((a, b) => a - b);
        vis.push(r.length >= 6 ? r[r.length >> 1] : Number.NaN);
      }
      const quarter = [0, 1, 2, 3].map((k) => { const v = vis.slice((k * F) / 2, ((k + 1) * F) / 2).filter(Number.isFinite); return v.reduce((a, b) => a + b, 0) / Math.max(v.length, 1); });
      const want4 = [0, 1, 2, 3].map((k) => { let m = 0; for (let i = 0; i < F / 2; i++) m += ramp(((k * F) / 2 + i + 0.5) / (2 * F)) / (F / 2); return m; });
      // the steepest rise per row over 4 rows (a median row of a 3D kind seen through the desk eye is noisier; a hard clip rises 25 %/row)
      let steep = 0; for (let i = 4; i < vis.length; i++) if (Number.isFinite(vis[i]) && Number.isFinite(vis[i - 4])) steep = Math.max(steep, (vis[i] - vis[i - 4]) / 4);
      fades.push({ type: s.type, above, quarter, off: Math.max(...quarter.map((v, k) => Math.abs(v - want4[k]))), steep, rows: vis.filter(Number.isFinite).length });
    }
    // …and the TAGS and the ACCESSORIES take the same ramp (in the marks' tag draw, in `tray_accessory`): the photo's tag, then its
    // clip, laid across the band (its centre 8 px below the edge) — the rows 1…15 px below the edge, read as above, against the ramp
    const partRamp = async (type, locate) => {
      await fq("window.__desk.tray.pin({ p: 1, band: 0 })"); await fsettle();
      const st0 = await fq("window.__desk.tray.state()");
      const at = locate(st0);
      if (at === null) return null;
      const band = at.y - (faceTop + 8);
      const [A, B] = await frames2(band);
      const [A2, B2] = await frames2(band - 40);
      const x0 = Math.round((at.x - at.hw) * 2);
      const x1 = Math.round((at.x + at.hw) * 2);
      const got = [];
      const exp = [];
      for (let y = Y0 + 2; y < Y0 + 30; y++) {
        const r = [];
        for (let x = x0; x <= x1; x++) {
          if (!onFace(fr, x, y, band) || !onFace(fr, x, y + 80, band - 40)) continue;
          const den = lum(A2, x, y + 80) - lum(B2, x, y + 80);
          if (Math.abs(den) >= 16) r.push((lum(A, x, y) - lum(B, x, y)) / den);
        }
        if (r.length < 3) continue;
        r.sort((m, n) => m - n);
        got.push(r[r.length >> 1]);
        exp.push(ramp((y - Y0 + 0.5) / (2 * F)));
      }
      const mean = (v) => v.reduce((m, n) => m + n, 0) / Math.max(v.length, 1);
      return { type, rows: got.length, got: mean(got), want: mean(exp) };
    };
    const P = 40;
    const tagFade = await partRamp("desk.photo", (st) => { const sp = st.specimens.find((q) => q.type === "desk.photo"); return sp === undefined ? null : { x: (sp.screen.x0 + sp.screen.x1) / 2, y: sp.screen.y1 + (sp.accessory === "shelf" ? 0.24 * P : 0) + 0.45 * P, hw: 12 }; });
    const accFade = await partRamp("desk.photo", (st) => { const sp = st.specimens.find((q) => q.type === "desk.photo"); const peg = sp?.pegs[0]; return peg === undefined ? null : { x: peg[0], y: peg[1], hw: 9 }; });   // the clip's body either side of its hole
    const partOk = (r) => r !== null && r.rows >= 8 && Math.abs(r.got - r.want) < 0.15;
    await fq("window.__desk.tray.pin(null)");
    await ft.close?.();
    const fadeOk = (r) => !r.missing && r.above < 1 && r.rows >= 40 && r.quarter[0] < r.quarter[1] && r.quarter[1] < r.quarter[2] && r.quarter[2] < r.quarter[3] && r.off < 0.12 && r.steep < 0.07;
    check(fades.length >= 7 && fades.some((r) => r.type === "ice-examples.desk-clock") && fades.every(fadeOk) && partOk(tagFade) && partOk(accFade),
      `the fade: each kind straddling the top edge fades in over the ${F} px below it on the smoothstep — ${fades.map((r) => (r.missing ? `${r.type} not drawn` : `${r.type.replace(/^.*\./, "")} ${r.quarter.map((v) => v.toFixed(2)).join("·")} (off ${r.off.toFixed(2)}, steepest ${(r.steep * 100).toFixed(1)} %/row, above ${r.above.toFixed(0)})`)).join(" · ")} — its quarters of the same content shown whole; the print's tag ${tagFade?.got.toFixed(2)} and its clip ${accFade?.got.toFixed(2)} across the band's first 15 px (the ramp there ${tagFade?.want.toFixed(2)}, ${accFade?.want.toFixed(2)}; ${tagFade?.rows}, ${accFade?.rows} rows)`);
  }
  await q("window.__desk.tray.close()"); await settle();
  const restAfter = await idle(240);
  check(restAfter === 0, `at rest after all of it, the drawer shut: ${restAfter} submits over 240 frames`);
  await q("window.__desk.tray.open()"); await settle();
  const restAfterOpen = await idle(120);
  check(restAfterOpen === 0, `…and open: ${restAfterOpen} submits over 120 frames`);
  await q("window.__desk.tray.close()"); await settle();

  logs.push(...(await faultsOf(tab)));
  if (logs.length) console.log(`page errors:\n  ${logs.slice(0, 6).join("\n  ")}`);
  check(logs.length === 0, "no page errors");
  console.log(`\n${pass} passed, ${failN} failed · ${((Date.now() - t0) / 1000).toFixed(1)} s`);
} catch (e) { console.log("THREW:", String(e.stack ?? e)); failN++; }
finally { await cleanup(); }
process.exit(failN ? 1 : 0);
