// The Node oracle's OWN scene builder (oracle/frame.mjs `createOracleDesk`) on a device of stubs — never a
// pixel, only its records: what a kind's world half must equal, number for number, for the same scene
// (design-015 D3w's parity-by-construction units). The pixels stay the oracle's (Dawn) and the rigs'.

import { createOracleDesk } from "../../desk/oracle/frame.mjs";
import { ORACLE_SCENES } from "../../desk/oracle/scenes.mjs";
import { blueNoise } from "@ice/desk";
import { shaderText } from "../src/shaders";
import { fakeDevice, installGpuFlags } from "../../desk/test/fake-gpu";

/** The oracle desk's internals a unit reads (frame.mjs returns them; its .d.mts declares only `encode`). */
export interface OracleInternals {
  readonly boards: { look: unknown; replay(id: number, ops: unknown): void; ensure(id: number, s: readonly [number, number]): boolean };
  readonly photos: { picture(bytes: Uint8Array, w: number, h: number): unknown };
  readonly notebooks: unknown;
  readonly calendars: unknown;
  boardPoseOf(b: Record<string, unknown>): Record<string, unknown>;
  printOf(p: Record<string, unknown>): Record<string, unknown>;
  /** A book as a desk draws it: the lab's `notebookDraw`, its ring retired unless the still is drawn the prototype's way. */
  bookOf(b: Record<string, unknown>): unknown;
  /** The notebooks' page layers as this scene's books drew them (D3t-b — the kind's own cache). */
  pages(): import("../src/notebook/pages").PageInk;
  /** A still's marks as the oracle assembles them (D4a): each bracketed or ticked object's frame ON SCREEN. */
  marksOf(s: unknown, cam: { readonly x: number; readonly y: number; readonly zoom: number }): { readonly objects: readonly { readonly frame: import("@ice/desk/kit").MarkFrame; readonly style: string; readonly knobs: boolean }[] };
  encode(encoder: GPUCommandEncoder, target: GPUTextureView, size: { w: number; h: number }, scene: unknown): unknown;
}

/** The oracle desk on a fake device, with the committed picture's metadata when `photo` says (its bytes are zeros). */
export async function fakeOracle(opts: { readonly photo?: { readonly w: number; readonly h: number } } = {}): Promise<{ desk: OracleInternals; device: GPUDevice; undo: () => void }> {
  const undo = installGpuFlags();
  const { device } = fakeDevice();
  const plate = new Uint8Array(512 * 512 * 4);
  const photo = opts.photo;
  const desk = await createOracleDesk({
    device, format: "rgba8unorm", text: shaderText,
    assets: {
      noise: blueNoise(), goboC: plate, goboB: plate, glyphMeta: null, glyphs: null, inkMeta: null, ink: null,
      photoMeta: photo ?? null, photo: photo ? new Uint8Array(photo.w * photo.h * 4) : null,
    },
    log: () => {},
  });
  return { desk: desk as unknown as OracleInternals, device, undo };
}

/** An oracle scene's still by name (scenes.mjs; its .d.mts types the spec as `unknown` — a unit names the fields it reads). */
export function sceneOf<T = Record<string, unknown>>(name: string): T {
  const sc = ORACLE_SCENES.find((q) => q.name === name);
  if (sc === undefined) throw new Error(`no oracle scene "${name}"`);
  return sc.scene as T;
}

/** A command encoder of stubs for `encode` (its passes log nothing). */
export function fakeEncoder(device: GPUDevice): GPUCommandEncoder { return device.createCommandEncoder(); }
