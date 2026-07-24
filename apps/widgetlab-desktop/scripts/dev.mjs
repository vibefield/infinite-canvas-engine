/**
 * One-command development runner: start this package's Vite renderer and open
 * Electron against it. Production never uses this server; main.mjs loads the
 * bundled dist/index.html unless ICE_URL is explicitly present.
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const host = process.env.ICE_DEV_HOST ?? "127.0.0.1";
const port = Number(process.env.ICE_DEV_PORT ?? "5173");
const url = `http://${host}:${port}`;

const vite = spawn(process.execPath, [require.resolve("vite/bin/vite.js"), "--host", host, "--port", String(port), "--strictPort"], {
  cwd: appDir,
  stdio: "inherit",
});

let electron = null;
let stopping = false;

function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  electron?.kill("SIGTERM");
  vite.kill("SIGTERM");
  process.exitCode = code;
}

process.on("SIGINT", () => stop(130));
process.on("SIGTERM", () => stop(143));
vite.on("exit", (code) => stop(code ?? 1));

for (;;) {
  if (vite.exitCode !== null) throw new Error(`Vite exited before becoming ready (${vite.exitCode})`);
  try {
    const response = await fetch(url);
    if (response.ok) break;
  } catch {
    // The server is still starting.
  }
  await new Promise((resolve) => setTimeout(resolve, 100));
}

electron = spawn(require("electron"), [appDir], {
  cwd: appDir,
  env: { ...process.env, ICE_URL: url },
  stdio: "inherit",
});
electron.on("exit", (code) => stop(code ?? 0));
