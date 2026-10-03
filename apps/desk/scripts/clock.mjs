// rig:clock — A THIRD-PARTY KIND ON THE DESK (design-016 K8b · K-L2): the desk clock (examples/desk-clock, its own package on the
// published entries alone) does what a built-in does, in the desk the product runs — on `rig.html?plugins` (the rigs' page registers the
// app's plugin kinds when asked; D-K8b.2). The rows:
//   1. `c` sets one down at the pointer, selected, drawn by its own kind;
//   2. its hands stand at the right angles for a PINNED time — read back from its record (`handle.local("desk-clock").shown`) AND
//      from the PIXELS (rings sampled round its arbor: the dark hands and the red seconds hand found where the law puts them);
//   3. THE REGISTERED WAKE: at rest with its seconds hand, a frame (a submit) at each wall-clock second and NONE between — every submit
//      timed by an in-page sampler started before the window; the kind's `due` is the next second, read in one evaluate;
//   4. without its seconds hand, the kind is due at the next MINUTE, and over 60 s the desk submits once;
//   5. its menu act (its own glyph, in the selection menu) flips the seconds hand — one undo step, ⌘Z and ⇧⌘Z walk it;
//   6. picked by its ROUND face: a press on the rect's corner is the mat's, inside the case the clock's;
//   7. picked up, it OPENS: the held bar carries its own tools with its own glyphs; a held key sets it; put down;
//   8. it rides INTO a mini mat (dropped over the face) and, far away, the face draws it as its chip (a disc of its dial);
//   9. taken off the pegboard tray: its specimen dragged out makes one, selected, showing the desk's time; one undo takes it back;
//  10. two tabs in a room agree on its props;
//  11–15. WHEN A KIND BREAKS (petition I24) — on `rig.html?plugins&broken` (the clock's fault fixture registered beside it): the boot
//      with a kind REFUSED at create (its WGSL does not compile) is ready — `status()` ready, the refusal in its `faults`, said once,
//      never degraded; a desk of the working clock, the refused one and one whose record throws from its third frame draws on, the
//      faulty kind quarantined at three strikes and said once; the ledger rows (`due().kinds`, the dev panel's kinds readout); both
//      broken ones drawn as the missing face; a click on either picks its entity; no page exception, no contained fault;
//  16. no page errors, no contained faults.
// THE EXIT CODE IS THE VERDICT: the number of failed rows; 1 for a throw; 2 for the watchdog.
//
//   pnpm --filter ./apps/desk build && pnpm --filter ./apps/desk rig:clock
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { layTray } from "@ice/kernel";
import { faultsOf, launchChrome, openTab, watchPage } from "./cdp.mjs";
import { decodePng } from "./png.mjs";
import { hostLoad, watchdog } from "./timing.mjs";

const here = import.meta.dirname;
const app = resolve(here, "..");
const repo = resolve(app, "../..");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const server = spawn(process.execPath, [resolve(here, "server.mjs"), repo, "0"], { stdio: ["ignore", "pipe", "inherit"] });
const PORT = await new Promise((r) => server.stdout.once("data", (b) => r(Number(String(b).match(/PORT (\d+)/)[1]))));
const chrome = await launchChrome({ headless: !process.env.DESK_HEADED });
let done = false;
async function cleanup() { if (done) return; done = true; try { await chrome.close(); } catch {} try { server.kill("SIGKILL"); } catch {} }
const kick = watchdog(300_000, cleanup);   // no row in 300 s: a hang (K-H — a slow host is not one)
let pass = 0;
let failN = 0;
const check = (ok, msg) => { console.log(`  ${ok ? "PASS" : "FAIL"}  ${msg}`); ok ? pass++ : failN++; kick(); };

const CLOCK = "ice-examples.desk-clock";
/** 2026-09-28 10:08:42 UTC — the pinned time (the oracle's stills' own). */
const AT = Date.UTC(2026, 8, 28, 10, 8, 42);
/** The dial's radius at zoom 1, CSS px (law.ts: the case 150, the dial 0.86 of its radius). */
const DIAL = 75 * 0.86;
const deg = (r) => (r * 180) / Math.PI;
/** The smallest angle between two, degrees. */
const apart = (a, b) => { const d = Math.abs(((a - b) % 360) + 360) % 360; return Math.min(d, 360 - d); };

/** A rig page up and ready: its logs watched, 1200 × 800 @2, the wind still (only the kinds' own motion wakes the desk). */
async function boot(query, logs, name = "") {
  const tab = await openTab(chrome.port, `http://127.0.0.1:${PORT}/apps/desk/dist/rig.html${query}`);
  await tab.send("Runtime.enable"); await tab.send("Log.enable"); await tab.send("Page.enable");
  watchPage(tab, logs, { name });
  await tab.send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 800, deviceScaleFactor: 2, mobile: false });
  for (let i = 0; i < 200; i++) { await tab.send("Page.bringToFront"); if (await tab.evaluate("typeof window.__desk === 'object' && window.__desk.state.ready", { timeoutMs: 20000 })) break; await sleep(200); }
  await tab.evaluate("window.__desk.ambient('still'); window.__desk.setTheme('light'); window.__desk.settle(6000)", { awaitPromise: true, timeoutMs: 30000 });
  return tab;
}

