// rig:idle — IDLE-ZERO (design-015 §2.4, §4.6 D-D9; D2a-world): a quiet desk submits NOTHING. The
// ambient policy in `idle` mode with a 1 s window: after a touch the wind blows (the gobo clock
// advances, frames submit); a second after the last touch the wind eases to still over 2 s; then,
// with the springs settled, 240 frames pass with ZERO submits — the submit instrument wraps
// `queue.submit` itself, installed before anything on the device could submit. Exit 0 = every
// check passed.
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { faultsOf, launchChrome, openTab, watchPage } from "./cdp.mjs";

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
const chrome = await launchChrome({ port: await freePort(9571), headless: !process.env.DESK_HEADED });
let done = false;
async function cleanup() { if (done) return; done = true; try { await chrome.close(); } catch {} try { server.kill("SIGKILL"); } catch {} }
setTimeout(async () => { console.log("WATCHDOG"); await cleanup(); process.exit(2); }, 300_000).unref();
let pass = 0;
let failN = 0;
const check = (ok, msg) => { console.log(`  ${ok ? "PASS" : "FAIL"}  ${msg}`); ok ? pass++ : failN++; };

try {
  const tab = await openTab(chrome.port, `http://127.0.0.1:${PORT}/apps/desk/dist/index.html`);
  const logs = [];
  await tab.send("Runtime.enable"); await tab.send("Log.enable"); await tab.send("Page.enable");
  watchPage(tab, logs);
  await tab.send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 800, deviceScaleFactor: 2, mobile: false });
  for (let i = 0; i < 200; i++) { await tab.send("Page.bringToFront"); if (await tab.evaluate("typeof window.__desk === 'object' && window.__desk.state.ready", { timeoutMs: 20000 })) break; await sleep(200); }
  const front = () => tab.send("Page.bringToFront");
  await front();
  const q = (js) => tab.evaluate(js, { timeoutMs: 15000 });
  const mouse = async (type, x, y) => tab.send("Input.dispatchMouseEvent", { type, x, y, button: "none" });

  // a desk of two notes and a mini mat, the ambient `idle` with a 1 s window
  await q("window.__desk.spawn('desk.note', { seed: 7 }, { x: 300, y: 250 }); window.__desk.spawn('desk.note', { seed: 11 }, { x: 900, y: 250 }); window.__desk.spawn('desk.minimat', { name: 'Inbox' }, { x: 600, y: 560 })");
  const amb = await q("window.__desk.ambient('idle', 1000)");
  check(amb.mode === "idle" && amb.reducedMotion === false, `ambient idle, 1 s window (reduced motion ${amb.reducedMotion})`);
  check((await q("window.__desk.submits()")) !== null, "the submit instrument is installed on the layer's device");

  // a touch: the pointer moves → the wind blows: the gobo clock advances and frames submit
  await mouse("mouseMoved", 500, 400);
  await sleep(100);
  await front();
  const s0 = await q("({ n: window.__desk.submits().total, t: window.__desk.ambient().clocks.goboTime, phase: window.__desk.ambient().phase })");
  await sleep(500);
  await front();
  const s1 = await q("({ n: window.__desk.submits().total, t: window.__desk.ambient().clocks.goboTime, phase: window.__desk.ambient().phase })");
  check(s0.phase === "live" && s1.n - s0.n >= 8, `touched, the wind blows: ${s1.n - s0.n} submits in 0.5 s (phase ${s0.phase} → ${s1.phase})`);
  check(s1.t > s0.t + 1.0, `the gobo clock advanced ${(s1.t - s0.t).toFixed(2)} s in 0.5 s (wind 5)`);

  // no input for 1 s + the 2 s ease + a margin: the wind is still, the springs settled, the desk quiet
  await sleep(3600);
  await front();
  const settled = await tab.evaluate("window.__desk.settle(4000)", { awaitPromise: true, timeoutMs: 15000 });
  const phase = await q("window.__desk.ambient().phase");
  check(phase === "still" && settled.settled === true, `after the window and the ease the ambient is ${phase} and the desk settled (${settled.redraws} redraws)`);

  // 240 frames: ZERO submits
  await front();
  const idle = await tab.evaluate(`(async () => {
    const before = window.__desk.submits().total; const t = window.__desk.ambient().clocks.goboTime;
    await new Promise((r) => { let n = 0; const f = () => { if (++n >= 240) r(); else requestAnimationFrame(f); }; requestAnimationFrame(f); });
    return { submits: window.__desk.submits().total - before, clock: window.__desk.ambient().clocks.goboTime - t, live: window.__desk.stats().live, dirty: window.__desk.handle.dirty() };
  })()`, { awaitPromise: true, timeoutMs: 30000 });
  check(idle.submits === 0, `240 frames at rest: ${idle.submits} submits`);
  check(idle.clock === 0 && !idle.live && !idle.dirty, `the clocks stand (Δ ${idle.clock}), nothing live, nothing dirty`);

  // a touch wakes it again — and `still` mode never blows
  await mouse("mouseMoved", 520, 420);
  await sleep(300);
  await front();
  const woke = await q("({ n: window.__desk.submits().total, phase: window.__desk.ambient().phase })");
  await sleep(300);
  await front();
  const woke2 = await q("window.__desk.submits().total");
  check(woke.phase === "live" && woke2 > woke.n, `a touch revives the wind (${woke2 - woke.n} submits in 0.3 s)`);
  await q("window.__desk.ambient('still')");
  await tab.evaluate("window.__desk.settle(4000)", { awaitPromise: true, timeoutMs: 15000 });
  await mouse("mouseMoved", 540, 440);   // a touch in still mode: a frame for the hover at most, never a wind
  await sleep(300);
  await front();
  const stillIdle = await tab.evaluate(`(async () => {
    await window.__desk.settle(4000);
    const before = window.__desk.submits().total;
    await new Promise((r) => { let n = 0; const f = () => { if (++n >= 120) r(); else requestAnimationFrame(f); }; requestAnimationFrame(f); });
    return window.__desk.submits().total - before;
  })()`, { awaitPromise: true, timeoutMs: 30000 });
  check(stillIdle === 0, `still: ${stillIdle} submits over 120 frames after a touch`);
  logs.push(...(await faultsOf(tab)));   // the faults the engine CONTAINED — a skipped frame is an error too (D7)
  if (logs.length) console.log(`page errors:\n  ${logs.slice(0, 6).join("\n  ")}`);
  check(logs.length === 0, "no page errors");
  console.log(`\n${pass} passed, ${failN} failed`);
} catch (e) { console.log("THREW:", String(e.stack ?? e)); failN++; }
finally { await cleanup(); }
process.exit(failN ? 1 : 0);
