// Both themes, as the product would show them: the lab's own §4 size-grid
// layout with committed surfaces, one selected card with its close button
// hovered (armed = --vf-red), one card held mid-drag (§7 lift), and a
// close-up of the frame. Screenshots only — the eyes are the oracle here.
//   node test/harness/themes.mjs   → results/theme-<theme>-{overview,held,closeup}.png
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
const chrome = await launchChrome({ port: 9473, headless: !process.env.GROUND_HEADED });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
setTimeout(async () => { console.log("WATCHDOG"); try { await chrome.close(); } catch {} server.kill("SIGKILL"); process.exit(2); }, 150_000).unref();
try {
  const tab = await openTab(chrome.port, `http://127.0.0.1:${PORT}/apps/groundlab/dist/index.html`);
  await tab.send("Runtime.enable"); await tab.send("Page.enable");
  await tab.send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 800, deviceScaleFactor: 2, mobile: false });
  for (let i = 0; i < 80; i++) { if (await tab.evaluate("typeof window.__ground === 'object'", { timeoutMs: 20000 })) break; await sleep(200); }
  await tab.send("Page.bringToFront");
  const q = (js) => tab.evaluate(js, { timeoutMs: 15000 });
  const mouse = (type, x, y) => tab.send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 });
  const shot = async (name) => { await tab.send("Page.bringToFront"); const { data } = await tab.send("Page.captureScreenshot", { format: "png" }); writeFileSync(resolve(app, "results", `theme-${name}.png`), Buffer.from(data, "base64")); };
  for (const theme of ["dark", "light"]) {
    await q(`(() => { const g = window.__ground, st = g.state; g.setTheme("${theme}"); st.themePinned = true; st.zoom = 1.05; st.camX = 0; st.camY = 0; st.pointerOn = true; st.pinned = false;
      document.getElementById('legend').style.visibility = 'hidden'; g.scatter(12); g.select(g.cards[5]); st.needsDraw = true; })()`);
    await sleep(900);
    const close = await q("(() => { const g = window.__ground, st = g.state, G = g.cards[5].geometry; return [(G.closeC[0] - st.camX) * st.zoom, (G.closeC[1] - st.camY) * st.zoom]; })()");
    await mouse("mouseMoved", close[0], close[1]); await sleep(450);
    await shot(`${theme}-overview`);
    // hold card 6 (the small square beside the selected one — on screen) and drag it a little
    const c2 = await q("(() => { const g = window.__ground, st = g.state, c = g.cards[6]; return [(c.x - st.camX) * st.zoom, (c.y - st.camY) * st.zoom]; })()");
    await mouse("mouseMoved", c2[0], c2[1]); await mouse("mousePressed", c2[0], c2[1]); await sleep(60);
    await mouse("mouseMoved", c2[0] + 24, c2[1] + 18); await sleep(420);
    const held = await q("(() => { const c = window.__ground.cards[window.__ground.cards.length - 1]; const G = c.geometry; return { held: c.motion.held, lift: +c.motion.lift.toFixed(3), scale: +(G.half[0] / (c.w / 2)).toFixed(3), frameAlpha: +G.frameAlpha.toFixed(3), shadowSigma: +G.shadowSigma.toFixed(2), shadowAlpha: +G.shadowAlpha.toFixed(3) }; })()");
    console.log(`${theme} held card: ${JSON.stringify(held)}`);
    await shot(`${theme}-held`);
    await mouse("mouseReleased", c2[0] + 24, c2[1] + 18); await sleep(500);
    const rest = await q("(() => { const c = window.__ground.cards[window.__ground.cards.length - 1]; const G = c.geometry; return { held: c.motion.held, lift: +c.motion.lift.toFixed(3), scale: +(G.half[0] / (c.w / 2)).toFixed(3), frameAlpha: +G.frameAlpha.toFixed(3), shadowSigma: +G.shadowSigma.toFixed(2) }; })()");
    console.log(`${theme} released:  ${JSON.stringify(rest)}`);
    // close-up on the selected card, close button hovered
    await q("(() => { const g = window.__ground, st = g.state, c = g.cards[5]; g.select(c); st.zoom = 3.2; st.camX = c.x - 600 / st.zoom; st.camY = c.y - 400 / st.zoom; st.needsDraw = true; })()");
    await sleep(500);
    const close2 = await q("(() => { const g = window.__ground, st = g.state, G = g.cards[5].geometry; return [(G.closeC[0] - st.camX) * st.zoom, (G.closeC[1] - st.camY) * st.zoom]; })()");
    await mouse("mouseMoved", close2[0], close2[1]); await sleep(450);
    await shot(`${theme}-closeup`);
    await mouse("mouseMoved", 20, 700); await sleep(300);
    console.log(`${theme}: ${await q("document.getElementById('stats').textContent")}`);
  }
} finally { await chrome.close(); server.kill("SIGKILL"); }
process.exit(0);
