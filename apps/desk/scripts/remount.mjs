// rig:remount — THE KIND SET (petition I25 — the rule, measured; the door deferred): a desk's kinds are the set it was MOUNTED with,
// compiled at the layer's mount and fixed for its life; a host that changes them REMOUNTS the layer on a new generation (VibeField
// remounts per document already — its B4 law). What that costs, on the product's own mount: `__desk.remount()` makes the layer anew
// and `<Desk>` disposes the old mount and mounts the new one on the same engine and document — its device acquired anew, every pass
// compiled anew.
//
//   the showcase   `rig.html?plugins` — DESK_ENGINE's six kinds and the app's clock, one object of each laid (three notes), at rest
//   the mounts     the page's own boot (cold) and FIVE remounts, each read off the layer's own `perf().boot` (ms from the factory's
//                  call): the device in hand, the passes compiled (`Ground.create` resolved), the first frame presented (its GPU work
//                  done) — the medians are the five remounts'; every generation draws the seven kinds
//   the ledger     after each unmount the generation that went reads ZERO on its memory ledger: no texture, no buffer, no row — no
//                  leak across generations
//   the document   across the five remounts: no outbound commit, its snapshot byte for byte, the same objects
//   the engine     outlives every remount: what each mount added to it — two tick systems (the flight pin's, the glyph feed's), the
//                  devtools dock when open — taken back by its unmount
//   the transform  (petition I39) a remount under `scale(0.98)` on the container's ancestor: the viewport is the container's LAYOUT size
//                  under it and after it goes — every viewport the engine holds sampled each frame — and a pointer under it lands on
//                  the layout point the desk draws there
//   I24's paths    `rig.html?plugins&kindFaults`: a generation with two broken kinds of the LAYER's own — one refused at create, one
//                  quarantined at three strikes —, unmounted: its ledger zero; the next, its kinds dropped from the host's options
//                  (`__deskRig.layer`), mounts CLEAN — ready, no fault — and its own unmount reads zero too
//
//   pnpm --filter ./apps/desk build && pnpm --filter ./apps/desk rig:remount   (DESK_HEADED=1 to watch)
// Exit 0 = every check passed; 1 = a check failed or a throw; 2 = the watchdog.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { faultsOf, launchChrome, openTab, watchPage } from "./cdp.mjs";
import { hostLoad, median, watchdog } from "./timing.mjs";

const here = import.meta.dirname;
const app = resolve(here, "..");
const repo = resolve(app, "../..");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
if (!existsSync(resolve(app, "dist/rig.html"))) { console.log("PREFLIGHT FAIL: the desk's build is missing (apps/desk/dist/rig.html)\n  produce it with:  pnpm --filter ./apps/desk build"); process.exit(1); }

const server = spawn(process.execPath, [resolve(here, "server.mjs"), repo, "0"], { stdio: ["ignore", "pipe", "inherit"] });
const PORT = await new Promise((r) => server.stdout.once("data", (b) => r(Number(String(b).match(/PORT (\d+)/)[1]))));
const chrome = await launchChrome({ headless: !process.env.DESK_HEADED });
let done = false;
async function cleanup() { if (done) return; done = true; try { await chrome.close(); } catch {} try { server.kill("SIGKILL"); } catch {} }
const kick = watchdog(300_000, cleanup);   // no row in 300 s: a hang (K-H — a slow host is not one)
let pass = 0;
let failN = 0;
const check = (ok, msg) => { console.log(`  ${ok ? "PASS" : "FAIL"}  ${msg}`); ok ? pass++ : failN++; kick(); };
const ms = (v) => (typeof v === "number" ? v.toFixed(1) : String(v));

/** The remounts timed (the brief's five) — and the figure past which the first frame is the evidence that reopens the door (DK-10). */
const REMOUNTS = 5;
const DOOR_MS = 250;
/** The seven kinds the showcase lays — every one a generation must draw. */
const SEVEN = ["paper", "minimat", "board", "notebook", "calendar", "photo", "desk-clock"];

