/**
 * The rigs' fetches (K-H): on a loaded host a local fetch is dropped now and then — rig:parity and rig:world went red on "Failed to
 * fetch" of an oracle reference — so the rig pages fetch through `fetchRetry` (src/rig/fetch-retry.ts): a rejection or a 5xx is
 * retried with backoff, a 404 is final at once. The rigs' static server (scripts/server.mjs) says 404 for a file's ABSENCE only;
 * any other failure (a loaded host's EMFILE, an unreadable file) is a 500 the fetch retries — it used to say 404 for everything.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchRetry } from "../src/rig/fetch-retry";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("fetchRetry (K-H)", () => {
  const answers = (...a: (number | Error)[]) => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      calls.push(url);
      const next = a.shift() ?? 200;
      if (next instanceof Error) throw next;
      return new Response("x", { status: next });
    });
    return calls;
  };
  const run = async <T>(p: Promise<T>): Promise<T> => { await vi.runAllTimersAsync(); return p; };

  it("a dropped fetch and a 5xx are retried until one answers", async () => {
    vi.useFakeTimers();
    const calls = answers(new TypeError("Failed to fetch"), 503, 200);
    const res = await run(fetchRetry("/a"));
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(3);
  });

  it("a 404 is the file's absence: final at once", async () => {
    vi.useFakeTimers();
    const calls = answers(404);
    expect((await run(fetchRetry("/b"))).status).toBe(404);
    expect(calls).toHaveLength(1);
  });

  it("six drops and it fails — the rejection, not a hang", async () => {
    vi.useFakeTimers();
    const calls = answers(...Array.from({ length: 6 }, () => new TypeError("Failed to fetch")));
    const p = fetchRetry("/c");
    const caught = p.catch((e: unknown) => e);
    await vi.runAllTimersAsync();
    expect(String(await caught)).toContain("Failed to fetch");
    expect(calls).toHaveLength(6);
  });
});

describe("the rigs' static server (K-H)", () => {
  let server: ChildProcess | undefined;
  let root = "";
  afterEach(() => { server?.kill("SIGKILL"); if (root) { chmodSync(join(root, "locked.bin"), 0o644); rmSync(root, { recursive: true, force: true }); } });

  it("says 404 for a file's absence and 500 for a file it could not read", async () => {
    root = mkdtempSync(join(tmpdir(), "k-h-serve-"));
    writeFileSync(join(root, "ok.bin"), "ok");
    writeFileSync(join(root, "locked.bin"), "locked");
    chmodSync(join(root, "locked.bin"), 0o000);
    server = spawn(process.execPath, [resolve(import.meta.dirname, "../scripts/server.mjs"), root, "0"], { stdio: ["ignore", "pipe", "inherit"] });
    const port = await new Promise<number>((r) => server?.stdout?.once("data", (b) => r(Number(String(b).match(/PORT (\d+)/)?.[1]))));
    const status = async (path: string) => (await fetch(`http://127.0.0.1:${port}${path}`)).status;
    expect(await status("/ok.bin")).toBe(200);
    expect(await status("/missing.bin")).toBe(404);
    expect(await status("/locked.bin")).toBe(500);
  }, 30_000);
});
