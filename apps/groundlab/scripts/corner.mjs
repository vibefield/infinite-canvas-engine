// The corner composition, rendered: one selected medium card and one small card,
// close-up, dark and light, for a list of corner specs — the eyes judge the
// composition, the harness only draws it. The first entry is the OLD product
// style (raw numbers) as the "before".
//   node test/harness/corner.mjs            → results/corner-<name>-{medium,small}.png
//   node test/harness/corner.mjs '[{"name":"x","thickness":8,"control":26,"clearance":8,"radius":22}]'
import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { launchChrome, openTab } from "./cdp.mjs";
import { composeStyle, PRODUCT_CORNER } from "@ice/ground/packs";
import { cornerTweaksOf, styleTweaksOf } from "../src/params.ts";
const here = import.meta.dirname;
const app = resolve(here, "..");
const repo = resolve(app, "../..");   // the server root is the REPO: the app's dist and the package's oracle results are both under it
mkdirSync(resolve(app, "results"), { recursive: true });
const OLD = { base: "product", corner: cornerTweaksOf(PRODUCT_CORNER), thickness: 3.5, notchW: 30, shelfW: 96, notchH: 28, rho: 12, rfH: 7, rfV: 7, rfVShelf: 9, baseR: 22, outerR: 0, btnInset: 15, btnRadius: 10, btnGlyphW: 7, btnGlyphR: 0.9 };
const specs = process.argv[2] ? JSON.parse(process.argv[2]) : [PRODUCT_CORNER];
const tweaks = [["old", OLD], ...specs.map((c) => [c.name ?? "spec", styleTweaksOf(composeStyle(c), "product", cornerTweaksOf(c))])];
const server = spawn(process.execPath, [resolve(here, "server.mjs"), repo, "0"], { stdio: ["ignore", "pipe", "inherit"] });
const PORT = await new Promise((r) => server.stdout.once("data", (b) => r(Number(String(b).match(/PORT (\d+)/)[1]))));
const chrome = await launchChrome({ port: 9487, headless: !process.env.GROUND_HEADED });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
setTimeout(async () => { console.log("WATCHDOG"); try { await chrome.close(); } catch {} server.kill("SIGKILL"); process.exit(2); }, 240_000).unref();
try {
  const tab = await openTab(chrome.port, `http://127.0.0.1:${PORT}/apps/groundlab/dist/index.html`);
  await tab.send("Runtime.enable"); await tab.send("Page.enable");
  await tab.send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 800, deviceScaleFactor: 2, mobile: false });
  for (let i = 0; i < 80; i++) { if (await tab.evaluate("typeof window.__ground === 'object'", { timeoutMs: 20000 })) break; await sleep(200); }
  await tab.send("Page.bringToFront");
  const q = (js) => tab.evaluate(js, { timeoutMs: 15000 });
  const mouse = (type, x, y) => tab.send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 });
  const settle = () => tab.evaluate("new Promise((res) => { const t0 = performance.now(); const poll = () => { if (!window.__ground.state.needsDraw || performance.now() - t0 > 3000) requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(res, 60))); else requestAnimationFrame(poll); }; poll(); })", { awaitPromise: true, timeoutMs: 15000 });
  const shot = async (name) => { await settle(); await tab.send("Page.bringToFront"); const { data } = await tab.send("Page.captureScreenshot", { format: "png" }); writeFileSync(resolve(app, "results", `corner-${name}.png`), Buffer.from(data, "base64")); };
  const shots = [
    { tag: "medium", theme: "dark", zoom: 3, card: { w: 329, h: 155 } },
    { tag: "small", theme: "light", zoom: 4, card: { w: 155, h: 155 } },
  ];
  for (const [name, t] of tweaks) {
    for (const s of shots) {
      const scene = { cards: [{ x: 0, y: 0, ...s.card, r: 22, strength: 0.1, selected: true }], camX: -600 / s.zoom, camY: -400 / s.zoom, zoom: s.zoom, mouseX: 600, mouseY: 400, mouseOn: false, reach: 60, halfLen: 5, theme: s.theme, style: "product" };
      await q(`window.__ground.setScene(${JSON.stringify(scene)}); for (const el of document.querySelectorAll('#legend')) el.style.visibility = 'hidden';`);
      await q(`window.__ground.params.style = ${JSON.stringify(t)}; window.__ground.apply(); window.__ground.panel.refresh();`);
      await sleep(700);   // the reveal spring
      const close = await q("(() => { const g = window.__ground, st = g.state, G = g.cards[0].geometry; return [(G.closeC[0] - st.camX) * st.zoom, (G.closeC[1] - st.camY) * st.zoom]; })()");
      await mouse("mouseMoved", close[0], close[1]); await sleep(450);
      await shot(`${name}-${s.tag}`);
      await mouse("mouseMoved", 20, 780); await sleep(200);
      const v = await q(`(() => { const g = window.__ground; return g.hitAt ? (document.querySelector('#panel .p-note:not([hidden])')?.textContent ?? '') : ''; })()`);
      console.log(`${name} ${s.tag}: ${await q("document.getElementById('stats').textContent.split('·').slice(-6, -3).join('·')")}${v ? `  NOTE ${v}` : ""}`);
    }
  }
} finally { await chrome.close(); server.kill("SIGKILL"); }
process.exit(0);
