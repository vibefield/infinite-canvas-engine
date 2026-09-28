// rig:lifetime — THE APP'S LIFETIME (K9: surface S1): what `<App>`'s mount starts, the cleanup it hands `<Desk>` ends.
//
// THE DEV SERVER — Vite's own (`createServer` over the app's vite.config.ts in middleware mode, behind this rig's http server on a
// port the OS picks — never the :5173 a `pnpm dev` runs: Vite reads `port: 0` as its default —; its own dep cache, no HMR socket,
// no watcher), so React's DEVELOPMENT build runs and with it StrictMode's double mount (effect →
// cleanup → effect on the same state; the gate's other rigs drive dist/, where it never runs). The mount it discards must leave
// nothing behind:
//   · `?room=` boots with no fail screen and joins its room ONCE (one BroadcastChannel) — a second join superseded the first, whose
//     rejection covered the desk;
//   · a desk at rest calls requestAnimationFrame NOT AT ALL — the discarded mount waited on its dead layer, polling at 60/s forever;
//   · ONE paste makes ONE print — the discarded mount's paste listener stayed.
// Exit 0 = every check passed.
//
//   pnpm --filter ./apps/desk rig:lifetime
import { createServer as createHttpServer } from "node:http";
import { resolve } from "node:path";
import { createServer } from "vite";
import { faultsOf, launchChrome, openTab, watchPage } from "./cdp.mjs";
import { hostLoad, watchdog } from "./timing.mjs";

const here = import.meta.dirname;
const app = resolve(here, "..");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();
// its dep cache under the app's node_modules, never the `.vite` a `pnpm dev` in this checkout keeps; the page crossOriginIsolated,
// as the config's own server makes it (its `server.headers`)
const dev = await createServer({
  configFile: resolve(app, "vite.config.ts"), root: app, cacheDir: resolve(app, "node_modules/.vite-rig-lifetime"), logLevel: "warn", clearScreen: false,
  appType: "spa", server: { middlewareMode: true, hmr: false, watch: null },
});
const http = createHttpServer((req, res) => {
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
  dev.middlewares(req, res);
});
await new Promise((r) => http.listen(0, "127.0.0.1", r));
const DEV = `http://127.0.0.1:${http.address().port}`;
const chrome = await launchChrome({ headless: !process.env.DESK_HEADED });
let done = false;
async function cleanup() { if (done) return; done = true; try { await chrome.close(); } catch {} try { await dev.close(); } catch {} try { http.close(); } catch {} }
const kick = watchdog(240_000, cleanup);   // no row in 240 s: a hang (K-H — a dev server's first compile on a slow host is not one)
let pass = 0;
let failN = 0;
const check = (ok, msg) => { console.log(`  ${ok ? "PASS" : "FAIL"}  ${msg}`); ok ? pass++ : failN++; kick(); };

/** What a page counts from before its first script runs: requestAnimationFrame calls, BroadcastChannels opened. */
const COUNTERS = `(() => {
  const k = (window.__lifetime = { raf: 0, channels: 0 });
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => { k.raf += 1; return raf(cb); };
  const BC = window.BroadcastChannel;
  window.BroadcastChannel = class extends BC { constructor(name) { super(name); k.channels += 1; } };
})();`;
const FAIL_TEXT = "(document.getElementById('fail').hidden ? null : document.getElementById('fail').textContent)";

/** A tab at `url`, the counters in before the page's first script; `booted` once the desk says ready or the fail screen shows (≤ 3 min). */
async function page(url) {
  const tab = await openTab(chrome.port, "about:blank");
  const logs = [];
  await tab.send("Runtime.enable"); await tab.send("Log.enable"); await tab.send("Page.enable");
  watchPage(tab, logs);
  await tab.send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 800, deviceScaleFactor: 2, mobile: false });
  await tab.send("Page.addScriptToEvaluateOnNewDocument", { source: COUNTERS });
  await tab.send("Page.navigate", { url });
  const q = async (js, awaitPromise = false) => { await tab.send("Page.bringToFront"); return tab.evaluate(js, { awaitPromise, timeoutMs: 30_000 }); };
  let booted = false;
  for (const end = Date.now() + 180_000; !booted && Date.now() < end; await sleep(250)) {
    kick();
    try { booted = await q(`(typeof window.__desk === 'object' && window.__desk.state.ready === true) || ${FAIL_TEXT} !== null`); } catch {}
  }
  if (!booted) console.log(`  (no boot at ${url}: ${JSON.stringify(logs.slice(0, 4)).slice(0, 600)})`);
  return { tab, logs, q, booted };
}

