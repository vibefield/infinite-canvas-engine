// Interaction through a real Chrome: page-level synthetic pointer events (CDP
// Input.dispatchMouseEvent — nothing reaches the OS). Selects a card by
// clicking it, watches the reveal spring, hovers the close button, presses it,
// and watches the delete morph run to "gone". Routing is by hit position
// against the ANIMATED geometry, which is what the touch case needs.
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { launchChrome, openTab } from "./cdp.mjs";
import { makeCards } from "@ice/ground/oracle/scene.mjs";

const here = import.meta.dirname;
const app = resolve(here, "..");
const repo = resolve(app, "../..");   // the server root is the REPO: the app's dist and the package's oracle results are both under it
const server = spawn(process.execPath, [resolve(here, "server.mjs"), repo, "0"], { stdio: ["ignore", "pipe", "inherit"] });
const PORT = await new Promise((r) => server.stdout.once("data", (b) => r(Number(String(b).match(/PORT (\d+)/)[1]))));
const chrome = await launchChrome({ port: 9481, headless: !process.env.GROUND_HEADED });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
setTimeout(async () => { console.log("WATCHDOG"); try { await chrome.close(); } catch {} server.kill("SIGKILL"); process.exit(2); }, 150_000).unref();
let pass = 0;
let failN = 0;
const check = (ok, msg) => { console.log(`  ${ok ? "PASS" : "FAIL"}  ${msg}`); ok ? pass++ : failN++; };

try {
  const tab = await openTab(chrome.port, `http://127.0.0.1:${PORT}/apps/groundlab/dist/index.html`);
  await tab.send("Runtime.enable"); await tab.send("Page.enable");
  await tab.send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 800, deviceScaleFactor: 2, mobile: false });
  for (let i = 0; i < 80; i++) { if (await tab.evaluate("typeof window.__ground === 'object'", { timeoutMs: 20000 })) break; await sleep(200); }
  await tab.send("Page.bringToFront");
  const s = { cards: makeCards(6), camX: 204.97, camY: 670.16, zoom: 2.5, mouseX: 640, mouseY: 400, mouseOn: false, reach: 140, halfLen: 5.5, theme: "dark", style: "product" };
  await tab.evaluate(`window.__ground.setScene(${JSON.stringify(s)})`);
  await sleep(300);
  const mouse = async (type, x, y, extra = {}) => tab.send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1, ...extra });
  const q = (js) => tab.evaluate(js, { timeoutMs: 15000 });
  const screenOf = async (wx, wy) => q(`(() => { const st = window.__ground.state; return [(${wx} - st.camX) * st.zoom, (${wy} - st.camY) * st.zoom]; })()`);

  // --- 1. click card 3 → selected, reveal springs to 1 with no overshoot
  const c3 = await q("(() => { const c = window.__ground.cards[3]; return { x: c.x, y: c.y }; })()");
  const [cx, cy] = await screenOf(c3.x, c3.y);
  await mouse("mouseMoved", cx, cy); await mouse("mousePressed", cx, cy); await mouse("mouseReleased", cx, cy);
  const trace = [];
  for (let t = 0; t <= 480; t += 120) { trace.push((await q("window.__ground.cards[window.__ground.cards.length - 1].motion.reveal")).toFixed(2)); await sleep(120); }
  console.log(`-- select --\n  reveal 0..480ms: ${trace.join("  ")}`);
  const sel = await q("(() => { const c = window.__ground.cards[window.__ground.cards.length - 1]; return { selected: c.motion.selected, reveal: c.motion.reveal }; })()");
  check(sel.selected, "click selects the card (raised to the top of the stack)");
  check(sel.reveal > 0.95 && sel.reveal <= 1.0000001, `reveal reached ${sel.reveal.toFixed(3)} without overshoot`);
  check(Number(trace[1]) > 0.2 && Number(trace[1]) < 0.9, "intermediate frames observed — not a jump cut");

  // --- 2. hover the close button → hover spring in, pointer cursor
  const G = await q("(() => { const c = window.__ground.cards[window.__ground.cards.length - 1]; return { closeC: c.geometry.closeC, closeR: c.geometry.closeR, lockC: c.geometry.lockC }; })()");
  const [bx, by] = await screenOf(G.closeC[0], G.closeC[1]);
  await mouse("mouseMoved", bx, by); await sleep(400);
  // the buttons' and the lock's springs are the card PROGRAM's now (design-014) — `__ground.springs(i)`, not the engine's motion
  const hov = await q("(() => { const s = window.__ground.springs(window.__ground.cards.length - 1); return { h: s.hoverC, cursor: document.getElementById('gpu').style.cursor }; })()");
  console.log("-- hover close --");
  check(hov.h > 0.9, `hover spring reached ${hov.h.toFixed(2)}`);
  check(hov.cursor === "pointer", `cursor is "${hov.cursor}"`);

  // --- 3. click the lock → toggles, under-damped nod
  const [lx, ly] = await screenOf(G.lockC[0], G.lockC[1]);
  await mouse("mouseMoved", lx, ly); await sleep(50); await mouse("mousePressed", lx, ly); await sleep(60); await mouse("mouseReleased", lx, ly);
  const lockTrace = []; let peak = 0;
  for (let t = 0; t <= 400; t += 100) { const v = await q("window.__ground.springs(window.__ground.cards.length - 1).lockA"); lockTrace.push(v.toFixed(2)); peak = Math.max(peak, v); await sleep(100); }
  console.log(`-- lock --\n  lockA 0..400ms: ${lockTrace.join("  ")}`);
  const lk = await q("(() => { const s = window.__ground.springs(window.__ground.cards.length - 1); return { locked: s.locked, a: s.lockA }; })()");
  check(!lk.locked && lk.a > 0.95, `lock toggled open (lockA ${lk.a.toFixed(3)})`);
  check(peak > 1.005, `under-damped: peaked at ${peak.toFixed(3)} and settled`);

  // --- 4. press close → delete morph runs to completion, card removed
  const before = await q("window.__ground.cards.length");
  await mouse("mouseMoved", bx, by); await sleep(50); await mouse("mousePressed", bx, by); await sleep(60); await mouse("mouseReleased", bx, by);
  const del = [];
  for (let t = 0; t <= 720; t += 120) { del.push(await q("(() => { const c = window.__ground.cards.find(c => c.motion.deleting || c.motion.gone); return c ? c.motion.del.toFixed(2) : 'gone'; })()")); await sleep(120); }
  console.log(`-- delete --\n  del 0..720ms: ${del.join("  ")}`);
  const after = await q("window.__ground.cards.length");
  check(after === before - 1, `card removed (${before} → ${after})`);
  check(del.some((v) => v !== "gone" && Number(v) > 0.05 && Number(v) < 0.95), "collapse ran through intermediate frames");

  // --- 5. pan does not hit a card; clicking empty field deselects
  await mouse("mouseMoved", 30, 30); await mouse("mousePressed", 30, 30); await mouse("mouseReleased", 30, 30); await sleep(200);
  check(!(await q("window.__ground.cards.some(c => c.motion.selected)")), "click on empty field deselects");

  console.log(`\n${pass} passed, ${failN} failed`);
} catch (e) { console.log("THREW:", String(e.stack ?? e)); }
finally { await chrome.close(); server.kill("SIGKILL"); }
process.exit(failN ? 1 : 0);
