// K9 (the law review's #2): a kind whose local declares `tick` and no `due` is due every frame, so the desk never sleeps (K7a's
// registered wakes — `KindLocal.due`: "a kind that never said keeps the desk awake"). The contract said so and nothing told the
// author; the first plugin shaped like the pre-K7a six would lose the idle gate with no rig to see it (it submits nothing). The
// desk layer says it at the mount that meets such a kind — once a page, naming the kind. A kind of the test's own, as a plugin's.
import { createCanvasEngine, type WidgetType } from "@ice/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { deskLayer } from "../src/host/layer";
import type { KindPass } from "../src/kind";
import type { KindLocal, ObjectKind } from "../src/kinds/world";
import { defineObject } from "../src/object";
import { type Palette, themeFrom } from "../src/theme";
import { fakePage } from "./fake-page";

const PALETTE: Palette = { canvasBg: { token: "--bg", css: "#101010" }, select: { token: "--sel", css: "#3080ff" } };

/** An object whose kind's desk state is `local` (a fresh one per desk); no pass is ever made — no device boots here. */
function objectWith(name: string, local: () => KindLocal): WidgetType {
  const kind: ObjectKind = { name, stratum: "things", reach: 0, create: async () => ({}) as KindPass, resolve: () => ({}), record: () => ({}), hit: () => null, local };
  return defineObject({ type: `test.${name}`, version: 1, props: {}, kind });
}

/** One desk over `objects`, mounted as the host mounts it; returns its end. */
function mountDesk(objects: WidgetType[]): () => void {
  const ce = createCanvasEngine({ widgets: objects });
  ce.docs.create();
  const { stack } = ce;
  const handle = deskLayer({ theme: themeFrom("light", PALETTE), palette: PALETTE, objects })({
    host: { container: fakePage().container } as never, world: ce.world,
    framePick: stack.framePick, navGeometry: stack.navGeometry, heldPose: stack.heldPose,
    transitions: ce.transitions, catalog: ce.catalog, readMarquee: () => stack.marqueeBuffer, spatial: stack.index, frame: ce.engine.frame,
  });
  return () => { handle.dispose(); ce.dispose(); };
}

/** What the desk said about kinds keeping it awake. */
const toldOf = (warn: { mock: { calls: unknown[][] } }): string[] => warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes("declares a local `tick` and no `due`"));

describe("a kind that ticks with no `due` is told it keeps the desk awake (K9)", () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it("once a page, naming the kind — a second desk over it (a StrictMode remount, another view) says nothing more", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});   // no device here: the boot's refusal is not this test's
    const Restless = objectWith("restless", () => ({ tick: () => false }));
    const ends = [mountDesk([Restless]), mountDesk([Restless])];
    const told = toldOf(warn);
    expect(told).toHaveLength(1);
    expect(told[0]).toContain('the kind "restless" declares a local `tick` and no `due`');
    expect(told[0]).toContain("the desk never sleeps");
    for (const end of ends) end();
  });

  it("a tick that says when it is next due, or no tick at all: nothing to tell", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const Timed = objectWith("timed", () => ({ tick: () => false, due: () => Number.POSITIVE_INFINITY }));
    const Still = objectWith("still", () => ({}));
    const end = mountDesk([Timed, Still]);
    expect(toldOf(warn)).toEqual([]);
    end();
  });
});
