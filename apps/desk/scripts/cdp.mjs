// Minimal Chrome DevTools Protocol driver. No dependencies: Node's global
// WebSocket + fetch are enough to launch a browser, open a tab and evaluate.
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

export async function launchChrome({ port = 9333, headless = false, extraArgs = [] } = {}) {
  const profile = await mkdtemp(join(tmpdir(), "magnet-bench-"));
  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
    "--disable-features=CalculateNativeWinOcclusion",
    "--disable-popup-blocking",
    "--enable-unsafe-webgpu",
    // Dawn quantizes timestamp-query results to 100us unless this is off.
    "--disable-dawn-features=timestamp_quantization",
    "--enable-dawn-features=allow_unsafe_apis",
    "--autoplay-policy=no-user-gesture-required",
    "--window-position=0,0",
    "--window-size=1200,820",
    ...extraArgs,
  ];
  if (headless) args.push("--headless=new", "--use-angle=metal");
  const child = spawn(CHROME, args, { stdio: ["ignore", "pipe", "pipe"] });
  const stderr = [];
  child.stderr.on("data", (b) => stderr.push(String(b)));

  const deadline = Date.now() + 20_000;
  let version = null;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) {
        version = await res.json();
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 120));
  }
  if (version === null) {
    child.kill("SIGKILL");
    throw new Error(`chrome did not expose CDP on ${port}: ${stderr.join("").slice(-800)}`);
  }
  return {
    child,
    port,
    profile,
    version,
    stderr,
    async close() {
      // SIGTERM, a grace period, SIGKILL — then WAIT for the exit so the next
      // harness (or a `pgrep magnet-bench`) never sees a Chrome still unwinding.
      const exited = new Promise((r) => { if (child.exitCode !== null) r(); else child.once("exit", r); });
      try { child.kill("SIGTERM"); } catch {}
      await Promise.race([exited, new Promise((r) => setTimeout(r, 400))]);
      try { child.kill("SIGKILL"); } catch {}
      await Promise.race([exited, new Promise((r) => setTimeout(r, 3000))]);
      // Chrome's crashpad handler detaches and outlives the browser; it names the
      // profile dir on its command line, and the dir is unique to this launch.
      await new Promise((r) => { const k = spawn("pkill", ["-f", profile], { stdio: "ignore" }); k.on("exit", r); k.on("error", r); });
      await rm(profile, { recursive: true, force: true }).catch(() => {});
    },
  };
}

/** A console-API argument as text: a primitive's value, an object's description. */
const argText = (a) => (a.value !== undefined ? String(a.value) : (a.description ?? a.type));

/**
 * A page's ERRORS as a rig's "no page errors" row counts them (design-015 D7): an uncaught exception (`Runtime.exceptionThrown`),
 * a `console.error`/failed `console.assert` — `Runtime.consoleAPICalled`, because Chromium never sends console-API messages to the
 * Log domain, so a fault the engine CONTAINED and logged was invisible — and the Log domain's own errors (a failed load, an
 * intervention). `warnings` adds both channels' warnings. `name` prefixes each line (a two-tab rig's A and B). Returns `logs`.
 */
export function watchPage(tab, logs, { name = "", warnings = false } = {}) {
  const tag = name ? `${name} ` : "";
  const api = warnings ? ["error", "assert", "warning"] : ["error", "assert"];
  const levels = warnings ? ["error", "warning"] : ["error"];
  tab.on("Runtime.exceptionThrown", (e) => logs.push(`${tag}EXCEPTION ${e.exceptionDetails.exception?.description ?? e.exceptionDetails.text}`));
  tab.on("Runtime.consoleAPICalled", (e) => { if (api.includes(e.type)) logs.push(`${tag}console.${e.type} ${e.args.map(argText).join(" ")}`); });
  tab.on("Log.entryAdded", (e) => { if (levels.includes(e.entry.level)) logs.push(`${tag}[${e.entry.level}] ${e.entry.text}`); });
  return logs;
}

/** The faults the desk's engine CONTAINED (D7): `window.__desk.faults` — a reflector's or a guest's throw, each a skipped frame or a tripped breaker — as log lines. */
export async function faultsOf(tab, name = "") {
  const faults = (await tab.evaluate("window.__desk?.faults ?? []", { timeoutMs: 20_000 })) ?? [];
  return faults.map((f) => `${name ? `${name} ` : ""}FAULT ${f}`);
}

/** Poll `fn` until it answers truthy or `ms` pass; the last answer (D7: a rig waits on a CONDITION, never a fixed sleep standing in for one). */
export async function until(fn, ms) {
  const t0 = Date.now();
  let v = await fn();
  while (!v && Date.now() - t0 < ms) { await new Promise((r) => setTimeout(r, 40)); v = await fn(); }
  return v;
}

export async function openTab(port, url) {
  const res = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, {
    method: "PUT",
  });
  if (!res.ok) throw new Error(`open tab failed: ${res.status} ${await res.text()}`);
  const target = await res.json();
  return connect(target.webSocketDebuggerUrl, target);
}

export function connect(wsUrl, target) {
  const ws = new WebSocket(wsUrl);
  let seq = 0;
  const pending = new Map();
  const listeners = new Map();
  const ready = new Promise((resolve, reject) => {
    ws.addEventListener("open", () => resolve(), { once: true });
    ws.addEventListener("error", (e) => reject(new Error(`ws error: ${e.message ?? e}`)), {
      once: true,
    });
  });
  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id !== undefined) {
      const slot = pending.get(msg.id);
      if (slot === undefined) return;
      pending.delete(msg.id);
      if (msg.error) slot.reject(new Error(`${msg.error.message} (${msg.error.code})`));
      else slot.resolve(msg.result);
      return;
    }
    const subs = listeners.get(msg.method);
    if (subs) for (const fn of subs) fn(msg.params);
  });

  const send = async (method, params = {}) => {
    await ready;
    const id = ++seq;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  };

  return {
    target,
    ready,
    send,
    on(method, fn) {
      if (!listeners.has(method)) listeners.set(method, new Set());
      listeners.get(method).add(fn);
      return () => listeners.get(method).delete(fn);
    },
    async evaluate(expression, { awaitPromise = true, timeoutMs = 600_000 } = {}) {
      const result = await Promise.race([
        send("Runtime.evaluate", {
          expression,
          awaitPromise,
          returnByValue: true,
          userGesture: true,
        }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("evaluate timed out")), timeoutMs),
        ),
      ]);
      if (result.exceptionDetails) {
        const d = result.exceptionDetails;
        throw new Error(
          `page exception: ${d.exception?.description ?? d.text} @${d.lineNumber}:${d.columnNumber}`,
        );
      }
      return result.result.value;
    },
    close() {
      try {
        ws.close();
      } catch {}
    },
  };
}
