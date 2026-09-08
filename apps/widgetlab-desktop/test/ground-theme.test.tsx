/**
 * LIGHT MODE (design-013 C4, D-C4.12) — the desktop app's blocker.
 *
 * The C2 ground is OPAQUE: its canvas clears to `theme.canvasBg` and the DOM planes
 * sit above it. `App.tsx` painted `--canvas-bg` from its dark toggle and handed BOTH
 * ground arms `THEMES.dark`, so light mode was `#171717` under a `#FAFAFA` page with
 * the light dot colour drawn on it — the composited arm since B8, the stratified arm
 * since C2.
 *
 * Two levels here. The projection itself (`groundThemeFor`): the app's background and
 * dot ink substituted into the product palette, with every other role — the card, the
 * frame, the hairline, the accent, and the pack sections the `vf-frame` card program
 * reads — left exactly as `THEMES` has them, so the card frame keeps its look. And the
 * App end to end, headless: what the ground FACTORY was handed, against what the page
 * actually paints, in both modes and across a real click on the toggle.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** Every theme the App's ground factory was built with, and every live re-projection. */
const built: Array<{ canvasBg: readonly [number, number, number] }> = [];
const reprojected: Array<{ canvasBg: readonly [number, number, number] }> = [];
vi.mock("@ice/ground", async (original) => {
  const real = (await original()) as Record<string, unknown>;
  const groundField = real.groundField as (o: { theme?: { canvasBg: readonly [number, number, number] } }) => (
    ctx: unknown,
  ) => { field: { setTheme(t: unknown): void } };
  return {
    ...real,
    groundField: (opts: { theme?: { canvasBg: readonly [number, number, number] } }) => {
      if (opts.theme !== undefined) built.push(opts.theme);
      const factory = groundField(opts);
      return (ctx: unknown) => {
        const handle = factory(ctx);
        const field = handle.field;
        return {
          ...handle,
          field: {
            ...field,
            setTheme: (t: { canvasBg: readonly [number, number, number] }) => {
              reprojected.push(t);
              field.setTheme(t);
            },
          },
        };
      };
    },
  };
});

import { THEMES } from "@ice/ground/oracle/fixtures/vf-theme";
import { App } from "../src/App";
import { DEFAULT_THEME_COLORS, groundThemeFor, pageBackground } from "../src/ground-theme";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** `#RRGGBB` → the bytes a `GroundTheme`'s 0..1 triple rounds to. */
const hexBytes = (hex: string): [number, number, number] => {
  const s = hex.replace("#", "");
  return [
    Number.parseInt(s.slice(0, 2), 16),
    Number.parseInt(s.slice(2, 4), 16),
    Number.parseInt(s.slice(4, 6), 16),
  ];
};
const bytes = (c: readonly [number, number, number]): [number, number, number] => [
  Math.round(c[0] * 255),
  Math.round(c[1] * 255),
  Math.round(c[2] * 255),
];

