/**
 * The rulers' atlas follows the device (K1, design-016 §3 step 3): `watchRatio` hears every change of the device's pixel ratio —
 * a media query on the CURRENT ratio, re-armed on the new one (a ratio change alone fires no ResizeObserver; the prototype's
 * `watchRatio`) — and `glyphFeed` re-renders and uploads the atlas only when the ratio or the rulers' text size moved, and never
 * before the mat is there to take it (an upload into no ground is dropped while its key would be kept). Doubles for the window
 * and the renderer: the canvas work is the browser's (rig:ruler witnesses it live).
 */
import type { GlyphAtlasMeta } from "@ice/desk";
import { describe, expect, it } from "vitest";
import { deskScale, type GlyphAtlas, glyphFeed, type RatioWindow, watchRatio } from "../src/glyphs";

/** A window whose ratio a test moves: each media query it hands out is live for the ratio it names, and `change` fires `once` listeners once. */
function fakeWindow(ratio: number) {
  const queries: { query: string; listeners: Set<() => void> }[] = [];
  const win = {
    devicePixelRatio: ratio,
    matchMedia(query: string) {
      const q = { query, listeners: new Set<() => void>() };
      queries.push(q);
      return {
        addEventListener: (_type: string, fn: () => void) => { q.listeners.add(fn); },
        removeEventListener: (_type: string, fn: () => void) => { q.listeners.delete(fn); },
      };
    },
  };
  /** The device's ratio moves: every query that named the old one reports a change (and its `once` listeners go). */
  const move = (next: number): void => {
    const was = win.devicePixelRatio;
    win.devicePixelRatio = next;
    for (const q of queries) {
      if (q.query !== `(resolution: ${was}dppx)`) continue;
      const fns = [...q.listeners];
      q.listeners.clear();
      for (const fn of fns) fn();
    }
  };
  const armed = (): string[] => queries.filter((q) => q.listeners.size > 0).map((q) => q.query);
  return { win: win as unknown as RatioWindow, move, armed };
}

describe("watchRatio", () => {
  it("hears every change of the ratio — re-armed on the new one each time — until unwatched", () => {
    const { win, move, armed } = fakeWindow(2);
    const heard: number[] = [];
    const unwatch = watchRatio((r) => heard.push(r), win);
    expect(armed()).toEqual(["(resolution: 2dppx)"]);
    move(1);
    expect(heard).toEqual([1]);
    expect(armed()).toEqual(["(resolution: 1dppx)"]);
    move(2);
    move(1.5);
    expect(heard).toEqual([1, 2, 1.5]);
    unwatch();
    expect(armed()).toEqual([]);
    move(3);
    expect(heard).toEqual([1, 2, 1.5]);
  });

  it("the desk's scale is the ratio under the layer's cap of 2", () => {
    expect(deskScale({ devicePixelRatio: 3 })).toBe(2);
    expect(deskScale({ devicePixelRatio: 1.5 })).toBe(1.5);
    expect(deskScale({ devicePixelRatio: 0 })).toBe(1);
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
});