try {
  console.log(`dev server ${DEV} (React's development build: StrictMode's double mount runs) · load ${hostLoad()}`);

  // `?room=` — a room of its own (no peer: the join makes the room's document)
  const room = await page(`${DEV}/index.html?room=lifetime-${process.pid}-${Date.now()}`);
  const roomFail = await room.q(FAIL_TEXT);
  check(room.booted && roomFail === null && (await room.q("window.__desk.state.ready")) === true, `?room=: the desk boots with no fail screen${roomFail !== null ? ` — it shows "${roomFail.slice(0, 160)}"` : ""}`);
  const channels = await room.q("window.__lifetime.channels");
  check(channels === 1, `…and joins its room once: ${channels} BroadcastChannel${channels === 1 ? "" : "s"} opened (the discarded mount's join and the live one's are the same)`);
  room.logs.push(...(await faultsOf(room.tab, "room")));

  // no room — the desk at rest, then one paste
  const desk = await page(`${DEV}/index.html`);
  const deskFail = await desk.q(FAIL_TEXT);
  if (!desk.booted || deskFail !== null) throw new Error(`the dev desk did not boot${deskFail !== null ? `: ${deskFail.slice(0, 200)}` : ""}`);
  await desk.q("window.__desk.ambient('still')");
  await desk.q("window.__desk.settle(4000)", true);
  await sleep(1000);
  const [raf0, at0] = [await desk.q("window.__lifetime.raf"), Date.now()];
  await sleep(2000);
  const [raf1, at1] = [await desk.q("window.__lifetime.raf"), Date.now()];
  const rate = ((raf1 - raf0) * 1000) / (at1 - at0);
  check(raf1 === raf0, `a desk at rest calls requestAnimationFrame ${rate.toFixed(1)}/s (0: no mount waits on a dead layer)`);
  const paste = await desk.q(`(async () => {
    const c = new OffscreenCanvas(64, 48); const g = c.getContext("2d"); g.fillStyle = "#c33"; g.fillRect(0, 0, 64, 48);
    const dt = new DataTransfer(); dt.items.add(new File([await c.convertToBlob({ type: "image/png" })], "lifetime.png", { type: "image/png" }));
    const prints = () => window.__desk.entities().filter((e) => e.type === "desk.photo").length;
    const before = prints();
    document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    for (const end = performance.now() + 20000; prints() === before && performance.now() < end; ) await new Promise((r) => setTimeout(r, 50));
    await new Promise((r) => setTimeout(r, 1500));   // a second print lands with the first (both decode the same bytes at once)
    return { before, after: prints() };
  })()`, true);
  check(paste.after - paste.before === 1, `ONE paste makes ONE print: ${paste.before} → ${paste.after} (one paste listener — the discarded mount's is gone)`);
  desk.logs.push(...(await faultsOf(desk.tab, "desk")));

  const logs = [...room.logs, ...desk.logs];
  if (logs.length) console.log(`page errors:\n  ${logs.slice(0, 6).join("\n  ")}`);
  check(logs.length === 0, "no page errors or contained faults");
  console.log(`\n${pass} passed, ${failN} failed · ${((Date.now() - t0) / 1000).toFixed(1)} s · load ${hostLoad()}`);
} catch (e) { console.log("THREW:", String(e.stack ?? e)); failN++; }
finally { await cleanup(); }
process.exit(failN ? 1 : 0);
