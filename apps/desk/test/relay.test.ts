/**
 * `pnpm relay`'s server (scripts/ws-relay.mjs) as rig:collab starts it (K-H): on a port of its OWN binding. `PORT=0` asks the OS for a
 * free port AS the relay binds it, and the "listening" line — said once bound, never before — names the port bound, so a harness
 * reads it back instead of probing a port free, letting it go, and losing it to another session's rig before the relay binds. A port
 * already taken is said and the relay exits non-zero: it never claims to listen where it does not.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const RELAY = resolve(import.meta.dirname, "../../../scripts/ws-relay.mjs");

function start(port: number): { child: ChildProcess; lines: string[]; exit: Promise<number | null> } {
  const child = spawn(process.execPath, [RELAY], { env: { ...process.env, PORT: String(port) }, stdio: ["ignore", "pipe", "pipe"] });
  const lines: string[] = [];
  child.stdout?.on("data", (b) => lines.push(...String(b).split("\n").filter(Boolean)));
  child.stderr?.on("data", (b) => lines.push(...String(b).split("\n").filter(Boolean)));
  const exit = new Promise<number | null>((r) => child.once("exit", (code) => r(code)));
  return { child, lines, exit };
}
async function portOf(r: { lines: string[] }): Promise<number> {
  for (let i = 0; i < 400; i++) {
    const m = r.lines.find((l) => l.includes("listening"))?.match(/ws:\/\/localhost:(\d+)/);
    if (m) return Number(m[1]);
    await new Promise((res) => setTimeout(res, 50));
  }
  return -1;
}

describe("the relay binds its own port (K-H)", () => {
  it("PORT=0: says listening once bound, naming the port bound — and a socket reaches it there", async () => {
    const r = start(0);
    try {
      const port = await portOf(r);
      expect(port).toBeGreaterThan(0);
      const ws = new WebSocket(`ws://127.0.0.1:${port}/k-h`);
      await new Promise<void>((ok, fail) => { ws.onopen = () => ok(); ws.onerror = () => fail(new Error("no socket")); });
      ws.close();
    } finally {
      r.child.kill("SIGKILL");
    }
  }, 30_000);

  it("a port already bound is said, and the relay exits non-zero without ever claiming to listen", async () => {
    const a = start(0);
    try {
      const port = await portOf(a);
      const b = start(port);
      expect(await b.exit).not.toBe(0);
      expect(b.lines.some((l) => l.includes("listening"))).toBe(false);
      expect(b.lines.join(" ")).toContain("EADDRINUSE");
    } finally {
      a.child.kill("SIGKILL");
    }
  }, 30_000);
});
