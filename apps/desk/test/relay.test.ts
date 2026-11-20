/**
 * `pnpm relay`'s server (scripts/ws-relay.mjs) as rig:collab starts it (K-H): on a port of its OWN binding. `PORT=0` asks the OS for a
 * free port AS the relay binds it, and the "listening" line — said once bound, never before — names the port bound, so a harness
 * reads it back instead of probing a port free, letting it go, and losing it to another session's rig before the relay binds. A port
 * already taken is said and the relay exits non-zero: it never claims to listen where it does not.
 *
 * AND ON ITS OWN MACHINE ALONE: with no host named the relay binds 127.0.0.1, so one started for two tabs, or by this file inside
 * `pnpm run ci`, is not open to whatever network the machine is on. `RELAY_HOST` names another address on purpose. No row here
 * opens a wide listener, and none prints an address of the machine it runs on: the machine's own addresses are told apart by
 * their place in the list.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { networkInterfaces } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const RELAY = resolve(import.meta.dirname, "../../../scripts/ws-relay.mjs");

type Relay = { child: ChildProcess; lines: string[]; exit: Promise<number | null>; closed: Promise<number | null> };

function start(port: number, env: Record<string, string> = {}): Relay {
  // RELAY_HOST is emptied first (empty is the default), so a variable of the shell that runs the suite never reaches a row
  const child = spawn(process.execPath, [RELAY], { env: { ...process.env, RELAY_HOST: "", PORT: String(port), ...env }, stdio: ["ignore", "pipe", "pipe"] });
  const lines: string[] = [];
  child.stdout?.on("data", (b) => lines.push(...String(b).split("\n").filter(Boolean)));
  child.stderr?.on("data", (b) => lines.push(...String(b).split("\n").filter(Boolean)));
  const exit = new Promise<number | null>((r) => child.once("exit", (code) => r(code)));
  // "close" comes after the pipes have ended: every line the relay wrote is in `lines` by then
  const closed = new Promise<number | null>((r) => child.once("close", (code) => r(code)));
  return { child, lines, exit, closed };
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

/** An address that is no machine's (the documentation range, RFC 5737): binding it must fail. */
const NOT_OURS = "203.0.113.1";

/** The address the "listening" line says is bound. */
function boundOf(r: { lines: string[] }): string | undefined {
  return r.lines.find((l) => l.includes("listening"))?.match(/bound to ([0-9A-Fa-f.:]+)/)?.[1];
}
/** Does a socket to `host` reach the relay? An error, or three quiet seconds, is a no. */
function reaches(host: string, port: number): Promise<boolean> {
  return new Promise((done) => {
    const ws = new WebSocket(`ws://${host}:${port}/reach`);
    const quiet = setTimeout(() => { ws.close(); done(false); }, 3000);
    ws.onopen = () => { clearTimeout(quiet); ws.close(); done(true); };
    ws.onerror = () => { clearTimeout(quiet); done(false); };
  });
}
/** How the relay's start ended: its exit code once its pipes have closed, or "listening" if it claims to listen first ("quiet": neither in twenty seconds). */
async function startOf(r: Relay): Promise<number | null | "listening" | "quiet"> {
  const end: { code?: number | null } = {};
  void r.closed.then((code) => { end.code = code; });
  for (let i = 0; i < 400; i++) {
    if (r.lines.some((l) => l.includes("listening"))) return "listening";
    if ("code" in end) return end.code ?? null;
    await new Promise((res) => setTimeout(res, 50));
  }
  return "quiet";
}

describe("the relay is its own machine's alone unless a host is named", () => {
  it("no host named: no other address of the machine reaches it, and it says it is bound to 127.0.0.1", async () => {
    const r = start(0);
    try {
      const port = await portOf(r);
      expect(port).toBeGreaterThan(0);
      expect(await reaches("127.0.0.1", port), "the loopback reaches the relay").toBe(true);
      // the machine's own IPv4 addresses beyond the loopback, told apart by their PLACE in the list: nothing here prints one
      const others = Object.values(networkInterfaces()).flatMap((list) => list ?? []).filter((a) => a.family === "IPv4" && !a.internal).map((a) => a.address);
      const reached: number[] = [];
      for (const [i, host] of others.entries()) if (await reaches(host, port)) reached.push(i + 1);
      expect(reached, `the places, among the machine's ${others.length} non-loopback IPv4 address(es), of those a socket reached the relay by`).toEqual([]);
      expect(boundOf(r)).toBe("127.0.0.1");
    } finally {
      r.child.kill("SIGKILL");
    }
  }, 30_000);

  it("a host named is the one bound: an address that is no machine's is said, and the relay exits non-zero without claiming to listen", async () => {
    const r = start(0, { RELAY_HOST: NOT_OURS });
    try {
      const end = await startOf(r);
      expect(end, "how the relay's start ended (a number is its exit code)").not.toBe("listening");
      expect(end).not.toBe("quiet");
      expect(end).not.toBe(0);
      expect(r.lines.join(" ")).toContain("EADDRNOTAVAIL");
    } finally {
      r.child.kill("SIGKILL");
    }
  }, 30_000);
});
