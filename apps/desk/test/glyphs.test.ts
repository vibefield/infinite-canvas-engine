/**
 * The rulers' atlas follows the desk (K1, design-016 §3 step 3): `glyphFeed` re-renders and uploads the atlas only when the ratio
 * the desk draws at (the viewport's, under the layer's cap) or the rulers' text size moved, never before the mat is there to take
 * it (an upload into no ground is dropped while its key would be kept), and says it is `stale` — without rendering — so the app's
 * tick runs only then. (The viewport's ratio itself is the host's: @ice/dom's desk-host.test.ts.) Doubles for the renderer: the
 * canvas work is the browser's (rig:ruler witnesses it live).
 */
import type { GlyphAtlasMeta } from "@ice/desk";
import { describe, expect, it } from "vitest";
import { deskScale, type GlyphAtlas, glyphFeed } from "../src/glyphs";

describe("the desk's scale", () => {
  it("is the viewport's ratio under the layer's cap of 2", () => {
    expect(deskScale(3)).toBe(2);
    expect(deskScale(1.5)).toBe(1.5);
    expect(deskScale(0)).toBe(1);
  });
});

describe("glyphFeed", () => {
  /** A feed over doubles: a renderer that records what it was asked for, an upload that records what it took. */
  function feed(start: { ready: boolean; scale: number; size: number }) {
    const s = { ...start };
    const made: string[] = [];
    const uploaded: GlyphAtlasMeta[] = [];
    const make = (size: number, scale: number): GlyphAtlas => {
      made.push(`${scale}:${size}`);
      const meta: GlyphAtlasMeta = { scale, cellW: 1, cellH: 1, advance: 1, baseline: 1, cap: 1, width: 1, height: 1, count: 12 };
      return { bytes: new Uint8Array(1), meta };
    };
    const f = glyphFeed({ ready: () => s.ready, scale: () => s.scale, size: () => s.size, upload: (a) => uploaded.push(a.meta), make });
    return { s, made, uploaded, f };
  }

  it("renders nothing before the mat is here, then once per ratio and text size — the same key twice is nothing", () => {
    const { s, made, uploaded, f } = feed({ ready: false, scale: 2, size: 10 });
    expect(f.refresh()).toBe(false);
    expect(made).toEqual([]);
    expect(f.last).toBeNull();
    s.ready = true;
    expect(f.refresh()).toBe(true);
    expect(f.refresh()).toBe(false);
    expect(made).toEqual(["2:10"]);
    expect(f.last?.key).toBe("2:10");
    expect(f.last?.meta).toBe(uploaded[0]);
    s.scale = 1;
    expect(f.refresh()).toBe(true);
    s.size = 14;
    expect(f.refresh()).toBe(true);
    expect(f.refresh()).toBe(false);
    expect(made).toEqual(["2:10", "1:10", "1:14"]);
    expect(uploaded.map((m) => m.scale)).toEqual([2, 1, 1]);
    expect(f.uploads).toBe(3);
  });

  it("is stale exactly when the ratio or the size moved since the last upload — answered without a render", () => {
    const { s, made, f } = feed({ ready: true, scale: 2, size: 10 });
    expect(f.stale()).toBe(false); // nothing uploaded yet: the first upload is the app's boot, not the tick's
    f.refresh();
    expect(f.stale()).toBe(false);
    s.scale = 1;
    expect(f.stale()).toBe(true);
    expect(made).toEqual(["2:10"]);
    f.refresh();
    expect(f.stale()).toBe(false);
    s.size = 12;
    expect(f.stale()).toBe(true);
  });
});
