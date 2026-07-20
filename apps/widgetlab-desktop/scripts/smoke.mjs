/**
 * widgetlab-desktop convergence smoke — drives the REAL Electron app end to end.
 *
 * Boots widgetlab's vite dev server, launches the shell with ICE_WINDOWS=2 (a
 * fresh random room), and asserts the whole desktop story:
 *   1. both windows took the IPC transport (window.__ICE_TRANSPORT === "ipc" —
 *      windows share an origin, so a broken bridge pick would silently fall
 *      back to a local doc and convergence would test nothing),
 *   2. both windows bootstrapped a live doc session with the SAME widget count
 *      (seeder seeds, joiner imports — the §6.5 handshake over the switchboard),
 *   3. a widget spawned in window 1 appears in window 2 (durable lane), and
 *   4. window 2 shows window 1's presence cursor label (ephemeral lane) after
 *      a pointer move — the fun-name identity is the observable.
 *
 * Deliberately NOT in `pnpm test`: it needs the vite server, a real Electron,
 * and a window manager — run it manually (`pnpm --filter widgetlab-desktop smoke`)
 * or from a verification session. No tailnet involved: the mesh start fails
 * local-only (no TS_AUTHKEY) and the smoke exercises exactly the IPC half.
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { _electron } = require("playwright-core");

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(appDir, "..", "..");
const PORT = 5199;
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

// --- 1. the widgetlab dev server --------------------------------------------------
log(`starting widgetlab dev server on :${PORT}…`);
const vite = spawn("pnpm", ["--filter", "widgetlab", "exec", "vite", "--port", String(PORT), "--strictPort"], {
  cwd: repoRoot,
  stdio: "ignore",
  detached: true, // its own process group, so cleanup kills vite's children too
});
const killVite = () => {
  try {
    process.kill(-vite.pid, "SIGTERM");
  } catch {
    /* already gone */
  }
};
process.on("exit", killVite);

await waitFor(
  async () => (await fetch(`http://localhost:${PORT}/`)).ok,
  "vite dev server",
);
log("dev server up");

// --- 2. the Electron app (2 windows, fresh room) -----------------------------------
const electronApp = await _electron.launch({
  executablePath: require("electron"), // the electron package exports its binary path in a node context
  args: [appDir],
  env: {
    ...process.env,
    ICE_URL: `http://localhost:${PORT}`,
    ICE_ROOM: ROOM,
    ICE_WINDOWS: "2",
  },
});

try {
  // Two windows: the first immediately, the second after the 2.5s anti-split-seed stagger.
  await waitFor(async () => electronApp.windows().length >= 2, "second window", 20_000);
  const [w1, w2] = electronApp.windows();
  log("both windows open");

  // Both took the IPC transport and finished their bootstrap (a live doc session).
  const joined = (p) =>
    p.evaluate(() => {
      const w = window;
      return w.__ICE_TRANSPORT === "ipc" && w.__ice !== undefined && w.__ice.docs.current() !== undefined;
    });
  await waitFor(() => joined(w1), "window 1 join", 20_000);
  await waitFor(() => joined(w2), "window 2 join", 20_000);
  log("both windows joined over IPC");

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
  fail(err.message);
} finally {
  await electronApp.close().catch(() => {});
  killVite();
}
