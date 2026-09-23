// The reveal, frozen frame by frame: one medium card, the TL corner close-up,
// the reveal pinned at a ladder of values (springs bypassed — the geometry is
// resolved and drawn directly), tiled into one contact sheet.
//   node test/harness/reveal.mjs → results/reveal-strip.png
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
const chrome = await launchChrome({ port: 9491, headless: !process.env.GROUND_HEADED });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
setTimeout(async () => { console.log("WATCHDOG"); try { await chrome.close(); } catch {} server.kill("SIGKILL"); process.exit(2); }, 150_000).unref();
const LADDER = [0, 0.08, 0.12, 0.16, 0.2, 0.25, 0.3, 0.36, 0.42, 0.5, 0.6, 0.75, 1];
try {
  const tab = await openTab(chrome.port, `http://127.0.0.1:${PORT}/apps/groundlab/dist/index.html`);
  await tab.send("Runtime.enable"); await tab.send("Page.enable");
  await tab.send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 800, deviceScaleFactor: 2, mobile: false });
  for (let i = 0; i < 80; i++) { if (await tab.evaluate("typeof window.__ground === 'object'", { timeoutMs: 20000 })) break; await sleep(200); }
  await tab.send("Page.bringToFront");
  const q = (js) => tab.evaluate(js, { timeoutMs: 15000 });
  const Z = 4;
  // the card's TL outer corner sits at CSS (60, 60); the clip is 220×220 CSS px around it
  const scene = { cards: [{ x: 0, y: 0, w: 329, h: 155, r: 22, strength: 0.1, selected: true }], camX: -164.5 - 8 - 60 / Z, camY: -77.5 - 8 - 60 / Z, zoom: Z, mouseX: 1000, mouseY: 700, mouseOn: false, reach: 60, halfLen: 5, theme: "dark", style: "product" };
  await q(`window.__ground.setScene(${JSON.stringify(scene)}); for (const el of document.querySelectorAll('#legend, #stats')) el.style.visibility = 'hidden';`);
  await sleep(600);
  const clips = [];
  for (const r of LADDER) {
    await q(`(() => { const g = window.__ground, c = g.cards[0]; c.motion.reveal = ${r}; c.motion.revealV = 0; g.state.needsDraw = false; g.resolveAll(); g.render(); })()`);
    await tab.evaluate("new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(res, 40))))", { awaitPromise: true, timeoutMs: 5000 });
    await tab.send("Page.bringToFront");
    const { data } = await tab.send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: 220, height: 220, scale: 1 } });
    clips.push(data);
    const G = await q("(() => { const G = window.__ground.cards[0].geometry; return { outerR: +G.outerR.toFixed(2), band: +G.band.toFixed(2), ear: +G.earR[0].toFixed(2), lockR: +G.lockR.toFixed(2), t: +(G.half[0] - G.ih[0]).toFixed(2) }; })()");
    console.log(`r ${r.toFixed(2)}: ${JSON.stringify(G)}`);
  }
  // tile in the page: one row, a label under each
  const sheet = await tab.evaluate(`(async () => {
    const srcs = ${JSON.stringify(clips)}; const labels = ${JSON.stringify(LADDER)};
    const imgs = await Promise.all(srcs.map((d) => { const i = new Image(); i.src = "data:image/png;base64," + d; return i.decode().then(() => i); }));
    const w = imgs[0].width, h = imgs[0].height, cols = 7, rows = Math.ceil(imgs.length / cols);
    const c = new OffscreenCanvas(cols * w, rows * (h + 36)); const g = c.getContext("2d");
    g.fillStyle = "#171717"; g.fillRect(0, 0, c.width, c.height);
    imgs.forEach((im, i) => { const x = (i % cols) * w, y = Math.floor(i / cols) * (h + 36); g.drawImage(im, x, y); g.fillStyle = "#a6a6a6"; g.font = "24px ui-monospace, monospace"; g.fillText("reveal " + labels[i].toFixed(2), x + 12, y + h + 26); });
    const blob = await c.convertToBlob({ type: "image/png" }); const buf = new Uint8Array(await blob.arrayBuffer());
    let s = ""; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000)); return btoa(s);
  })()`, { awaitPromise: true, timeoutMs: 30000 });
  writeFileSync(resolve(app, "results", "reveal-strip.png"), Buffer.from(sheet, "base64"));
  console.log("wrote results/reveal-strip.png");
} finally { await chrome.close(); server.kill("SIGKILL"); }
process.exit(0);