describe("the app's ground theme projection", () => {
  it("carries the app's OWN background into the ground, per mode", () => {
    expect(bytes(groundThemeFor(false, DEFAULT_THEME_COLORS).canvasBg)).toEqual(hexBytes(DEFAULT_THEME_COLORS.bgLight));
    expect(bytes(groundThemeFor(true, DEFAULT_THEME_COLORS).canvasBg)).toEqual(hexBytes(DEFAULT_THEME_COLORS.bgDark));
    // …and the two modes are not the same board.
    expect(groundThemeFor(false, DEFAULT_THEME_COLORS).canvasBg).not.toEqual(
      groundThemeFor(true, DEFAULT_THEME_COLORS).canvasBg,
    );
  });

  it("carries the app's own dot ink, and follows a re-tune of either", () => {
    expect(bytes(groundThemeFor(true, DEFAULT_THEME_COLORS).fieldInk)).toEqual(hexBytes(DEFAULT_THEME_COLORS.dotDark));
    const tuned = { ...DEFAULT_THEME_COLORS, bgLight: "#102030", dotLight: "#405060" };
    expect(bytes(groundThemeFor(false, tuned).canvasBg)).toEqual([0x10, 0x20, 0x30]);
    expect(bytes(groundThemeFor(false, tuned).fieldInk)).toEqual([0x40, 0x50, 0x60]);
  });

  it("leaves every other role — and the card program's pack — as the product palette has it", () => {
    for (const dark of [false, true]) {
      const projected = groundThemeFor(dark, DEFAULT_THEME_COLORS);
      const product = THEMES[dark ? "dark" : "light"];
      expect(projected.name).toBe(product.name);
      expect(projected.card).toEqual(product.card);
      expect(projected.hairline).toEqual(product.hairline);
      expect(projected.select).toEqual(product.select);
      expect(projected.lineInk).toEqual(product.lineInk);
      expect(projected.fieldInkAlpha).toBe(product.fieldInkAlpha);
      // The frame's roles ride `themeFrom`'s packs — a projection that dropped them
      // would draw every card frame in the program's fallback.
      expect(Object.keys(projected.packs).sort()).toEqual(Object.keys(product.packs).sort());
      expect(projected.packs["vf-frame"]).toEqual(product.packs["vf-frame"]);
      expect(projected.packs.mat).toEqual(product.packs.mat);
    }
  });

  it("names the page background the CSS variable carries", () => {
    expect(pageBackground(false, DEFAULT_THEME_COLORS)).toBe(DEFAULT_THEME_COLORS.bgLight);
    expect(pageBackground(true, DEFAULT_THEME_COLORS)).toBe(DEFAULT_THEME_COLORS.bgDark);
  });
});

describe("the App hands the ground the theme its page paints", () => {
  let root: Root | null = null;
  beforeEach(() => {
    built.length = 0;
    reprojected.length = 0;
    localStorage.clear();
    document.documentElement.style.removeProperty("--canvas-bg");
  });
  afterEach(() => {
    if (root) act(() => root?.unmount());
    root = null;
    document.body.innerHTML = "";
  });

  const mount = async (): Promise<HTMLElement> => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(createElement(App));
    });
    return container;
  };
  const pageBg = (): string => document.documentElement.style.getPropertyValue("--canvas-bg").trim();

  for (const dark of [false, true]) {
    it(`agrees with --canvas-bg in ${dark ? "dark" : "light"} mode`, async () => {
      localStorage.setItem("ic-dark-mode", String(dark));
      await mount();
      expect(built).toHaveLength(1); // the mount built the ground once
      expect(pageBg().toLowerCase()).toBe(pageBackground(dark, DEFAULT_THEME_COLORS).toLowerCase());
      // THE CLAIM: the opaque ground clears to what the page paints. Handing it
      // `THEMES.dark` under a `#FAFAFA` page is the blocker — a dark board.
      expect(bytes((built[0] as { canvasBg: readonly [number, number, number] }).canvasBg)).toEqual(hexBytes(pageBg()));
    });
  }

  it("re-projects the LIVE layer on a toggle — no re-boot, and the page moves with it", async () => {
    localStorage.setItem("ic-dark-mode", "false");
    const container = await mount();
    expect(pageBg().toLowerCase()).toBe(DEFAULT_THEME_COLORS.bgLight.toLowerCase());
    const builtAtMount = built.length;

    const toggle = container.querySelector('button[title="Switch to dark mode"]');
    expect(toggle).not.toBeNull();
    await act(async () => {
      (toggle as HTMLButtonElement).click();
    });

    expect(pageBg().toLowerCase()).toBe(DEFAULT_THEME_COLORS.bgDark.toLowerCase());
    expect(reprojected.length).toBeGreaterThan(0);
    const last = reprojected[reprojected.length - 1] as { canvasBg: readonly [number, number, number] };
    expect(bytes(last.canvasBg)).toEqual(hexBytes(DEFAULT_THEME_COLORS.bgDark));
    // The factory identity is memoised on `gpu` alone: a theme switch must not re-boot
    // the canvas mount effect (which would rebuild the ground layer from scratch).
    expect(built).toHaveLength(builtAtMount);
  });
});
