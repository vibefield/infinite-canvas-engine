// @vitest-environment node
// THE DESK CLOCK'S STILL ON DAWN (petition I30 — the first third-party still through the published door): `createStill`
// (`@vibecook/ice/desk`) on the oracle's device — Dawn in Node, the `webgpu` package, `acquire` from `/desk/engine` — held to its
// golden beside its tests (still.golden.json: each still's size and sha-256 of its RGBA; Dawn's bytes on the host that blessed it,
// as the oracle's goldens are). `STILL_BLESS=1 pnpm still` re-blesses — a deliberate event, said in its commit. Not part of `test`
// (CI runs no Dawn — vitest.config.ts excludes it): `pnpm still`, which the landing gate runs right after the oracle. Beside the
// hash, what the hash cannot say: the same still twice is the same bytes; the dials' pixels are THERE (each dial's face differs from
// the bare mat drawn alone) and nothing past their reach moved; and the device's memory ledger reads zero once each still is back.
// Each still is written to results/<name>.png for a reader's eye (never a source — results/ is ignored).
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { crc32, deflateSync } from "node:zlib";
import { instrumentMemory, type MemoryLedger, type Still, type ThemeName } from "@vibecook/ice/desk";
import { acquire } from "@vibecook/ice/desk/engine";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { create, globals } from "webgpu";
import { CLOCK, clockReach } from "../src/index";
import { clockStill, STILL_DIALS, STILL_DPR, STILL_SIZE } from "./still";

const GOLDEN = resolve(import.meta.dirname, "still.golden.json");
const RESULTS = resolve(import.meta.dirname, "../results");
const BLESS = process.env.STILL_BLESS === "1";

interface GoldenRow { readonly width: number; readonly height: number; readonly sha256: string }
const golden = (): Record<string, GoldenRow> => (existsSync(GOLDEN) ? (JSON.parse(readFileSync(GOLDEN, "utf8")) as Record<string, GoldenRow>) : {});
const sha = (s: Still): string => createHash("sha256").update(s.rgba).digest("hex");

/** A still as a PNG (8-bit RGBA, rows unfiltered, zlib and CRC-32 Node's own) — for a reader's eye. */
function png(s: Still): Buffer {
  const stride = s.width * 4 + 1;
  const raw = Buffer.alloc(stride * s.height);
  for (let y = 0; y < s.height; y++) raw.set(s.rgba.subarray(y * s.width * 4, (y + 1) * s.width * 4), y * stride + 1);
  const chunk = (type: string, data: Buffer): Buffer => {
    const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const head = Buffer.alloc(4);
    head.writeUInt32BE(data.length);
    const tail = Buffer.alloc(4);
    tail.writeUInt32BE(crc32(body));
    return Buffer.concat([head, body, tail]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(s.width, 0);
  ihdr.writeUInt32BE(s.height, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

/** Does pixel `i` of two stills differ — by more than 8 in a colour channel (I29's word for a kind's pixels)? */
const differs = (a: Uint8Array, b: Uint8Array, px: number): boolean => {
  const i = px * 4;
  return Math.max(Math.abs((a[i] as number) - (b[i] as number)), Math.abs((a[i + 1] as number) - (b[i + 1] as number)), Math.abs((a[i + 2] as number) - (b[i + 2] as number))) > 8;
};

describe("the desk clock's still, on Dawn through `createStill` (petition I30)", () => {
  let device: GPUDevice;
  let ledger: MemoryLedger;
  beforeAll(async () => {
    Object.assign(globalThis, globals);   // GPUBufferUsage & friends, which a browser has for free
    device = (await acquire({ gpu: create([]), label: "desk-clock still" })).device;
    ledger = instrumentMemory(device);   // before anything is made on it
  });
  afterAll(() => { device?.destroy(); });

  for (const theme of ["light", "dark"] as const satisfies readonly ThemeName[]) {
    const name = `clock-${theme === "light" ? "day" : "night"}`;
    it(`${name}: the same bytes twice, held to its golden; each dial's pixels there and none past its reach; the ledger at zero`, async () => {
      const a = await clockStill(device, { theme });
      const b = await clockStill(device, { theme });
      expect([a.width, a.height]).toEqual([STILL_SIZE.width * STILL_DPR, STILL_SIZE.height * STILL_DPR]);
      expect(sha(b)).toBe(sha(a));
      mkdirSync(RESULTS, { recursive: true });
      writeFileSync(resolve(RESULTS, `${name}.png`), png(a));
      const row: GoldenRow = { width: a.width, height: a.height, sha256: sha(a) };
      if (BLESS) {
        writeFileSync(GOLDEN, `${JSON.stringify({ ...golden(), [name]: row }, null, 2)}\n`);
        console.log(`BLESSED ${name}: ${row.sha256} (${row.width} × ${row.height})`);
      } else {
        expect(row, `${name} against test/still.golden.json (results/${name}.png; STILL_BLESS=1 re-blesses)`).toEqual(golden()[name]);
      }
      // the dials' pixels: each dial's face against the bare mat drawn alone — and the mat past every dial's reach untouched
      const bare = await clockStill(device, { theme, bare: true });
      const cam = { x: -STILL_SIZE.width / 2, y: -STILL_SIZE.height / 2 };
      const face = (CLOCK.size / 2) * CLOCK.face * 0.9 * STILL_DPR;
      const far = (CLOCK.size / 2 + clockReach()) * STILL_DPR;
      const centres = STILL_DIALS.map((d) => [(d.cx - cam.x) * STILL_DPR, (0 - cam.y) * STILL_DPR] as const);
      const on = centres.map(() => ({ n: 0, moved: 0 }));
      let beyond = 0;
      let movedBeyond = 0;
      for (let y = 0; y < a.height; y++) {
        for (let x = 0; x < a.width; x++) {
          const px = y * a.width + x;
          const d = centres.map(([cx, cy]) => Math.hypot(x + 0.5 - cx, y + 0.5 - cy));
          const k = d.findIndex((r) => r <= face);
          if (k >= 0) { const c = on[k] as { n: number; moved: number }; c.n += 1; if (differs(a.rgba, bare.rgba, px)) c.moved += 1; }
          if (d.every((r) => r > far)) { beyond += 1; if (differs(a.rgba, bare.rgba, px)) movedBeyond += 1; }
        }
      }
      for (const c of on) expect(c.moved / c.n).toBeGreaterThanOrEqual(0.9);
      expect(beyond).toBeGreaterThan(0);
      expect(movedBeyond).toBe(0);
      a.dispose(); b.dispose(); bare.dispose();
      expect(ledger.read()).toMatchObject({ total: 0, textures: 0, buffers: 0 });
      console.log(`${name}: ${row.sha256} · the dials' faces ${on.map((c) => `${((100 * c.moved) / c.n).toFixed(1)} %`).join(" / ")} off the bare mat · ${beyond} px past their reach, ${movedBeyond} moved · ledger ${ledger.read().made} made, ${ledger.read().total} B live`);
    });
  }
});
