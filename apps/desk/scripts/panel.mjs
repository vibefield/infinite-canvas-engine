// rig:panel — THE DEV PANEL through a real Chrome (D5a; the prototype's test/harness/panel.mjs against `window.__desk`): it
// starts closed; the backtick opens it; its rows are rendered; a value moved through the panel's OWN binding (the DOM, as a
// hand would) reaches the desk — a mini mat's border (the face shrinks: the kind's live law, `handle.tuneLaw`), its vinyl
// (the selected mini mat's prop), the live insides (the face draws itself) — and the tweak is kept in this browser; the
// theme switched through the panel, both themes drawn with it open; "reset to product" puts the product back. Exit 0 = passed.
//
//   pnpm --filter ./apps/desk build && pnpm --filter ./apps/desk rig:panel      [DESK_RIG_OUT=<dir>: the two screenshots]
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { faultsOf, launchChrome, openTab, watchPage } from "./cdp.mjs";
import { watchdog } from "./timing.mjs";

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

try {
  const tab = await openTab(chrome.port, `http://127.0.0.1:${PORT}/apps/desk/dist/rig.html`);
  const logs = [];
  await tab.send("Runtime.enable"); await tab.send("Log.enable"); await tab.send("Page.enable");
  watchPage(tab, logs);
  await tab.send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 800, deviceScaleFactor: 2, mobile: false });
  for (let i = 0; i < 200; i++) { await tab.send("Page.bringToFront"); if (await tab.evaluate("typeof window.__desk === 'object' && window.__desk.state.ready", { timeoutMs: 20000 })) break; await sleep(200); }
  await tab.send("Page.bringToFront");
  const q = (js) => tab.evaluate(js, { timeoutMs: 20000 });
  const settle = () => tab.evaluate("window.__desk.settle(4000)", { awaitPromise: true, timeoutMs: 20000 });

  // the desk: a mini mat, selected, at zoom 1 (screen = world) — the theme pinned dark as the harness did
  await q("window.__desk.setCamera({ x: 0, y: 0, zoom: 1 }); window.__desk.ambient('still'); window.__desk.setTheme('dark')");
  const mm = await q("window.__desk.spawn('desk.minimat', { name: 'Ideas' }, { x: 600, y: 400 })");
  await q(`window.__desk.engine.ops.setSelection([${mm}], 'replace')`);
  await settle();
  check(!(await q("window.__desk.panel.open")) && (await q("document.getElementById('desk-panel').hidden")), "the panel starts closed");
  await tab.send("Input.dispatchKeyEvent", { type: "keyDown", key: "`", code: "Backquote", windowsVirtualKeyCode: 192, text: "`" });
  await tab.send("Input.dispatchKeyEvent", { type: "keyUp", key: "`", code: "Backquote", windowsVirtualKeyCode: 192 });
  await sleep(200);
  check(await q("window.__desk.panel.open"), "the backtick opens it");
  const rows = await q("document.querySelectorAll('#desk-panel .p-row').length");
  check(rows > 40, `${rows} parameter rows rendered`);
  const row = (label) => `[...document.querySelectorAll('#desk-panel .p-row')].find((r) => r.querySelector('.p-label')?.textContent === ${JSON.stringify(label)})`;

  // the mini mat's border through the DOM, like a hand would: the face is the sheet inset by it
  const before = await q("window.__desk.panel.params.minimat.margin");
  const face0 = (await q(`window.__desk.navFace(${mm})`)).face;
  await q(`(() => { const s = ${row("border (the face inset by it)")}.querySelector('.p-slider'); s.value = '48'; s.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await settle();
  const after = await q("window.__desk.panel.params.minimat.margin");
  const face1 = (await q(`window.__desk.navFace(${mm})`)).face;
  check(before === 32 && after === 48, `the border slider: ${before} → ${after}`);
  check((await q(`window.__desk.entity(${mm}).geometry.margin`)) === 48 && face0.width - face1.width === 32 && face0.height - face1.height === 32, `the mini mat follows the panel — its geometry's border 48, its face ${face0.width.toFixed(0)} × ${face0.height.toFixed(0)} → ${face1.width.toFixed(0)} × ${face1.height.toFixed(0)}`);
  check((await q("JSON.parse(localStorage.getItem('ice-desk-panel')).minimat.margin")) === 48, "the tweak is kept in this browser (a desk with no room)");

  // the selected mini mat's vinyl, through the panel's select
  await q(`(() => { const s = ${row("vinyl (the selected one's; t cycles)")}.querySelector('select'); s.value = 'slate'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await settle();
  check((await q(`window.__desk.entity(${mm}).props.vinyl`)) === "slate", "the vinyl select dyes the selected mini mat (its prop — the desk inside it follows)");

  // the live insides off: the face draws itself (the far LOD); on again
  const liveNow = () => q("window.__desk.stats().frame?.portals ?? -1");
  const live0 = await liveNow();
  await q(`(() => { const b = ${row("live insides")}.querySelector('input[type=checkbox]'); b.checked = false; b.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await settle();
  const live1 = await liveNow();
  check(live0 > 0 && live1 === 0 && (await q("window.__desk.panel.params.portal.on")) === false, `live insides off: ${live0} live inside → ${live1} (the face draws itself)`);
  await q(`(() => { const b = ${row("live insides")}.querySelector('input[type=checkbox]'); b.checked = true; b.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await settle();
  check((await liveNow()) === live0, `…and on again: ${await liveNow()} live`);

  // both themes through the panel's own select, the panel open over each
  for (const theme of ["dark", "light"]) {
    await q(`(() => { const s = ${row("theme")}.querySelector('select'); s.value = '${theme}'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    const drawn = await settle();
    const shot = (await tab.send("Page.captureScreenshot", { format: "png", optimizeForSpeed: true })).data;
    if (process.env.DESK_RIG_OUT) { mkdirSync(process.env.DESK_RIG_OUT, { recursive: true }); writeFileSync(resolve(process.env.DESK_RIG_OUT, `panel-${theme}.png`), Buffer.from(shot, "base64")); }
    check((await q("window.__desk.theme()")) === theme && drawn.settled && (await q("window.__desk.panel.open")), `${theme}: the panel's select switched the desk to ${await q("window.__desk.theme()")}, drawn with the panel open`);
  }

  // reset to product
  await q(`[...document.querySelectorAll('#desk-panel .p-btn')].find((b) => b.textContent === 'reset to product').click()`);
  await settle();
  const face2 = (await q(`window.__desk.navFace(${mm})`)).face;
  check((await q("window.__desk.panel.params.minimat.margin")) === 32 && (await q("window.__desk.panel.params.portal.on")) === true && (await q(`window.__desk.entity(${mm}).geometry.margin`)) === 32 && face2.width === face0.width && (await q("localStorage.getItem('ice-desk-panel')")) === null, `reset restores the product: the border 32 again (the face ${face2.width.toFixed(0)} wide), the insides live, nothing kept`);

  logs.push(...(await faultsOf(tab)));   // the faults the engine CONTAINED — a skipped frame is an error too (D7)
  if (logs.length) console.log(`page errors:\n  ${logs.slice(0, 6).join("\n  ")}`);
  check(logs.length === 0, "no page errors");
  console.log(`\n${pass} passed, ${failN} failed · ${((Date.now() - t0) / 1000).toFixed(1)} s`);
} catch (e) { console.log("THREW:", String(e.stack ?? e)); failN++; }
finally { await cleanup(); }
process.exit(failN ? 1 : 0);