try {
  const logs = [];
  const tab = await boot("?plugins", logs);
  const front = () => tab.send("Page.bringToFront");
  const q = async (js, ms = 30000) => { await front(); return tab.evaluate(js, { awaitPromise: true, timeoutMs: ms }); };
  const mouse = (type, x, y, extra = {}) => tab.send("Input.dispatchMouseEvent", { type, x, y, button: type === "mouseMoved" ? "none" : "left", clickCount: 1, ...extra });
  const click = async (x, y) => { await front(); await mouse("mouseMoved", x, y); await mouse("mousePressed", x, y, { buttons: 1 }); await sleep(30); await mouse("mouseReleased", x, y); };
  const drag = async (from, to, steps = 10) => {
    await front();
    await mouse("mouseMoved", from[0], from[1]); await mouse("mousePressed", from[0], from[1], { buttons: 1 });
    for (let i = 1; i <= steps; i++) { await mouse("mouseMoved", from[0] + ((to[0] - from[0]) * i) / steps, from[1] + ((to[1] - from[1]) * i) / steps, { buttons: 1 }); await sleep(16); }
    await sleep(60);
    await mouse("mouseReleased", to[0], to[1]);
  };
  const key = async (k, code, vk, modifiers = 0) => {
    await front();
    await tab.send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, windowsVirtualKeyCode: vk, modifiers, ...(k.length === 1 && modifiers === 0 ? { text: k } : {}) });
    await tab.send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: vk, modifiers });
  };
  const settle = () => q("window.__desk.settle(6000)");
  const frames = (n) => q(`new Promise((r) => { let i = 0; const f = () => { if (++i >= ${n}) r(true); else requestAnimationFrame(f); }; requestAnimationFrame(f); })`);
  const clocks = () => q(`window.__desk.entities().filter((e) => e.type === ${JSON.stringify(CLOCK)})`);
  const shot = async () => { await front(); const { data } = await tab.send("Page.captureScreenshot", { format: "png" }); return decodePng(Buffer.from(data, "base64")); };
  const shown = (id) => q(`window.__desk.handle.local("desk-clock").shown(${id})`);
  await q("window.__desk.setCamera({ x: 0, y: 0, zoom: 1 })"); await settle();

  // 1. `c` sets one down at the pointer, selected, drawn by its own kind
  // the pointer is seen by the world at a TICK: a key sent before one has run finds no pointer yet and the stick falls back to the
  // view's centre — so the move lands (two frames, a settle) before the key (K-H: input whose meaning depends on its spacing)
  await front(); await mouse("mouseMoved", 360, 300); await frames(2); await settle();
  await key("c", "KeyC", 67); await settle();
  const made = await clocks();
  const one = made[0];
  const kinds1 = await q("window.__desk.stats().frame?.kinds ?? {}");
  check(made.length === 1 && one.selected && Math.abs(one.cx - 360) < 1 && Math.abs(one.cy - 300) < 1 && one.w === 150 && kinds1["desk-clock"] === 1,
    `\`c\` sets a desk clock down at the pointer (${made.length} made, at ${one?.cx.toFixed(0)},${one?.cy.toFixed(0)}, ${one?.w}×${one?.h}, selected ${one?.selected}), drawn by its own kind (${JSON.stringify(kinds1)})`);
  const id = one.id;

  // 2. its hands at a PINNED time — its record's word, and the pixels'
  await q(`window.__desk.engine.ops.setWidgetProps(${id}, { zone: "+00:00" }); window.__desk.engine.ops.setSelection([], "replace")`);
  await q(`window.__desk.handle.pinAsset(${id}, { at: ${AT} })`); await settle(); await sleep(150); await settle();
  const pinned = await shown(id);
  const want = { hour: 304.35, minute: 52.2, second: 252 };
  const recOk = pinned?.pinned === true && pinned.tod === 10 * 3600 + 8 * 60 + 42 && apart(deg(pinned.hour), want.hour) < 1e-6 && apart(deg(pinned.minute), want.minute) < 1e-6 && apart(deg(pinned.second), want.second) < 1e-6;
  const img = await shot();
  const dpr = img.width / 1200;
  const px = (x, y) => { const i = (Math.round(y * dpr) * img.width + Math.round(x * dpr)) * 4; return [img.rgba[i], img.rgba[i + 1], img.rgba[i + 2]]; };
  /** Round a ring of radius r (dial units) about the arbor, 0.5° a step: [angle°, rgb] clockwise from twelve. */
  const ring = (r) => Array.from({ length: 720 }, (_, i) => { const a = (i / 2) * (Math.PI / 180); return [i / 2, px(360 + Math.sin(a) * r * DIAL, 300 - Math.cos(a) * r * DIAL)]; });
  const lum = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const red = ([r, g, b]) => r - Math.max(g, b);
  /** The centres of the runs of a ring where `hit` holds (circular), degrees. */
  const runs = (samples, hit) => {
    const on = samples.map(([, c]) => hit(c));
    const start = on.findIndex((v) => !v);
    if (start < 0) return [];
    const out = [];
    let from = -1;
    for (let k = 1; k <= on.length; k++) {
      const i = (start + k) % on.length;
      if (on[i] && from < 0) from = k;
      if (!on[i] && from >= 0) { out.push(samples[(start + Math.round((from + k - 1) / 2)) % on.length][0]); from = -1; }
    }
    return out;
  };
  const dial = lum(px(360 + 0.62 * DIAL * Math.sin(Math.PI * 1.25), 300 - 0.62 * DIAL * Math.cos(Math.PI * 1.25)));   // the enamel, off every hand (7:30 at 0.62)
  const outer = ring(0.62);   // beyond the hour hand's tip, inside the numerals: the minute and the seconds hands
  const inner = ring(0.32);   // all three
  // the hands are BLUED steel: dark where the lamp leaves them, and bluer than the ivory, the ink and the shadows everywhere — under the
  // glass's glint too (additive white keeps b − r), where a luminance cut alone loses them (the minute hand at 52° lies under it here)
  const hand = (c) => red(c) < 40 && (lum(c) < dial * 0.45 || c[2] - c[0] > 15);
  const secAt = runs(outer, (c) => red(c) > 60);
  const minAt = runs(outer, hand);
  const hourAt = runs(inner, hand).filter((a) => apart(a, want.minute) > 8);
  const pixOk = secAt.length === 1 && apart(secAt[0], want.second) < 2.5 && minAt.length === 1 && apart(minAt[0], want.minute) < 2.5 && hourAt.length === 1 && apart(hourAt[0], want.hour) < 2.5;
  check(recOk && pixOk,
    `a PINNED time (10:08:42 UTC, \`pinAsset(e, { at })\`): its record ${pinned?.tod} s → ${deg(pinned?.hour ?? 0).toFixed(2)}° / ${deg(pinned?.minute ?? 0).toFixed(2)}° / ${deg(pinned?.second ?? 0).toFixed(2)}° (the law's ${want.hour} / ${want.minute} / ${want.second}); the PIXELS: the hour hand at ${hourAt.map((a) => a.toFixed(1)).join(",")}°, the minute's at ${minAt.map((a) => a.toFixed(1)).join(",")}°, the seconds' (red) at ${secAt.map((a) => a.toFixed(1)).join(",")}° (±2.5°)`);

  // 3. THE REGISTERED WAKE, seconds on: the desk at rest submits at each wall-clock second and never between (an in-page sampler
  //    polls the submit counter every 2 ms from before the window; each submit is placed on the wall clock)
  await q(`window.__desk.handle.pinAsset(${id}, undefined)`); await settle(); await sleep(300); await settle();
  //    …and every STEP of the engine's loop (`sleepStats().steps`): a clock that POLLED — ticked every frame, drawing only when its second
  //    turns — would submit on the seconds alone and still keep the loop awake between them; the loop must sleep there too
  const cadence = async (ms) => q(`(async () => {
    const d = window.__desk; const loop = d.engine.engine.frame; const t0 = Date.now(); const out = []; const steps = [];
    let last = d.submits().total; let lastStep = loop.sleepStats().steps; const frames0 = d.handle.redraws();
    const due = d.handle.due(performance.now()); const dueIn = (due.kinds["desk-clock"] ?? Infinity) - performance.now(); const wall = Date.now();
    await new Promise((r) => { const iv = setInterval(() => {
      const t = d.submits().total; if (t !== last) { out.push({ at: Date.now(), n: t - last }); last = t; }
      const k = loop.sleepStats().steps; if (k !== lastStep) { steps.push({ at: Date.now(), n: k - lastStep }); lastStep = k; }
      if (Date.now() - t0 >= ${ms}) { clearInterval(iv); r(); } }, 2); });
    return { t0, t1: Date.now(), out, steps, frames: d.handle.redraws() - frames0, dueIn, wall, waiting: d.handle.local("desk-clock").waiting() };
  })()`, ms + 30000);
  const s1 = await cadence(6500);
  const load1 = hostLoad();
  const phase = (at) => ((at + 4) % 1000);   // ms after the wall's second (a wake is taken 4 ms early)
  const onTick = s1.out.filter((s) => phase(s.at) < 400);
  const between = s1.out.filter((s) => phase(s.at) >= 400);
  const stepsBetween = s1.steps.filter((s) => phase(s.at) >= 400);
  const stepsN = s1.steps.reduce((n, s) => n + s.n, 0);
  const seconds1 = Math.floor((s1.t1 + 4) / 1000) - Math.floor((s1.t0 + 4) / 1000);
  /** When the wall's next second is due, from `wall` — law.ts `nextMoveAt(keyAt(wall))` − wall. */
  const nextSecond = 1000 - ((s1.wall + 4) % 1000);
  check(between.length === 0 && stepsBetween.length === 0 && Math.abs(onTick.length - seconds1) <= 1 && s1.out.every((s) => s.n === 1) && s1.dueIn >= 0 && s1.dueIn <= 1000 && Math.abs(s1.dueIn - nextSecond) < 12 && s1.waiting === 1,
    `THE REGISTERED WAKE with the seconds hand: ${s1.out.length} submits over ${((s1.t1 - s1.t0) / 1000).toFixed(1)} s (${seconds1} wall seconds turned) — ${onTick.length} at the seconds (phases ${onTick.map((s) => phase(s.at)).join(",")} ms), ${between.length} BETWEEN; the loop stepped ${stepsN} times, ${stepsBetween.length} between the seconds (it sleeps there); ${s1.frames} frames drawn; the kind due in ${s1.dueIn.toFixed(1)} ms (the next second in ${nextSecond.toFixed(0)}); 1 clock waited on (${s1.waiting}) · load ${load1}`);

  // 4. without the seconds hand: due at the next MINUTE, and over 60 s the desk submits once
  await q(`window.__desk.engine.ops.setWidgetProps(${id}, { seconds: false })`); await settle(); await sleep(200); await settle();
  // (DESK_CLOCK_MINUTE=0 skips the 60 s window while iterating on other rows — the gate never sets it; the row then FAILS, never passes)
  const m1 = process.env.DESK_CLOCK_MINUTE === "0" ? { t0: 0, t1: 0, out: [], frames: 0, dueIn: -1, wall: 0 } : await cadence(60_400);
  const load2 = hostLoad();
  const minutes = Math.floor((m1.t1 + 4) / 60000) - Math.floor((m1.t0 + 4) / 60000);
  const minuteOff = m1.out.map((s) => (s.at + 4) % 60000);
  const nextMinute = 60000 - ((m1.wall + 4) % 60000);
  check(m1.out.length === minutes && minutes === 1 && minuteOff.every((p) => p < 400) && Math.abs(m1.dueIn - nextMinute) < 12,
    `without it: the kind due at the next MINUTE (in ${(m1.dueIn / 1000).toFixed(2)} s — the wall's next minute in ${(nextMinute / 1000).toFixed(2)}); over ${((m1.t1 - m1.t0) / 1000).toFixed(1)} s ${m1.out.length} submit${m1.out.length === 1 ? "" : "s"} (${minutes} minute turned; ${minuteOff.map((p) => `+${p} ms`).join(",")}), ${m1.frames} frame${m1.frames === 1 ? "" : "s"} · load ${load2}`);
  await q(`window.__desk.engine.ops.setWidgetProps(${id}, { seconds: true })`); await settle();

  // 5. its MENU ACT (the selection menu's button with its own glyph) flips the seconds hand — one undo step, ⌘Z / ⇧⌘Z walk it
  await q(`window.__desk.engine.ops.setSelection([${id}], "replace")`); await settle();
  // the menu comes in over frames once the selection lands: wait for the act's button (≤ 5 s), then read it in ONE evaluate
  const act = await q(`(async () => { for (let i = 0; i < 100; i++) { const b = document.querySelector('[data-ice-selection-menu] [data-act="kind.desk-clock.seconds"]'); if (b) { const p = b.querySelector("path"); const r = b.getBoundingClientRect(); return { label: b.getAttribute("aria-label"), d: p?.getAttribute("d") ?? null, x: r.x + r.width / 2, y: r.y + r.height / 2 }; } await new Promise((w) => setTimeout(w, 50)); } return { missing: [...document.querySelectorAll("[data-ice-selection-menu] [data-act]")].map((b) => b.getAttribute("data-act")) }; })()`);
  if (act.missing === undefined) await click(act.x, act.y);
  await settle();
  const flipped = (await q(`window.__desk.entity(${id})`)).props.seconds;
  await q("window.__desk.engine.docs.undo()"); await settle();
  const undone = (await q(`window.__desk.entity(${id})`)).props.seconds;
  await q("window.__desk.engine.docs.redo()"); await settle();
  const redone = (await q(`window.__desk.entity(${id})`)).props.seconds;
  await key("s", "KeyS", 83); await settle();
  const byKey = (await q(`window.__desk.entity(${id})`)).props.seconds;
  check(act.missing === undefined && act.label === "Seconds hand" && typeof act.d === "string" && act.d.startsWith("M12 21a8 8") && flipped === false && undone === true && redone === false && byKey === true,
    `its MENU ACT in the selection menu ("${act.label}", its own glyph: ${act.d?.slice(0, 18)}…${act.missing !== undefined ? ` — NOT in the bar: ${JSON.stringify(act.missing)}` : ""}) flips the seconds hand (${flipped}); ⌘Z → ${undone}, ⇧⌘Z → ${redone}; the app's \`s\` runs the same act (${byKey})`);

  // 6. picked by its ROUND face: a press on the rect's corner is the mat's (the selection empties); inside the case, the clock's
  await q("window.__desk.engine.ops.setSelection([], 'replace')"); await settle();
  await click(360 + 66, 300 - 66); await settle();   // (66, 66): inside the rect (±75), 93 from the arbor (the case is 75)
  const cornerSel = await q("window.__desk.selection()");
  await click(360 + 30, 300 + 40); await settle();
  const faceSel = await q("window.__desk.selection()");
  check(cornerSel.length === 0 && faceSel.length === 1 && faceSel[0] === id, `picked by its ROUND face: a press on the rect's corner selects ${cornerSel.length} (the mat's), inside the case ${JSON.stringify(faceSel)} (the clock)`);

  // 7. picked up, it OPENS: the held bar carries ITS tools with ITS glyphs; a held key sets it; put down
  await q(`window.__desk.engine.ops.open(${id})`); await settle(); await sleep(400); await settle();
  const bar = await q(`[...document.querySelectorAll('[data-ice-selection-menu] [data-tool]')].map((b) => ({ id: b.getAttribute("data-tool"), missing: b.getAttribute("data-glyph-missing"), path: !!b.querySelector("path") }))`);
  await key("h", "KeyH", 72); await settle();
  const ringOn = (await q(`window.__desk.entity(${id})`)).props.ring24;
  await q("window.__desk.engine.ops.putDown()"); await settle(); await sleep(400); await settle();
  const heldAfter = await q("window.__desk.handle.hand()");
  check(["seconds", "ring24", "zone-back", "zone-ahead", "dial"].every((t) => bar.some((b) => b.id === t && b.path && b.missing !== "true")) && ringOn === true && heldAfter === undefined,
    `picked up it OPENS: the held bar's tools ${bar.map((b) => `${b.id}${b.path ? "" : " (no drawing)"}${b.missing === "true" ? " MISSING" : ""}`).join(" · ")} — each its own drawing; \`h\` in hand turns the 24-hour ring on (${ringOn}); put down (${heldAfter === undefined ? "nothing in hand" : "still held"})`);
  await q(`window.__desk.engine.ops.setWidgetProps(${id}, { ring24: false })`); await settle();

  // 8. it rides INTO a mini mat, and far away draws as its chip
  await front(); await mouse("mouseMoved", 820, 420); await frames(2); await settle(); await key("m", "KeyM", 77); await settle();
  const mat = (await q("window.__desk.entities()")).find((e) => e.type === "desk.minimat");
  await q("window.__desk.engine.ops.setSelection([], 'replace')"); await settle();
  await drag([360, 300 + 30], [mat.cx - 60, mat.cy + 20]); await settle(); await sleep(300); await settle();
  const inMat = await q(`window.__desk.entity(${id})`);
  await q(`window.__desk.setCamera({ x: ${mat.cx - 4 * 600}, y: ${mat.cy - 4 * 400}, zoom: 0.25 })`); await settle(); await sleep(200); await settle();
  const far = await q(`(() => { const d = window.__desk; const inp = d.handle.lastInputs(); const m = (inp?.objects ?? []).find((o) => o.kind === "minimat"); const chips = (m?.record?.chips ?? []).map((c) => ({ finish: c.finish, colour: [...c.colour].map((v) => +v.toFixed(3)), hx: c.half[0], hy: c.half[1], radius: c.radius })); return { chips, live: m?.record?.live ?? null, unchipped: d.stats().work?.unchipped ?? null, kinds: d.stats().frame?.kinds ?? {} }; })()`);
  const dialIvory = [0.949, 0.918, 0.847];   // theme.ts CLOCK_PALETTE.classic.dial (#f2ead8)
  const chip = far.chips.find((c) => c.colour.every((v, i) => Math.abs(v - dialIvory[i]) < 0.01));
  check(inMat.parent === mat.id && !inMat.active && chip !== undefined && chip.finish === "paper" && Math.abs(chip.hx - chip.hy) < 1e-6 && Math.abs(chip.radius - chip.hx) < 1e-6 && (far.live === null || far.live < 0) && (far.kinds["desk-clock"] ?? 0) === 0,
    `it rides INTO a mini mat (parent ${inMat.parent} = the mat ${mat.id}, off the root ${!inMat.active}); far away (zoom 0.25) the face draws it as its CHIP — a disc (hx ${chip?.hx?.toFixed(2)} = hy = radius) of its ivory dial (chips ${JSON.stringify(far.chips)}) — no live inside (${far.live}), no clock drawn by its own pass (${JSON.stringify(far.kinds)}), unchipped ${far.unchipped}`);
  await q("window.__desk.setCamera({ x: 0, y: 0, zoom: 1 })"); await settle();

  // 9. taken off the pegboard tray: its own specimen (its entry's hook, laid by the lattice law) dragged out makes one, selected, showing
  //    the desk's own time; one undo takes it back
  await q("window.__desk.tray.open()"); await settle(); await sleep(600); await settle();
  const law = await q("window.__desk.tray.law()");
  const onBoard = (await q("window.__desk.tray.specimens()")).find((h) => h.type === CLOCK);
  const lawAt = layTray(law.items, law.width, law.pitch).placed.find((p) => p.type === CLOCK);
  await q(`window.__desk.tray.scroll(${Math.max(0, (onBoard?.y ?? 0) - 100)}); window.__desk.settle(4000)`); await sleep(400); await settle();
  const drawn = (await q("window.__desk.tray.state().specimens")).find((s) => s.type === CLOCK);
  const before = new Set((await clocks()).map((c) => c.id));
  const o = drawn?.object ?? { x0: 0, y0: 0, x1: 0, y1: 0 };
  // …to OPEN mat, left of the mini mat and above the drawer (a take let go over the mini mat's face goes INTO it, and a twin made inside
  // a container is no member of this frame: core's insert ghost selects nothing there)
  await drag([(o.x0 + o.x1) / 2, (o.y0 + o.y1) / 2], [200, 160], 10); await settle(); await sleep(300); await settle();
  const taken = (await clocks()).filter((c) => !before.has(c.id));
  const takenShown = taken.length === 1 ? await q(`(() => { const s = window.__desk.handle.local("desk-clock").shown(${taken[0].id}); const n = new Date(); return { s, tod: n.getHours() * 3600 + n.getMinutes() * 60 + n.getSeconds() }; })()`) : null;
  const undoTake = await q("window.__desk.engine.docs.undo()"); await settle();
  const gone = (await clocks()).every((c) => before.has(c.id));
  check(onBoard !== undefined && lawAt !== undefined && onBoard.x === lawAt.x && onBoard.y === lawAt.y && drawn?.accessory === "hook" && taken.length === 1 && taken[0].selected && taken[0].active && Math.abs(taken[0].cx - 200) < 4 && Math.abs(taken[0].cy - 160) < 4 && takenShown !== null && takenShown.s?.pinned === false && Math.abs((takenShown.s?.tod ?? -99) - takenShown.tod) <= 2 && undoTake === true && gone,
    `taken off the TRAY: its specimen hangs where the lattice law puts it (${onBoard?.x},${onBoard?.y} = ${lawAt?.x},${lawAt?.y}) on its ${drawn?.accessory}; dragged out to open mat, ${taken.length} made at ${taken[0]?.cx.toFixed(0)},${taken[0]?.cy.toFixed(0)} on the desk (selected ${taken[0]?.selected}) showing the desk's time (tod ${takenShown?.s?.tod} vs the host's ${takenShown?.tod}); one undo takes it back (${undoTake}, gone ${gone})`);
  await q("window.__desk.tray.close()"); await settle();

  // 10. two tabs in a room agree on its props (the room's document; each reads its own wall clock)
  const room = `clock-${process.pid}-${Date.now() % 100000}`;
  const logsA = [];
  const logsB = [];
  const A = await boot(`?plugins&room=${room}&name=A`, logsA, "A");
  const B = await boot(`?plugins&room=${room}&name=B`, logsB, "B");
  const qa = async (t, js) => { await t.send("Page.bringToFront"); return t.evaluate(js, { awaitPromise: true, timeoutMs: 30000 }); };
  const aId = await qa(A, `window.__desk.spawn(${JSON.stringify(CLOCK)}, { style: "station", zone: "+09:00" }, { x: 500, y: 400 })`);
  await qa(A, "window.__desk.settle(6000)");
  const seenB = async () => { for (let i = 0; i < 60; i++) { const c = await qa(B, `window.__desk.entities().filter((e) => e.type === ${JSON.stringify(CLOCK)})`); if (c.length > 0) return c; await sleep(100); } return []; };
  const bFirst = await seenB();
  await qa(A, `window.__desk.engine.ops.setSelection([${aId}], "replace"); window.__desk.engine.ops.runMenuAction("desk-clock.seconds")`);
  let bLater = null;
  for (let i = 0; i < 60; i++) { const c = await qa(B, `window.__desk.entities().filter((e) => e.type === ${JSON.stringify(CLOCK)})`); if (c[0]?.props.seconds === false) { bLater = c[0]; break; } await sleep(100); }
  await qa(B, "window.__desk.settle(6000)");
  const both = await Promise.all([qa(A, `window.__desk.handle.local("desk-clock").shown(${aId})`), qa(B, `(() => { const e = window.__desk.entities().find((x) => x.type === ${JSON.stringify(CLOCK)}); return e ? window.__desk.handle.local("desk-clock").shown(e.id) : null; })()`)]);
  const aProps = (await qa(A, `window.__desk.entity(${aId})`)).props;
  const faultsAB = [...(await faultsOf(A, "A")), ...(await faultsOf(B, "B"))];
  check(bFirst.length === 1 && bFirst[0].props.style === "station" && bFirst[0].props.zone === "+09:00" && bLater !== null && JSON.stringify(bLater.props) === JSON.stringify(aProps) && both[0] !== null && both[1] !== null && Math.abs(both[0].tod - both[1].tod) <= 1 && faultsAB.length === 0,
    `TWO TABS in a room agree: B sees A's clock (${bFirst[0]?.props.style}, ${bFirst[0]?.props.zone}), then its seconds hand off (${JSON.stringify(bLater?.props)} = A's ${JSON.stringify(aProps)}); each reads its own wall clock — tod ${both[0]?.tod} / ${both[1]?.tod} (+09:00); faults ${faultsAB.length}`);
  await A.close?.(); await B.close?.();

  // 11–15. WHEN A KIND BREAKS (petition I24): the showcase with the clock's fault fixture registered — a clock whose WGSL does not
  //     compile (refused at create) and one whose record throws from its third frame (three strikes, then quarantined) — on its own page
  const logsF = [];
  const F = await boot("?plugins&broken", logsF, "F");
  const qf = async (js, ms = 30000) => { await F.send("Page.bringToFront"); return F.evaluate(js, { awaitPromise: true, timeoutMs: ms }); };
  const BROKEN = "ice-examples.desk-clock.broken";
  const FAULTY = "ice-examples.desk-clock.faulty";
  const missingSaid = (kind) => logsF.filter((l) => l.includes(`"${kind}" is MISSING`)).length;
  //  11. THE BOOT, a kind refused: DESK_READY, `status()` ready, the refusal named in its `faults` with the compiler's word — said once
  const boot0 = await qf("({ ready: window.__desk.state.ready, available: window.__desk.handle.available(), status: window.__desk.handle.status() })");
  const refusal = boot0.status.faults?.find((f) => f.kind === "desk-clock-broken");
  check(boot0.ready === true && boot0.available === true && boot0.status.state === "ready" && boot0.status.faults?.length === 1 && refusal !== undefined && /^refused at create — WGSL .*desk_clock_broken_on_purpose/.test(refusal.reason) && missingSaid("desk-clock-broken") === 1,
    `the boot with a kind REFUSED at create (its WGSL does not compile) is READY: state.ready ${boot0.ready}, status ${boot0.status.state}, faults ${JSON.stringify(boot0.status.faults?.map((f) => f.kind))} — "${refusal?.reason}" — said ${missingSaid("desk-clock-broken")} time on the page's console`);
  //  12. THE SHOWCASE: a working clock, a refused one and the faulty one — the desk draws on; the faulty kind's record throws from its third
  //      frame (its seconds hand remakes it each second): a strike each, the third QUARANTINES it — said once (one more notice), never degraded
  await qf("window.__desk.setCamera({ x: 0, y: 0, zoom: 1 }); window.__i24 = []; window.__desk.handle.onStatus((s) => window.__i24.push({ state: s.state, faults: (s.faults ?? []).map((f) => f.kind) })); 0");
  const ids = await qf(`({ clock: window.__desk.spawn(${JSON.stringify(CLOCK)}, { zone: "+00:00" }, { x: 300, y: 300 }), broken: window.__desk.spawn(${JSON.stringify(BROKEN)}, {}, { x: 600, y: 300 }), faulty: window.__desk.spawn(${JSON.stringify(FAULTY)}, {}, { x: 900, y: 300 }) })`);
  await qf("window.__desk.engine.ops.setSelection([], 'replace'); window.__desk.settle(6000)");
  const quarantined = await qf(`(async () => { const t0 = Date.now(); while (Date.now() - t0 < 15000) { const f = window.__desk.handle.status().faults ?? []; if (f.some((x) => x.kind === "desk-clock-faulty")) return Date.now() - t0; await new Promise((r) => setTimeout(r, 50)); } return -1; })()`, 30000);
  await qf("window.__desk.settle(6000)"); await sleep(300); await qf("window.__desk.settle(6000)");
  const after = await qf("({ status: window.__desk.handle.status(), notices: window.__i24, kinds: window.__desk.stats().frame?.kinds ?? {} })");
  const faultyReason = after.status.faults?.find((f) => f.kind === "desk-clock-faulty")?.reason ?? "";
  check(quarantined >= 0 && after.status.state === "ready" && after.notices.length === 1 && JSON.stringify(after.notices[0]?.faults) === JSON.stringify(["desk-clock-broken", "desk-clock-faulty"]) && /^its `record` threw on entity \d+ \(strike 3 of 3\)/.test(faultyReason) && missingSaid("desk-clock-faulty") === 1 && (after.kinds["desk-clock"] ?? 0) === 1,
    `the showcase with both broken clocks draws on: the faulty kind QUARANTINED ${quarantined >= 0 ? `${(quarantined / 1000).toFixed(1)} s after it was laid` : "NEVER"} ("${faultyReason}"), the host told ONCE (${after.notices.length} notice${after.notices.length === 1 ? "" : "s"}: ${JSON.stringify(after.notices)}), said ${missingSaid("desk-clock-faulty")} time on the console; status ${after.status.state}; the working clock drawn by its own kind (${after.kinds["desk-clock"]})`);
  //  13. THE LEDGER: `due().kinds` names both missing (KIND_MISSING, −1: never due), and the dev panel's kinds readout says both
  const ledger = await qf(`(() => { const d = window.__desk.handle.due(performance.now()); const sec = [...document.querySelectorAll("#desk-panel details")].find((s) => s.querySelector("summary")?.textContent === "the kinds"); return { kinds: d.kinds, panel: sec?.querySelector(".p-note")?.textContent ?? null, local: window.__desk.handle.local("desk-clock-faulty") === undefined }; })()`);
  check(ledger.kinds["desk-clock-broken"] === -1 && ledger.kinds["desk-clock-faulty"] === -1 && typeof ledger.kinds["desk-clock"] === "number" && ledger.kinds["desk-clock"] >= 0 && ledger.local && typeof ledger.panel === "string" && ledger.panel.includes("desk-clock-broken") && ledger.panel.includes("desk-clock-faulty"),
    `the ledger: due().kinds ${JSON.stringify({ broken: ledger.kinds["desk-clock-broken"], faulty: ledger.kinds["desk-clock-faulty"], clock: ledger.kinds["desk-clock"] === undefined ? undefined : "a time" })}; the faulty kind's desk state let go (${ledger.local}); the dev panel's kinds readout: "${ledger.panel?.slice(0, 120)}…"`);
  //  14. DRAWN AS MISSING: both broken objects are the missing face, each under its kind's name; the clock its own record
  const drawnF = await qf(`(() => { const d = window.__desk; const objs = d.handle.lastInputs()?.objects ?? []; const of = (id) => objs.find((o) => o.key === id); return { kinds: d.stats().frame?.kinds ?? {}, broken: of(${ids.broken})?.record?.missing === true, faulty: of(${ids.faulty})?.record?.missing === true, clock: of(${ids.clock})?.record?.missing === true }; })()`);
  check(drawnF.kinds["desk-clock-broken"] === 1 && drawnF.kinds["desk-clock-faulty"] === 1 && drawnF.broken && drawnF.faulty && !drawnF.clock,
    `both broken clocks drawn as the MISSING face (${JSON.stringify(drawnF.kinds)}; the refused one's record the face's: ${drawnF.broken}, the quarantined one's: ${drawnF.faulty}; the working clock's its own: ${!drawnF.clock})`);
  //  15. THE PICK on a missing object returns its entity: a press on its box selects it — the refused one, then the quarantined one
  const clickF = async (x, y) => { await F.send("Page.bringToFront"); for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) { await F.send("Input.dispatchMouseEvent", { type, x, y, button: type === "mouseMoved" ? "none" : "left", clickCount: 1, ...(type === "mousePressed" ? { buttons: 1 } : {}) }); if (type === "mousePressed") await sleep(30); } };
  await clickF(600 + 60, 300 - 60); await qf("window.__desk.settle(6000)");
  const pickBroken = await qf("window.__desk.selection()");
  await clickF(900 - 60, 300 + 60); await qf("window.__desk.settle(6000)");
  const pickFaulty = await qf("window.__desk.selection()");
  const faultsF = await faultsOf(F, "F");
  const errorsF = logsF.filter((l) => !/is MISSING/.test(l));
  const statusF = await qf("window.__desk.handle.status().state");
  check(pickBroken.length === 1 && pickBroken[0] === ids.broken && pickFaulty.length === 1 && pickFaulty[0] === ids.faulty && faultsF.length === 0 && errorsF.length === 0 && statusF === "ready",
    `the PICK on a missing object returns its entity: a press in the refused clock's box selects ${JSON.stringify(pickBroken)} (it is ${ids.broken}), in the quarantined one's ${JSON.stringify(pickFaulty)} (${ids.faulty}); no page exception and no contained fault (${errorsF.length + faultsF.length}${errorsF.length + faultsF.length > 0 ? `: ${[...errorsF, ...faultsF].slice(0, 3).join(" · ")}` : ""}); status ${statusF}`);
  await F.close?.();

  // 16. no page errors or contained faults
  const errors = [...logs.filter((l) => !/^(\[warning\]|console\.warning) /.test(l)), ...logsA, ...logsB].filter((l) => !/^(\[warning\]|console\.warning) /.test(l));
  const faults = await faultsOf(tab);
  check(errors.length === 0 && faults.length === 0, `no page errors or contained faults (${errors.length + faults.length}${errors.length + faults.length > 0 ? `: ${[...errors, ...faults].slice(0, 4).join(" · ")}` : ""})`);
} catch (err) {
  console.log("THREW:", String(err.stack ?? err));
  failN += 1;
  await cleanup();
  process.exit(1);
} finally {
  await cleanup();
}
console.log(`\nrig:clock — ${pass} passed · ${failN} failed · load ${hostLoad()}`);
process.exit(Math.min(failN, 250));