/** A rig page up and ready: its logs watched, 1200 × 800 @2, the wind still. */
async function boot(query, logs, name) {
  const tab = await openTab(chrome.port, `http://127.0.0.1:${PORT}/apps/desk/dist/rig.html${query}`);
  await tab.send("Runtime.enable"); await tab.send("Log.enable"); await tab.send("Page.enable");
  watchPage(tab, logs, { name });
  await tab.send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 800, deviceScaleFactor: 2, mobile: false });
  for (let i = 0; i < 200; i++) { await tab.send("Page.bringToFront"); if (await tab.evaluate("typeof window.__desk === 'object' && window.__desk.state.ready", { timeoutMs: 20000 })) break; await sleep(200); }
  const q = async (js, timeoutMs = 60000) => { await tab.send("Page.bringToFront"); return tab.evaluate(js, { awaitPromise: true, timeoutMs }); };
  await q("window.__desk.ambient('still'); window.__desk.setTheme('light'); window.__desk.bar(false); window.__desk.settle(8000)");
  return { tab, q };
}

/**
 * Remount the desk on its next generation and wait for it: the new `window.__desk` ready and its first frame presented. The old
 * generation's door is kept as `window.__i25old` (its handle's ledger is read after its unmount). Returns the new generation's boot.
 */
const REMOUNT = `(async () => {
  const old = window.__desk;
  window.__i25old = old;
  old.remount();
  const t0 = performance.now();
  for (;;) {
    const d = window.__desk;
    if (d !== old && d.state.ready && d.handle.perf().boot.presented !== undefined) return { generation: d.generation, boot: d.handle.perf().boot, status: d.handle.status() };
    if (performance.now() - t0 > 60000) return { timeout: true, generation: d.generation, boot: d === old ? null : d.handle.perf().boot, ready: d.state.ready };
    await new Promise((r) => setTimeout(r, 4));
  }
})()`;
/** The generation that went: its memory ledger as its unmount left it. */
const OLD_LEDGER = "(() => { const m = window.__i25old.handle.gpuMemory()?.read(); const top = window.__i25old.handle.gpuMemory()?.top(6) ?? []; return m === undefined ? null : { total: m.total, textures: m.textures, buffers: m.buffers, rows: Object.keys(m.byLabel), made: m.made, destroyed: m.destroyed, collected: m.collected, top }; })()";
const zeroed = (l) => l !== null && l.total === 0 && l.rows.length === 0 && l.made > 0;
const ledgerText = (l) => (l === null ? "no ledger" : `${l.total} B live (${l.textures} B textures, ${l.buffers} B buffers) of ${l.made} made, ${l.destroyed} destroyed${l.rows.length > 0 ? `; live: ${JSON.stringify(l.top)}` : ""}`);
/** The document as this page's engine holds it: its snapshot's SHA-256, the objects (id, type), this tab's local commits since the arm. */
const DOC = `(async () => {
  const d = window.__desk;
  const bytes = d.engine.docs.current().exportSnapshot();
  const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
  return { hash, bytes: bytes.length, objects: d.entities().map((e) => e.id + ":" + e.type).sort().join(","), commits: d.room.commits() };
})()`;

