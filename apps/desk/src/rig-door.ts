// THE RIGS' DOOR (design-015 D7, D-D7-C.3). The oracle's scenes and fixtures — the stills `setScene` stages, the committed
// print a rig lays down — are the RIGS', not the product's: they live in src/rig/ and load only on `rig.html` (the desk + the
// rigs' harness), which opens this door as `window.__deskRig`. The product page (`index.html`) never imports them, so the
// app's own module graph imports the published surface only (M10, `test/exit-imports.test.ts`); on it, `window.__desk`'s
// `setScene` and `kinds.print` refuse by name instead of reaching for fixtures a third-party app would not have.

import type { CanvasEngine, Entity, WidgetType } from "@ice/core";
import type { DeskLayerHandle, DeskLayerOptions, ThemeName } from "@ice/desk";

/** What a scene is staged INTO: the engine, the layer's handle, the theme's setter, the flight's pin. */
export interface SceneHost {
  readonly engine: CanvasEngine;
  readonly handle: DeskLayerHandle;
  setTheme(name: ThemeName, pin: boolean): void;
  /** Hold the flight on at progress `p` every tick (a still of a flight frame); `null` lets it fly. */
  pinFlight(p: number | null): void;
}

/** What a desk's spawn made, by kind, in the scene's own order. */
export interface Staged { readonly notes: Entity[]; readonly minimats: Entity[]; readonly boards: Entity[]; readonly prints: Entity[]; readonly books: Entity[]; readonly pads: Entity[]; /** A plugin's objects (K8b). */ readonly plugins: Entity[] }

/** The committed print a rig lays down: its picture's hash in the desk's BlobStore (preloaded on the photo kind) and its size. */
export interface PrintFixture { readonly hash: string; readonly w: number; readonly h: number }

/** What `rig.html`'s harness hands the app. */
export interface DeskRig {
  /** Stage an oracle scene (packages/objects/oracle/scenes.mjs's shape) into the world. */
  setScene(host: SceneHost, scene: object): Promise<Staged>;
  /** The oracle's photo fixture, put in the BlobStore and preloaded. */
  printFixture(handle: DeskLayerHandle): Promise<PrintFixture>;
  /** Object types the rig registers on the desk engine before it is made (K5a: rig:tray's plugin fixture, under `?trayPlugin`). */
  readonly widgets?: readonly WidgetType[];
  /**
   * The host's options the rig's page mounts the layer with — a host's chrome as VibeField sets it (I20: `?hold=top,band,travelMs`; I21:
   * `?trayFoot=px`; I26: `?cursors=false`, the room's people drawn by the host itself) and object types of the LAYER's own beside the
   * engine's (I25: `?kindFaults`). Read at every mount: a rig may set it before `__desk.remount()`, and the next generation mounts with
   * what it says then (petition I25 — a host changes its kinds by a remount).
   */
  layer?: RigLayer;
  /**
   * THE RIG'S LIVE SOURCE (M24 LT1 — `?live`; src/rig/live-source.ts `RigLive`): what the harness lends the rig's live kind under `LIVE`
   * (the layer's `services`, its writers made on the layer's device through `onDevice`) — `rig:live` ticks it, holds it still and reads
   * what it was asked, in the page. Typed by its shape nowhere here: the product reaches this module, and nothing of src/rig/.
   */
  readonly live?: unknown;
}

/** The layer options a rig's page may mount with (the product page mounts with none of them; `services` and `onDevice`: `?live`'s source). */
export type RigLayer = Pick<DeskLayerOptions, "hold" | "tray" | "objects" | "cursors" | "services" | "onDevice">;

declare global {
  interface Window {
    /** Set by `src/rig/harness.ts` on `rig.html`; absent on the product page. */
    __deskRig?: DeskRig;
  }
}

/** The layer options the rigs' harness asked for (`{}` on the product page, and on a rig page that asked none). */
export const rigLayer = (): RigLayer => (typeof window === "undefined" ? {} : (window.__deskRig?.layer ?? {}));

/** The harness, or a refusal that names the page to open. */
export function deskRig(): DeskRig {
  const rig = typeof window === "undefined" ? undefined : window.__deskRig;
  if (rig === undefined) throw new Error("desk: the rigs' door is closed on the product page — the oracle's scenes and fixtures load on rig.html");
  return rig;
}
