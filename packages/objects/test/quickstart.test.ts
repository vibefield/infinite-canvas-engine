// @vitest-environment node
// THE PUBLISHED QUICKSTART RUNS (design-015 D7, the surface review's #1): the READMEs' code imports only
// what the umbrella publishes — no `./palette` the package does not ship — and every name it imports is
// an export of that entry; the shipped default palette answers every reference kind's look in both themes
// (until D7 the only complete palette was the oracle's fixture, and `deskLayer` threw at the mount on the
// documented `{ canvasBg, select }`); a mount whose palette cannot answer leaves NOTHING behind (the canvas,
// the reduced-motion listener); and `DESK_ENGINE` is the desk the README promises — the plain wheel pans, pinch zooms
// about the pointer, a bare-mat drag pans, the zoom is scale-free, the zoom-through is on.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ActiveTool, Camera, CameraLimits, createCanvasEngine, GestureSettings, NO_MODS, Viewport, ZoomThroughSettings } from "@ice/core";
import { screenToWorld } from "@ice/kernel";
import { describe, expect, it } from "vitest";
import { looksOf } from "../../desk/src/compose/reflector";
import { deskLayer, type KindPalette, MAT_COLORS, objectKindOf, type ObjectKind, rgb } from "@ice/desk";
import { ZOOM_MAX, ZOOM_MIN } from "@ice/desk";
import { DESK_ENGINE, DESK_OBJECTS, deskPalette, deskSelect, deskTheme } from "../src";
import { PALETTE } from "../src/palette";
import { fakePage } from "../../desk/test/fake-page";

const repo = resolve(import.meta.dirname, "../../..");
const umbrella = resolve(repo, "packages/ice");
const READMES = ["packages/ice/README.md", "README.md"];

/** The first tsx block of a README — the quickstart. */
function quickstart(readme: string): string {
  const text = readFileSync(resolve(repo, readme), "utf8");
  const m = /```tsx\n([\s\S]*?)```/.exec(text);
  if (m === null) throw new Error(`${readme}: no tsx block`);
  return m[1] as string;
}

/** Each `import { a, type B } from "spec"` of a block: the specifier and its VALUE names. */
function importsOf(code: string): { spec: string; names: string[] }[] {
  return [...code.matchAll(/import\s*\{([^}]*)\}\s*from\s*"([^"]+)"/g)].map((m) => ({
    spec: m[2] as string,
    names: (m[1] as string).split(",").map((n) => n.trim()).filter((n) => n !== "" && !n.startsWith("type ")),
  }));
}

/** The umbrella's source module for a published specifier (`@vibecook/ice/desk` → `packages/ice/src/desk.ts`), from its exports map. */
function entryOf(spec: string): string | undefined {
  const pkg = JSON.parse(readFileSync(resolve(umbrella, "package.json"), "utf8")) as { name: string; exports: Record<string, { default?: string } | string> };
  if (spec !== pkg.name && !spec.startsWith(`${pkg.name}/`)) return undefined;
  const target = pkg.exports[`.${spec.slice(pkg.name.length)}`];
  const dist = typeof target === "string" ? target : target?.default;
  const m = dist === undefined ? null : /^\.\/dist\/(.+)\.js$/.exec(dist);
  return m === null ? undefined : resolve(umbrella, "src", `${m[1]}.ts`);
}

const deskKinds = (): ObjectKind[] => DESK_OBJECTS.map((t) => objectKindOf(t)).filter((k): k is ObjectKind => k !== undefined);