try {
  // ── THE SHOWCASE: the six kinds and the clock, at rest
  const logsA = [];
  const A = await boot("?plugins", logsA, "A");
  const cold = await A.q("({ boot: window.__desk.handle.perf().boot, generation: window.__desk.generation, status: window.__desk.handle.status() })");
  await A.q(`(async () => {
    const d = window.__desk;
    for (let i = 0; i < 3; i++) d.spawn("desk.note", { seed: i + 1 }, { x: 170 + i * 150, y: 160 });
    d.spawn("desk.minimat", { name: "Inbox" }, { x: 300, y: 520 });
    d.spawn("desk.board", {}, { x: 760, y: 560 });
    d.spawn("desk.notebook", { seed: 3, angle: 0.05 }, { x: 1040, y: 300 });
    const now = new Date();
    d.spawn("desk.calendar", { month: now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0") }, { x: 640, y: 170 });
    await d.kinds.print({ x: 960, y: 610 });
    d.spawn("ice-examples.desk-clock", {}, { x: 520, y: 380 });
    d.engine.ops.setSelection([], "replace");
    return d.settle(12000);
  })()`);
  await A.q("window.__desk.settle(8000)");
  const drawn0 = await A.q("window.__desk.stats().frame?.kinds ?? {}");
  check(cold.generation === 0 && cold.status.state === "ready" && typeof cold.boot.presented === "number" && SEVEN.every((k) => (drawn0[k] ?? 0) >= 1),
    `the showcase drawn: the seven kinds (${SEVEN.map((k) => `${k} ${drawn0[k] ?? 0}`).join(", ")}) — the page's own boot (generation 0, cold): the device ${ms(cold.boot.device)} ms, compiled ${ms(cold.boot.compiled)} ms, the first frame presented ${ms(cold.boot.presented)} ms`);
  const doc0 = await A.q(DOC);   // arms the commit count (the room door counts from its first ask)
  // the ENGINE outlives a remount: every system a mount adds from here on counted, and every one its unmount takes back
  await A.q(`(() => {
    const E = window.__desk.engine.engine; const add = E.addSystems.bind(E); const k = (window.__i25sys = { added: 0, removed: 0 });
    E.addSystems = (group, ...systems) => { k.added += systems.length; const off = add(group, ...systems); let gone = false; return () => { if (!gone) { gone = true; k.removed += systems.length; } return off(); }; };
    return 0;
  })()`);

  // ── FIVE REMOUNTS: each generation's boot, the one before it at ledger zero
  const rows = [];
  for (let n = 1; n <= REMOUNTS; n++) {
    const r = await A.q(REMOUNT, 90000);
    const old = await A.q(OLD_LEDGER);
    await A.q("window.__desk.settle(8000)");
    const drawn = await A.q("window.__desk.stats().frame?.kinds ?? {}");
    const ok = r.timeout !== true && r.generation === n && r.status.state === "ready" && r.status.faults === undefined && SEVEN.every((k) => (drawn[k] ?? 0) >= 1);
    rows.push(r.boot);
    check(ok && zeroed(old), `remount ${n} → generation ${r.generation}: the device ${ms(r.boot?.device)} ms, compiled ${ms(r.boot?.compiled)} ms (Ground.create ${ms((r.boot?.compiled ?? Number.NaN) - (r.boot?.device ?? Number.NaN))}), the first frame presented ${ms(r.boot?.presented)} ms; the seven kinds drawn (${SEVEN.every((k) => (drawn[k] ?? 0) >= 1)}); the generation before it at ledger ZERO: ${ledgerText(old)}`);
  }
  const med = (k) => median(rows.map((b) => b?.[k] ?? Number.NaN));
  const compile = median(rows.map((b) => (b?.compiled ?? Number.NaN) - (b?.device ?? Number.NaN)));
  const first = med("presented");
  console.log(`\n  THE REMOUNT, medians of ${REMOUNTS} (ms from the factory's call; 1200 × 800 @2, headless Chrome, load ${hostLoad()}):`);
  console.log(`    device in hand ${ms(med("device"))} · passes compiled ${ms(med("compiled"))} (Ground.create alone ${ms(compile)}) · first frame presented ${ms(first)}`);
  console.log(`    ranges: device ${ms(Math.min(...rows.map((b) => b.device)))}–${ms(Math.max(...rows.map((b) => b.device)))} · compiled ${ms(Math.min(...rows.map((b) => b.compiled)))}–${ms(Math.max(...rows.map((b) => b.compiled)))} · presented ${ms(Math.min(...rows.map((b) => b.presented)))}–${ms(Math.max(...rows.map((b) => b.presented)))}`);
  console.log(first > DOOR_MS
    ? `    THE FIRST FRAME EXCEEDS ${DOOR_MS} ms on this machine (${ms(first)}): the evidence that reopens the door (petition I25, answer 1 — \`handle.kinds.replace\`)`
    : `    the first frame within ${DOOR_MS} ms on this machine (${ms(first)}): the rule holds; the door stays deferred`);
  check(rows.length === REMOUNTS && rows.every((b) => typeof b?.device === "number" && typeof b?.compiled === "number" && typeof b?.presented === "number" && b.device <= b.compiled && b.compiled <= b.presented),
    `${REMOUNTS} remounts measured, each's milestones in order (device ≤ compiled ≤ presented)`);

  // ── THE DOCUMENT, untouched by five remounts
  const doc1 = await A.q(DOC);
  check(doc1.hash === doc0.hash && doc1.objects === doc0.objects && doc1.commits === 0 && doc0.objects.split(",").length >= 9,
    `the document survives ${REMOUNTS} remounts untouched: its snapshot ${doc1.hash === doc0.hash ? "byte for byte" : "CHANGED"} (${doc1.bytes} B, sha-256 ${doc1.hash.slice(0, 12)}…), the same ${doc0.objects.split(",").length} objects, ${doc1.commits} outbound commits`);
  // ── WHAT A MOUNT ADDS TO THE ENGINE GOES WITH IT: the systems the app's mounts added since the count (each mount two — the flight
  //    pin's and the glyph feed's), and a devtools dock left open in generation 5 when it goes
  await A.q("window.__desk.dock.toggle(); 0");
  for (let i = 0; i < 100 && !(await A.q("window.__desk.dock.isOpen()")); i++) await sleep(50);
  const docked = await A.q("({ open: window.__desk.dock.isOpen(), dom: document.querySelectorAll('.ice-dock').length })");
  const last = await A.q(REMOUNT, 90000);
  const after = await A.q("({ docks: document.querySelectorAll('.ice-dock').length, old: window.__i25old.dock.isOpen(), sys: window.__i25sys })");
  check(docked.open && docked.dom === 1 && last.timeout !== true && after.docks === 0 && after.old === false && after.sys.added === 2 * (REMOUNTS + 1) && after.sys.added - after.sys.removed === 2,
    `what a mount adds to the engine goes with it: ${after.sys.added} systems added by ${REMOUNTS + 1} mounts, ${after.sys.removed} taken back by their unmounts (${after.sys.added - after.sys.removed} standing — the live generation's two); the dock open in generation ${REMOUNTS} (${docked.dom} in the page) closed with it (${after.docks} left)`);
  // ── THE LAYOUT SIZE (petition I39): a desk mounted under a CSS transform on an ANCESTOR (VibeField's recede — `scale` on its scene)
  //    measures its container's LAYOUT size, never the scaled bounding rect, and keeps it when the transform goes (a transform fires
  //    no resize and moves no ratio: nothing would re-measure). Every viewport the engine holds from before the remount to after the
  //    transform is gone is sampled each frame; a pointer under the transform lands where the desk draws it (its screen point, read
  //    back off the world through the camera, is the layout's)
  await A.q(`(() => {
    const seen = (window.__i39seen = new Set()); window.__i39on = true;
    const tick = () => { const v = window.__desk.viewport(); seen.add(v.w + "×" + v.h); if (window.__i39on) requestAnimationFrame(tick); };
    tick();
    const root = document.querySelector("[data-ice-canvas]").parentElement;
    root.style.transform = "scale(0.98)";   // about its centre, as a recede is
    return 0;
  })()`);
  const under = await A.q(REMOUNT, 90000);
  await A.q("window.__desk.settle(8000)");
  const BOXES = `(() => { const c = document.querySelector("[data-ice-canvas]"); const r = c.getBoundingClientRect(); const v = window.__desk.viewport();
    return { rect: { left: r.left, top: r.top, width: r.width, height: r.height }, layout: { w: c.clientWidth, h: c.clientHeight }, viewport: { w: v.w, h: v.h } }; })()`;
  const scaledBoxes = await A.q(BOXES);
  // the mouse at 90 % across the SCALED box: the adapter's screen point is 90 % across the layout
  const at90 = { x: scaledBoxes.rect.left + 0.9 * scaledBoxes.rect.width, y: scaledBoxes.rect.top + 0.9 * scaledBoxes.rect.height };
  await A.tab.send("Page.bringToFront");
  await A.tab.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: at90.x, y: at90.y, button: "none" });
  await A.q("window.__desk.settle(4000)");
  const POINTER = "(() => { const p = window.__desk.pointer(); const c = window.__desk.camera(); return p === null ? null : { x: (p.x - c.x) * c.zoom, y: (p.y - c.y) * c.zoom }; })()";
  const pointed = await A.q(POINTER);
  await A.q(`(() => { document.querySelector("[data-ice-canvas]").parentElement.style.transform = ""; return 0; })()`);
  await A.q("window.__desk.settle(8000)");
  for (let i = 0; i < 10; i++) await A.q("new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))");
  const plainBoxes = await A.q(BOXES);
  const seen = await A.q("(() => { window.__i39on = false; return [...window.__i39seen]; })()");
  const L = scaledBoxes.layout;
  const want90 = { x: 0.9 * L.w, y: 0.9 * L.h };
  const transformed = Math.abs(scaledBoxes.rect.width - 0.98 * L.w) < 0.5 && Math.abs(scaledBoxes.rect.height - 0.98 * L.h) < 0.5;
  check(under.timeout !== true && transformed && L.w === 1200 && L.h === 800 && scaledBoxes.viewport.w === L.w && scaledBoxes.viewport.h === L.h
      && plainBoxes.viewport.w === L.w && plainBoxes.viewport.h === L.h && plainBoxes.layout.w === L.w && seen.length === 1 && seen[0] === `${L.w}×${L.h}`,
    `I39 — the desk mounted under \`scale(0.98)\` on its container's ancestor (generation ${under.generation}): its rendered box ${scaledBoxes.rect.width.toFixed(2)} × ${scaledBoxes.rect.height.toFixed(2)}, its layout ${L.w} × ${L.h} — the viewport ${scaledBoxes.viewport.w} × ${scaledBoxes.viewport.h} under it, ${plainBoxes.viewport.w} × ${plainBoxes.viewport.h} once it is gone; every viewport the engine held, sampled each frame from before the mount to after: ${seen.join(", ")}`);
  check(pointed !== null && Math.abs(pointed.x - want90.x) < 0.5 && Math.abs(pointed.y - want90.y) < 0.5,
    `I39 — a pointer 90 % across the SCALED box (client ${at90.x.toFixed(2)}, ${at90.y.toFixed(2)}) is 90 % across the layout on screen: ${pointed === null ? "no pointer" : `${pointed.x.toFixed(2)}, ${pointed.y.toFixed(2)}`} (want ${want90.x}, ${want90.y}) — a press lands where the desk draws it`);
  const faultsA = await faultsOf(A.tab, "A");
  check(logsA.length === 0 && faultsA.length === 0, `no page errors or contained faults (${logsA.length + faultsA.length}${logsA.length + faultsA.length > 0 ? `: ${[...logsA, ...faultsA].slice(0, 4).join(" · ")}` : ""})`);
  await A.tab.close?.();

  // ── I24's PATHS: a generation with a kind refused at create and one quarantined, then one mounted clean
  const logsB = [];
  const B = await boot("?plugins&kindFaults", logsB, "B");
  // the ticking kind's desk state throws at every step the desk takes: a few steps (a camera nudged) and it has its three strikes
  const struck = await B.q(`(async () => {
    const d = window.__desk;
    for (let i = 0; i < 40; i++) {
      const f = (d.handle.status().faults ?? []).map((x) => x.kind);
      const pass = d.handle.ground()?.pass("rig-ticking-clock") !== undefined || d.handle.ground()?.pass("desk-clock-broken") !== undefined;
      if (f.includes("rig-ticking-clock")) return { faults: f, state: d.handle.status().state, due: d.handle.due(performance.now()).kinds, pass };
      const c = d.camera(); d.setCamera({ x: c.x + (i % 2 ? -1 : 1), y: c.y, zoom: c.zoom });
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    }
    return { faults: (d.handle.status().faults ?? []).map((x) => x.kind), state: d.handle.status().state, due: d.handle.due(performance.now()).kinds, pass: null };
  })()`);
  // (in either order: the ticking kind's three strikes may all come in the boot's frames, before the refusal is said with its `ready`)
  check(struck.state === "ready" && JSON.stringify([...struck.faults].sort()) === JSON.stringify(["desk-clock-broken", "rig-ticking-clock"]) && struck.due["desk-clock-broken"] === -1 && struck.due["rig-ticking-clock"] === -1 && struck.pass === false,
    `the BROKEN generation: status ${struck.state}, its kinds missing — ${JSON.stringify(struck.faults)} (refused at create; quarantined at three strikes), due().kinds −1 each, the ground holds no pass of either (${struck.pass})`);
  // the host drops its broken kinds and remounts: the generation that goes, at zero; the next, clean
  await B.q("window.__deskRig.layer = { ...window.__deskRig.layer, objects: [] }; 0");
  const clean = await B.q(REMOUNT, 90000);
  const brokenLedger = await B.q(OLD_LEDGER);
  check(zeroed(brokenLedger), `the broken generation unmounted — the refused kind's create and the quarantined kind's passes and desk state included — at ledger ZERO: ${ledgerText(brokenLedger)}`);
  await B.q("window.__desk.settle(8000)");
  const cleanState = await B.q("({ status: window.__desk.handle.status(), due: window.__desk.handle.due(performance.now()).kinds, kinds: Object.keys(window.__desk.handle.due(performance.now()).kinds) })");
  check(clean.timeout !== true && clean.generation === 1 && cleanState.status.state === "ready" && cleanState.status.faults === undefined && !Object.values(cleanState.due).includes(-1) && !cleanState.kinds.includes("rig-ticking-clock"),
    `the next generation mounts CLEAN: status ${JSON.stringify(cleanState.status)}, no kind missing (${cleanState.kinds.join(", ")}); its boot: the device ${ms(clean.boot?.device)} ms, compiled ${ms(clean.boot?.compiled)} ms, presented ${ms(clean.boot?.presented)} ms`);
  const again = await B.q(REMOUNT, 90000);
  const cleanLedger = await B.q(OLD_LEDGER);
  check(again.timeout !== true && again.generation === 2 && zeroed(cleanLedger), `…and its own unmount reads ZERO: ${ledgerText(cleanLedger)}`);
  // the broken kinds' own words belong on the console — each said MISSING once, in the generation that had them; anything else is an error
  const missing = logsB.filter((l) => / is MISSING /.test(l));
  const errorsB = logsB.filter((l) => !/ is MISSING /.test(l));
  const faultsB = await faultsOf(B.tab, "B");
  check(missing.length === 2 && errorsB.length === 0 && faultsB.length === 0, `the broken kinds said MISSING once each (${missing.length}); no other page error or contained fault (${errorsB.length + faultsB.length}${errorsB.length + faultsB.length > 0 ? `: ${[...errorsB, ...faultsB].slice(0, 4).join(" · ")}` : ""})`);
} catch (err) {
  console.log("THREW:", String(err.stack ?? err));
  failN += 1;
} finally {
  await cleanup();
}
console.log(`\nrig:remount — ${pass} passed · ${failN} failed · load ${hostLoad()}`);
process.exit(failN ? 1 : 0);
