// THE HAND'S FACES as a service (petition I59 — kit/hand-faces.ts `HAND_FACES`, host/hand.ts `handFaces`, `deskLayer({ hand })`).
// Pinned: the in-memory faces answer at once and never move; the browser's are fetched once each, on the first ask, both files,
// read by the kit's reader — undefined until they land, then the atlas, the version bumped and the listeners told once; a face
// that 404s or does not read is said (and its sheets keep their raster), the version bumped all the same; the layer lends `hand`
// to every kind under `HAND_FACES` and wakes the desk when its version moves — and stops listening when it ends.
import { createCanvasEngine } from "@ice/core";
import { describe, expect, it, vi } from "vitest";
import { handFaces } from "../src/host/hand";
import { deskLayer } from "../src/host/layer";
import type { KindPass } from "../src/kind";
import type { KindHost, ObjectKind } from "../src/kinds/world";
import { HAND_FACES, type HandFaces, handFacesOf } from "../src/kit/hand-faces";
import { defineObject } from "../src/object";
import { type Palette, themeFrom } from "../src/theme";
import { fakePage } from "./fake-page";
import { fixtureFace } from "./hand-fixture";

const face = fixtureFace();

/** A fetch over named files: each URL's json or bytes, a status for one that is missing; the URLs asked, in order. */
function files(table: Readonly<Record<string, unknown>>) {
  const asked: string[] = [];
  const fetch = async (url: string) => {
    asked.push(url);
    const v = table[url];
    return {
      ok: v !== undefined, status: v === undefined ? 404 : 200,
      json: async () => v,
      arrayBuffer: async () => { const b = v as Uint8Array; return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer; },
    };
  };
  return { fetch, asked };
}
const settle = async (): Promise<void> => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); };

describe("the hand's faces (petition I59)", () => {
  it("faces a host holds answer at once, by name, and never move", () => {
    const faces = handFacesOf({ caveat: face.atlas });
    expect(faces.face("caveat")).toBe(face.atlas);
    expect(faces.face("kalam")).toBeUndefined();
    expect(faces.version()).toBe(0);
    expect(faces.onVersion).toBeUndefined();
  });

  it("a browser's are fetched once each, on the first ask — undefined until both files land, then the atlas, the desk told once", async () => {
    const { fetch, asked } = files({ "c.json": face.json, "c.bin": face.bin });
    const faces = handFaces({ faces: { caveat: { json: "c.json", bin: "c.bin" } }, fetch });
    const heard = vi.fn();
    const stop = faces.onVersion(heard);
    expect(asked).toEqual([]);   // nothing fetched before a sheet asks
    expect(faces.face("caveat")).toBeUndefined();
    expect(faces.face("caveat")).toBeUndefined();
    await settle();
    expect(asked).toEqual(["c.json", "c.bin"]);
    expect(faces.ready("caveat")).toBe(true);
    const got = faces.face("caveat");
    expect(got?.family).toBe("Fixture");
    expect(got?.bin.length).toBe(face.bin.length);
    expect(faces.version()).toBe(1);
    expect(heard).toHaveBeenCalledTimes(1);
    faces.face("caveat");
    await settle();
    expect(asked.length).toBe(2);
    stop();
  });

  it("a face that 404s, or does not read, is said once and stays undefined — its sheets keep their raster — the version bumped all the same", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { fetch } = files({ "k.json": face.json, "bad.json": { format: "ice-hand/0" }, "bad.bin": face.bin });
      const faces = handFaces({ faces: { kalam: { json: "k.json", bin: "k.bin" }, bad: { json: "bad.json", bin: "bad.bin" } }, fetch });
      expect(await faces.load("kalam")).toBe(false);
      expect(faces.failed("kalam")).toBe("its bin answered 404");
      expect(await faces.load("bad")).toBe(false);
      expect(faces.failed("bad")).toMatch(/not an ice-hand\/1 atlas/);
      expect(faces.face("kalam")).toBeUndefined();
      expect(faces.version()).toBe(2);
      expect(error).toHaveBeenCalledTimes(2);
      // a name the desk lends no file for is answered undefined, and nothing is fetched or said
      expect(await faces.load("marker")).toBe(false);
      expect(error).toHaveBeenCalledTimes(2);
    } finally {
      error.mockRestore();
    }
  });
});

describe("the layer lends the hand's faces and wakes for them (petition I59 — `deskLayer({ hand })`, as `text`)", () => {
  const PALETTE: Palette = { canvasBg: { token: "--bg", css: "#101010" }, select: { token: "--sel", css: "#3080ff" } };

  it("every kind's world half uses them by HAND_FACES; a version moved wakes the desk; the layer's end stops listening", () => {
    const hosts: KindHost[] = [];
    const kind: ObjectKind = { name: "pen-user", stratum: "things", reach: 0, create: async () => ({}) as KindPass, resolve: () => ({}), record: () => ({}), hit: () => null, local: (host) => { hosts.push(host); return {}; } };
    const Pen = defineObject({ type: "test.pen-user", version: 1, props: {}, kind });
    let told: (() => void) | undefined;
    let stopped = 0;
    const faces: HandFaces = { face: () => face.atlas, version: () => 0, onVersion: (fn) => { told = fn; return () => { stopped += 1; }; } };
    const ce = createCanvasEngine({ widgets: [Pen] });
    ce.docs.create();
    const page = fakePage();
    const wake = vi.spyOn(ce.engine.frame, "wake");
    const { stack } = ce;
    const handle = deskLayer({ theme: themeFrom("light", PALETTE), palette: PALETTE, objects: [Pen], hand: faces })({
      host: { container: page.container } as never, world: ce.world,
      framePick: stack.framePick, navGeometry: stack.navGeometry, heldPose: stack.heldPose,
      transitions: ce.transitions, catalog: ce.catalog, readMarquee: () => stack.marqueeBuffer, spatial: stack.index, frame: ce.engine.frame,
    });
    try {
      expect(hosts[0]?.use?.(HAND_FACES)).toBe(faces);
      expect(told).toBeTypeOf("function");
      wake.mockClear();
      told?.();
      expect(wake).toHaveBeenCalledWith("desk:hand");
    } finally {
      handle.dispose();
      ce.dispose();
    }
    expect(stopped).toBe(1);
  });
});
