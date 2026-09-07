// The tweak panel through a real Chrome: open it with the backtick key, move a
// value through the panel's own binding, see the field respond in the stats
// line, reset, and screenshot it in both themes.
//   node test/harness/panel.mjs → results/panel-<theme>.png
import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { launchChrome, openTab } from "./cdp.mjs";
const here = import.meta.dirname;
const app = resolve(here, "..");
const repo = resolve(app, "../..");   // the server root is the REPO: the app's dist and the package's oracle results are both under it
mkdirSync(resolve(app, "results"), { recursive: true });
const server = spawn(process.execPath, [resolve(here, "server.mjs"), repo, "0"], { stdio: ["ignore", "pipe", "inherit"] });
const PORT = await new Promise((r) => server.stdout.once("data", (b) => r(Number(String(b).match(/PORT (\d+)/)[1]))));
const chrome = await launchChrome({ port: 9479, headless: !process.env.GROUND_HEADED });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
setTimeout(async () => { console.log("WATCHDOG"); try { await chrome.close(); } catch {} server.kill("SIGKILL"); process.exit(2); }, 120_000).unref();
let pass = 0;
let failN = 0;
const check = (ok, msg) => { console.log(`  ${ok ? "PASS" : "FAIL"}  ${msg}`); ok ? pass++ : failN++; };
try {
  const tab = await openTab(chrome.port, `http://127.0.0.1:${PORT}/apps/groundlab/dist/index.html`);
  await tab.send("Runtime.enable"); await tab.send("Page.enable");
  await tab.send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 800, deviceScaleFactor: 2, mobile: false });
  for (let i = 0; i < 80; i++) { if (await tab.evaluate("typeof window.__ground === 'object'", { timeoutMs: 20000 })) break; await sleep(200); }
  await tab.send("Page.bringToFront");
  const q = (js) => tab.evaluate(js, { timeoutMs: 15000 });
  await q("window.__ground.state.themePinned = true; window.__ground.setTheme('dark'); window.__ground.scatter(12); window.__ground.select(window.__ground.cards[5]); document.getElementById('legend').style.visibility = 'hidden'");
  await sleep(400);
  check(!(await q("window.__ground.panel.open")), "panel starts closed");
  await tab.send("Input.dispatchKeyEvent", { type: "keyDown", key: "`", code: "Backquote", text: "`" });
  await tab.send("Input.dispatchKeyEvent", { type: "keyUp", key: "`", code: "Backquote" });
  await sleep(200);
  check(await q("window.__ground.panel.open"), "backtick opens the panel");
  const rows = await q("document.querySelectorAll('#panel .p-row').length");
  check(rows > 60, `${rows} parameter rows rendered`);
  // move the reach slider through the DOM, like a hand would
  const before = await q("window.__ground.params.field.reach");
  await q(`(() => { const s = [...document.querySelectorAll('#panel .p-row.p-range')].find((r) => r.querySelector('.p-label').textContent === 'reach').querySelector('.p-slider'); s.value = '200'; s.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await sleep(250);
  const after = await q("window.__ground.params.field.reach");
  check(before === 60 && after === 200, `reach slider: ${before} → ${after}`);
  check((await q("window.__ground.ground.fieldConfig.reach")) === 200, "the field's config follows the panel");
  check((await q("localStorage.getItem('ground-lab-params')")).includes('"reach": 200') || (await q("localStorage.getItem('ground-lab-params')")).includes('"reach":200'), "the tweak is persisted");
  // a frame style tweak rebuilds the effective style and the violation note stays quiet for a sane value
  await q(`(() => { const r = [...document.querySelectorAll('#panel .p-row.p-range')].find((r) => r.querySelector('.p-label').textContent === 'thickness'); const n = r.querySelector('.p-num'); n.value = '6'; n.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await sleep(250);
  check((await q("window.__ground.state.style.thickness")) === 6, "thickness → effective style");
  const note = await q("[...document.querySelectorAll('#panel .p-note')].filter((n) => !n.hidden && n.textContent.trim()).map((n) => n.textContent).join(' | ')");
  check(note === "", `no style violation for thickness 6${note ? ` — got: ${note}` : ""}`);
  await q(`(() => { const r = [...document.querySelectorAll('#panel .p-row.p-range')].find((r) => r.querySelector('.p-label').textContent === 'notch fillet ρ'); const n = r.querySelector('.p-num'); n.value = '40'; n.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await sleep(250);
  check((await q("[...document.querySelectorAll('#panel .p-note')].some((n) => !n.hidden)")), "ρ 40 > notch height: the violation note appears");
  await q(`(() => { const r = [...document.querySelectorAll('#panel .p-row.p-range')].find((r) => r.querySelector('.p-label').textContent === 'notch fillet ρ'); const n = r.querySelector('.p-num'); n.value = '12'; n.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await q("document.querySelectorAll('#panel .p-section')[3].open = true"); await sleep(300);
  for (const theme of ["dark", "light"]) {
    await q(`window.__ground.setTheme('${theme}')`); await sleep(350);
    const { data } = await tab.send("Page.captureScreenshot", { format: "png" });
    writeFileSync(resolve(app, "results", `panel-${theme}.png`), Buffer.from(data, "base64"));
  }
  // reset
  await q(`(() => { [...document.querySelectorAll('#panel .p-btn')].find((b) => b.textContent === 'reset to product').click(); })()`);
  await sleep(250);
  check((await q("window.__ground.params.field.reach")) === 60 && (await q("window.__ground.state.style.thickness")) === 8, "reset restores the product");
  console.log(`${pass} passed, ${failN} failed`);
} finally { await chrome.close(); server.kill("SIGKILL"); }
process.exit(failN ? 1 : 0);
