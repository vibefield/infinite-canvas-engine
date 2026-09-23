// Open only the ground lab, set a scene with one selected card, and report what
// the CPU thinks that card's frame is — then screenshot it up close.
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { launchChrome, openTab } from "./cdp.mjs";
import { makeCards } from "@ice/ground/oracle/scene.mjs";
const here = import.meta.dirname;
const app = resolve(here, "..");
const repo = resolve(app, "../..");   // the server root is the REPO: the app's dist and the package's oracle results are both under it
mkdirSync(resolve(app, "results"), { recursive: true });   // every other rig makes it; a fresh checkout has none
const server = spawn(process.execPath, [resolve(here, "server.mjs"), repo, "0"], { stdio: ["ignore", "pipe", "inherit"] });
const PORT = await new Promise((r) => server.stdout.once("data", (b) => r(Number(String(b).match(/PORT (\d+)/)[1]))));
const chrome = await launchChrome({ port: 9471, headless: !process.env.GROUND_HEADED });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
setTimeout(async () => { console.log("WATCHDOG"); try { await chrome.close(); } catch {} server.kill("SIGKILL"); process.exit(2); }, 120_000).unref();
try {
  const tab = await openTab(chrome.port, `http://127.0.0.1:${PORT}/apps/groundlab/dist/index.html`);
  const logs = [];
  await tab.send("Runtime.enable"); await tab.send("Page.enable");
  tab.on("Runtime.exceptionThrown", (e) => logs.push(`EXCEPTION ${e.exceptionDetails.exception?.description ?? e.exceptionDetails.text}`));
  await tab.send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 800, deviceScaleFactor: 2, mobile: false });
  for (let i = 0; i < 80; i++) { if (await tab.evaluate("typeof window.__ground === 'object'", { timeoutMs: 20000 })) break; await sleep(200); }
  const arg = JSON.parse(process.argv[2] ?? "{}");
  const cards = makeCards(6).map((c, i) => (i === 3 ? { ...c, selected: true } : c));
  const s = { cards, camX: 300, camY: 80, zoom: arg.zoom ?? 2.5, mouseX: 640, mouseY: 400, mouseOn: false, reach: 140, halfLen: 5.5, theme: arg.theme ?? "dark", style: arg.style ?? "product", exact: arg.exact ?? false };
  await tab.evaluate(`window.__ground.setScene(${JSON.stringify(s)}); document.getElementById('legend').style.visibility='hidden'`);
  await tab.send("Page.bringToFront");
  await sleep(300);
  // Centre the camera on card 3 so the frame is in view, then let the springs settle.
  await tab.evaluate(`(() => { const g = window.__ground; const c = g.cards[3]; const st = g.state;
    st.camX = c.x - 600 / st.zoom; st.camY = c.y - 400 / st.zoom; st.needsDraw = true; })()`);
  await sleep(900);
  const info = await tab.evaluate(`(() => { const c = window.__ground.cards[3]; const G = c.geometry; const st = window.__ground.state;
    return { motion: { selected: c.motion.selected, reveal: c.motion.reveal, lockA: window.__ground.springs(3).lockA }, style: st.style.name,
      G: G && { centre: G.centre, half: G.half, ih: G.ih, outerR: G.outerR, closeR: G.closeR, closeC: G.closeC, lockR: G.lockR, shell: G.shell, wellHalf: G.wellHalf, wellR: G.wellR, nw: G.nw, nh: G.nh, rho: G.rho, rf: G.rf, radius: G.radius, shadowSigma: G.shadowSigma, frameAlpha: G.frameAlpha },
      screen: G && [(G.centre[0] - st.camX) * st.zoom, (G.centre[1] - st.camY) * st.zoom],
      stats: document.getElementById('stats').textContent }; })()`, { timeoutMs: 20000 });
  console.log(JSON.stringify(info, null, 1).replace(/\n\s+/g, " ").slice(0, 1800));
  const { data } = await tab.send("Page.captureScreenshot", { format: "png" });
  writeFileSync(resolve(app, "results", "probe.png"), Buffer.from(data, "base64"));
  if (logs.length) console.log("logs:", logs.join(" | "));
} finally { await chrome.close(); server.kill("SIGKILL"); }
process.exit(0);