describe("the published quickstart (design-015 D7)", () => {
  it("imports only what the umbrella publishes, and every name it imports is an export of that entry", async () => {
    for (const readme of READMES) {
      const imports = importsOf(quickstart(readme));
      expect(imports.length, `${readme}: the quickstart imports`).toBeGreaterThan(0);
      for (const { spec, names } of imports) {
        // a quickstart names the package's entries and React's root — never a module of the reader's own (the model app's palette was one)
        expect(spec.startsWith("@vibecook/ice") || spec === "react-dom/client", `${readme}: "${spec}" is not a published entry`).toBe(true);
        if (spec === "react-dom/client") continue;
        const file = entryOf(spec);
        expect(file, `${readme}: "${spec}" is not in the umbrella's exports map`).toBeDefined();
        const mod = (await import(file as string)) as Record<string, unknown>;
        const missing = names.filter((n) => mod[n] === undefined);
        expect(missing, `${readme}: "${spec}" does not export`).toEqual([]);
      }
    }
  });

  it("the shipped palette answers every reference kind's look, in both themes", () => {
    const kinds = deskKinds();
    expect(kinds.length).toBe(DESK_OBJECTS.length);
    for (const name of ["light", "dark"] as const) {
      const looks = looksOf(kinds, deskPalette(name), deskTheme(name));
      expect([...looks.keys()].sort()).toEqual(kinds.filter((k) => k.theme !== undefined).map((k) => k.name).sort());
    }
    // the documented roles alone answer none of the looks — the reason the default ships
    expect(() => looksOf(kinds, PALETTE.light, deskTheme("light"))).toThrow(/palette/);
  });

  it("the cast colour a plugin kind's theme is handed is the mat's own in both stock themes (petition I46)", () => {
    const plugin = { name: "plugin", theme: (palette: KindPalette) => rgb(palette.cast.css) } as unknown as ObjectKind;
    for (const name of ["light", "dark"] as const) {
      expect(looksOf([...deskKinds(), plugin], deskPalette(name), deskTheme(name)).get("plugin")).toEqual(MAT_COLORS.cast);
    }
  });

  it("a mount whose palette cannot answer throws and leaves nothing behind — no canvas in the container, no reduced-motion listener", () => {
    const ce = createCanvasEngine(DESK_ENGINE);
    ce.docs.create();
    const page = fakePage();
    const { stack } = ce;
    const factory = deskLayer({ theme: deskTheme("light"), palette: PALETTE.light, objects: [...DESK_OBJECTS] });
    const mount = () => factory({
      host: { container: page.container } as never, world: ce.world,
      framePick: stack.framePick, navGeometry: stack.navGeometry, heldPose: stack.heldPose,
      transitions: ce.transitions, catalog: ce.catalog, readMarquee: () => stack.marqueeBuffer, spatial: stack.index,
    });
    expect(mount).toThrow(/palette/);
    expect(page.children).toEqual([]);
    expect(page.listeners.size).toBe(0);
    ce.dispose();
  });

  it.each([0.5, 2])("DESK_ENGINE preserves native pinch scale %s and the pointer anchor, independent of event splitting", (scale) => {
    // Native macOS magnification is encoded by Chromium as deltaY = -100 * log(scale):
    // https://chromium.googlesource.com/chromium/src/+/main/components/input/touchpad_pinch_event_queue.cc
    for (const events of [1, 8]) {
      const ce = createCanvasEngine(DESK_ENGINE);
      try {
        ce.docs.create();
        ce.step(16);
        const initial = { x: 80, y: -40, zoom: 1.5, gesturing: false };
        ce.world.setResource(Camera, initial);
        ce.world.setResource(Viewport, { w: 800, h: 600, dpr: 1 });
        const anchor = { x: 420, y: 310 };
        const held = screenToWorld(anchor.x, anchor.y, initial);
        for (let i = 0; i < events; i++) {
          ce.stack.queue.enqueue({
            kind: "wheel", pointerId: "mouse", device: "mouse",
            screenX: anchor.x, screenY: anchor.y, buttons: 0,
            mods: { ...NO_MODS, ctrl: true },
            wheel: { dx: 0, dy: 0, pinch: -100 * Math.log(scale) / events },
          });
          ce.step(32 + i * 16);
        }
        const camera = ce.world.getResource(Camera);
        expect(camera).toBeDefined();
        if (camera === undefined) throw new Error("Camera unset");
        expect(camera.zoom).toBeCloseTo(initial.zoom * scale, 6);
        const after = screenToWorld(anchor.x, anchor.y, camera);
        expect(after.x).toBeCloseTo(held.x, 6);
        expect(after.y).toBeCloseTo(held.y, 6);
      } finally {
        ce.dispose();
      }
    }
  });

  it("DESK_ENGINE is the desk the README promises: the plain wheel pans, pinch zooms, a bare-mat drag pans (shift marquees), the zoom is scale-free, the zoom-through is on", () => {
    const ce = createCanvasEngine(DESK_ENGINE);
    ce.docs.create();
    expect(ce.world.getResource(GestureSettings)).toMatchObject({ wheel: "pan", wheelZoomCurve: "exponential" });
    const limits = ce.world.getResource(CameraLimits);
    expect(Math.abs((limits?.minZoom ?? 0) / ZOOM_MIN - 1)).toBeLessThan(1e-6);
    expect(Math.abs((limits?.maxZoom ?? 0) / ZOOM_MAX - 1)).toBeLessThan(1e-6);
    expect(ce.world.getResource(ZoomThroughSettings)?.enabled).toBe(true);
    expect(ce.world.getResource(ActiveTool)?.id).toBe(deskSelect.id);
    expect(deskSelect.route).toMatchObject({ canvasDrag: "pan", canvasDragShift: "marquee" });
    ce.dispose();
  });
});
