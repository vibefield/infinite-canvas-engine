// THE DESK CLOCK'S STILL (petition I30) — the first third-party still through the published door: three dials laid by durable
// spawns in a world of the clock's own, their hands stood at the oracle's hour (`pinAsset` — `ClockAsset { at }`, so no still reads
// the wall clock) in explicit zones, drawn by `createStill` (`@vibecook/ice/desk`) on the device the caller hands it. Device-free:
// test/still.dawn.test.ts hands it Dawn's and holds it to its golden (test/still.golden.json — `pnpm still`); dts:check compiles it
// against the umbrella's BUILT declarations beside the clock's src/, so every name it takes from ICE is one the package ships.
import { createStill, type Still, type ThemeName } from "@vibecook/ice/desk";
import { CLOCK, CLOCK_TYPE, type ClockAsset, DESK_CLOCK_OBJECTS } from "../src/index";

/** 2026-09-28 10:08:42 UTC — the oracle's clock stills' hour (oracle/scenes.mjs `CLOCK_AT`). */
export const STILL_AT = Date.UTC(2026, 8, 28, 10, 8, 42);
/** The view, CSS px — at dpr 2 the still is 960 × 400. */
export const STILL_SIZE = { width: 480, height: 200 } as const;
export const STILL_DPR = 2;
/** The three dials, centred on the world's origin row (the still's default camera puts the origin at its centre): x, CSS px. */
export const STILL_DIALS: readonly { readonly cx: number; readonly props: Readonly<Record<string, unknown>> }[] = [
  { cx: -160, props: { style: "classic", zone: "+00:00" } },
  { cx: 0, props: { style: "station", ring24: true, zone: "+09:00" } },
  { cx: 160, props: { style: "graphite", seconds: false, zone: "-05:00" } },
];

export interface ClockStillOptions {
  /** The theme the still is drawn in (the Sun by default; `dark` — the Moon, the graphite dial's lume). */
  readonly theme?: ThemeName;
  /** The mat alone, no dial laid — what a dial's pixels are counted against. */
  readonly bare?: boolean;
}

/** The clock's still on `device`: a world of the clock's own, staged through the engine's doors, drawn once and read back as RGBA. */
export function clockStill(device: GPUDevice, opts: ClockStillOptions = {}): Promise<Still> {
  const r = CLOCK.size / 2;
  return createStill({
    device, format: "rgba8unorm", size: STILL_SIZE, dpr: STILL_DPR, objects: DESK_CLOCK_OBJECTS,
    ...(opts.theme !== undefined ? { theme: opts.theme } : {}),
    stage: ({ engine, pinAsset }) => {
      if (opts.bare === true) return;
      for (const d of STILL_DIALS) {
        const e = engine.ops.spawnWidget(CLOCK_TYPE, { x: d.cx - r, y: -r, w: CLOCK.size, h: CLOCK.size, props: { ...d.props }, undoable: false });
        pinAsset(e, { at: STILL_AT } satisfies ClockAsset);
      }
    },
  });
}
