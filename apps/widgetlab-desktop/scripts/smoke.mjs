/**
 * widgetlab-desktop convergence smoke — drives the REAL Electron app end to end.
 *
 * Launches the shell against widgetlab-desktop's BUILT-IN renderer with
 * ICE_WINDOWS=2 (a fresh random room), and asserts the whole desktop story:
 *   1. both windows took the IPC transport (window.__ICE_TRANSPORT === "ipc" —
 *      windows share an origin, so a broken bridge pick would silently fall
 *      back to a local doc and convergence would test nothing),
 *   2. both windows bootstrapped a live doc session with the SAME widget count
 *      (seeder seeds, joiner imports — the §6.5 handshake over the switchboard),
 *   3. a widget spawned in window 1 appears in window 2 (durable lane), and
 *   4. window 2 shows window 1's presence cursor label (ephemeral lane) after
 *      a pointer move — the fun-name identity is the observable.
 *
 * Deliberately NOT in `pnpm test`: it needs a real Electron,
 * and a window manager — run it manually (`pnpm --filter widgetlab-desktop smoke`)
 * or from a verification session. `ICE_MESH=off` keeps this deterministic and
 * exercises exactly the IPC half.
 */
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { _electron } = require("playwright-core");

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROOM = `smoke-${process.pid}-${Math.floor(Math.random() * 1e6)}`;

const log = (msg) => console.log(`[smoke] ${msg}`);
const fail = (msg) => {
  console.error(`[smoke] FAIL: ${msg}`);
  process.exitCode = 1;
};

async function waitFor(fn, what, timeoutMs = 30_000, everyMs = 250) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn().catch(() => undefined);
    if (v) return v;
    if (Date.now() - t0 > timeoutMs) throw new Error(`timeout waiting for ${what}`);
    await new Promise((r) => setTimeout(r, everyMs));
  }
}

// --- the Electron app (2 windows, bundled renderer, fresh local room) ---------------
const electronApp = await _electron.launch({
  executablePath: require("electron"), // the electron package exports its binary path in a node context
  args: [appDir],
  env: {
    ...process.env,
    ICE_URL: "",
    ICE_MESH: "off",
    ICE_RENDERER_DEBUG: "1",
    ICE_ROOM: ROOM,
    ICE_WINDOWS: "2",
  },
});
const windows = [];
electronApp.on("window", (page) => {
  windows.push(page);
  page.on("console", (message) => console.log(`[renderer:${message.type()}] ${message.text()}`));
  page.on("pageerror", (error) => console.error(`[renderer:error] ${error.message}`));
});

try {
  // Two windows: the first immediately, the second after the 2.5s anti-split-seed stagger.
  await waitFor(async () => electronApp.windows().length >= 2, "second window", 20_000);
  const [w1, w2] = electronApp.windows();
  log("both windows open");

  const rendererUrl = await w1.url();
  if (!rendererUrl.startsWith("file://") || !rendererUrl.includes("/widgetlab-desktop/dist/index.html")) {
    throw new Error(`renderer is not the bundled desktop build: ${rendererUrl}`);
  }
  log("bundled file:// renderer loaded (no widgetlab server)");

  // Both took the IPC transport and finished their bootstrap (a live doc session).
  const joined = (p) =>
    p.evaluate(() => {
      const w = window;
      return w.__ICE_TRANSPORT === "ipc" && w.__ice !== undefined && w.__ice.docs.current() !== undefined;
    });
  await waitFor(() => joined(w1), "window 1 join", 20_000);
  await waitFor(() => joined(w2), "window 2 join", 20_000);
  log("both windows joined over IPC");

  // The devtools seam: the facade exposes the join's presence session
  // (docs.presence() — feeds the ECS panel's ephemeral tab under collab).
  const hasPresence = await w1.evaluate(() => window.__ice.docs.presence() !== undefined);
  if (!hasPresence) throw new Error("docs.presence() is undefined under the desktop shell");
  log("docs.presence() live (devtools seam)");

  const widgetCount = (p) => p.evaluate(() => window.__iceDebug().widgets.length);
  const c1 = await waitFor(() => widgetCount(w1), "w1 seeded widgets");
  await waitFor(async () => (await widgetCount(w2)) === c1, "w2 to converge on the seeded board");
  log(`seed converged: ${c1} widgets in both windows`);

  // --- durable lane: spawn in W1 → appears in W2 -----------------------------------
  await w1.evaluate(() => window.__ice.ops.spawnWidget("clock-card", { x: 4000, y: 4000 }));
  await waitFor(async () => (await widgetCount(w2)) === c1 + 1, "w2 to receive the spawned widget", 10_000);
  await waitFor(async () => (await widgetCount(w1)) === c1 + 1, "w1 local count");
  log("durable convergence: W1 spawn arrived in W2");

  // --- ephemeral lane: W1's cursor label shows up in W2 ----------------------------
  const box = await w1.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
  for (let i = 0; i < 10; i++) {
    await w1.mouse.move(box.w / 2 + i * 6, box.h / 2 + i * 4);
    await new Promise((r) => setTimeout(r, 60));
  }
  const nameRe =
    /(Swift|Calm|Bright|Bold|Keen|Quiet|Merry|Deft)\s(Otter|Heron|Marmot|Lynx|Falcon|Badger|Gecko|Wren|Vole|Puffin)/;
  await waitFor(
    async () => nameRe.test(await w2.evaluate(() => document.body.innerText)),
    "w1's presence cursor label in w2",
    15_000,
  );
  log("presence convergence: W1's cursor label visible in W2");

  console.log("[smoke] ALL PASS");
} catch (err) {
  for (const [index, page] of windows.entries()) {
    const diagnostics = await page.evaluate(() => ({
      href: window.location.href,
      bridge: window.iceDesktop !== undefined,
      transport: window.__ICE_TRANSPORT,
      engine: window.__ice !== undefined,
      session: window.__ice?.docs.current() !== undefined,
      body: document.body.innerText.slice(0, 500),
    })).catch((error) => ({ evaluateError: error.message }));
    console.error(`[smoke] window ${index + 1} diagnostics: ${JSON.stringify(diagnostics)}`);
  }
  fail(err.message);
} finally {
  await electronApp.close().catch(() => {});
}
