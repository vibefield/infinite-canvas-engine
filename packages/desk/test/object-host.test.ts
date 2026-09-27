// K4b (design-016 §5 · K-L2): an object DECLARES its DOM half — `defineObject({ host: { lend, editor, mount } })` — and the desk
// layer builds whatever the registered objects declare, generically: it never finds a half by type or names a kind. Until K4b
// the layer built the note's editor and the calendar's input itself (`host/layer.ts`, found by type), which no plugin kind could
// have. Here a THIRD-PARTY object — a kind of the test's own, no reference kind in sight — lends its world half a service, makes
// the desk's one editor, and mounts a half that borrows it. The halves are made at the mount, before the device boots, so a
// fake page (the few members a mount reads) is enough.
import { createCanvasEngine, type WidgetType } from "@ice/core";
import { describe, expect, it } from "vitest";
import { deskLayer } from "../src/host/layer";
import type { KindPass } from "../src/kind";
import type { KindDriver, KindHost, ObjectDomHost, ObjectKind } from "../src/kinds/world";
import type { NoteEditor } from "../src/kit/editor";
import type { PrintRaster } from "../src/kit/print";
import type { TextRaster } from "../src/kit/raster";
import { defineObject, hostOf } from "../src/object";
import { type Palette, themeFrom } from "../src/theme";
import { fakePage } from "./fake-page";

const PALETTE: Palette = { canvasBg: { token: "--bg", css: "#101010" }, select: { token: "--sel", css: "#3080ff" } };

/** A kind of the test's own: no pass is ever made (no device boots), no geometry is ever asked. */
function scribbleKind(name: string, locals: KindHost[]): ObjectKind {
  return {
    name, stratum: "things", reach: 0,
    create: async () => ({}) as KindPass,
    resolve: () => ({}), record: () => ({}), hit: () => null,
    local: (host) => { locals.push(host); return {}; },
  };
}

/** What the halves were handed, in the order the layer called them. */
interface Calls { lend: { type: string; text: TextRaster | undefined }[]; editor: ObjectDomHost[]; mount: (ObjectDomHost & { editor: NoteEditor | undefined })[]; order: string[] }

function mountDesk(objects: WidgetType[], text?: TextRaster) {
  const ce = createCanvasEngine({ widgets: objects });
  ce.docs.create();
  const page = fakePage();
  const { stack } = ce;
  const handle = deskLayer({ theme: themeFrom("light", PALETTE), palette: PALETTE, objects, ...(text !== undefined ? { text } : {}) })({
    host: { container: page.container } as never, world: ce.world,
    framePick: stack.framePick, navGeometry: stack.navGeometry, heldPose: stack.heldPose,
    transitions: ce.transitions, catalog: ce.catalog, readMarquee: () => stack.marqueeBuffer, spatial: stack.index,
  });
  return { ce, page, handle };
}

const fakeEditor = (label: string): NoteEditor => ({ label, follow: () => {}, dispose: () => {} }) as unknown as NoteEditor;
const fakePrint = { hand: () => undefined } as unknown as PrintRaster;
const fakeText = { version: () => 0 } as unknown as TextRaster;

describe("an object's DOM half is DECLARED, and the desk builds what the objects declare (K4b)", () => {
  it("lend → the kind's local; editor → the desk's ONE editor; mount → handed its own object, driver and look, and the editor", () => {
    const calls: Calls = { lend: [], editor: [], mount: [], order: [] };
    const locals: KindHost[] = [];
    const driver: KindDriver = { follow: () => {}, idle: () => true };
    const made = fakeEditor("scribble's");
    const Scribble = defineObject({
      type: "test.scribble", version: 1, props: {}, kind: scribbleKind("scribble", locals),
      drivers: () => driver,
      host: {
        lend: (h) => { calls.order.push("lend"); calls.lend.push({ type: "test.scribble", text: h.text }); return { print: fakePrint }; },
        editor: (h) => { calls.order.push("editor"); calls.editor.push(h); return made; },
        mount: (h) => { calls.order.push("mount"); calls.mount.push(h); },
      },
    });
    expect(hostOf(Scribble)?.editor).toBeTypeOf("function");
    const { ce, handle } = mountDesk([Scribble], fakeText);
    try {
      // lent before the local, and the kind's world half reads what its DOM half lent (the calendar's print raster, as a plugin's)
      expect(calls.order).toEqual(["lend", "editor", "mount"]);
      expect(calls.lend).toEqual([{ type: "test.scribble", text: fakeText }]);
      expect(locals.map((h) => h.print)).toEqual([fakePrint]);
      // the halves are handed the object they were declared on and ITS driver — never found by type
      expect(calls.editor[0]?.object).toBe(Scribble);
      expect(calls.editor[0]?.driver).toBe(driver);
      expect(calls.mount[0]?.object).toBe(Scribble);
      expect(calls.mount[0]?.driver).toBe(driver);
      // the one editor it made is the desk's: the handle's door, and lent to every half that mounts
      expect(handle.editor()).toBe(made);
      expect(calls.mount[0]?.editor).toBe(made);
    } finally {
      handle.dispose();
      ce.dispose();
    }
  });

  it("the ONE editor: the first object that makes one owns it — no second is asked for — and a half that mounts borrows it whatever the order", () => {
    const asked: string[] = [];
    const borrowed: (NoteEditor | undefined)[] = [];
    const locals: KindHost[] = [];
    // registered FIRST: a half that only borrows — it still gets the editor an object after it makes
    const Borrower = defineObject({ type: "test.borrower", version: 1, props: {}, kind: scribbleKind("borrower", locals), host: { mount: (h) => { borrowed.push(h.editor); } } });
    const First = defineObject({ type: "test.first", version: 1, props: {}, kind: scribbleKind("first", locals), host: { editor: () => { asked.push("first"); return fakeEditor("first"); } } });
    const Second = defineObject({ type: "test.second", version: 1, props: {}, kind: scribbleKind("second", locals), host: { editor: () => { asked.push("second"); return fakeEditor("second"); } } });
    const { ce, handle } = mountDesk([Borrower, First, Second]);
    try {
      expect(asked).toEqual(["first"]);
      expect((handle.editor() as unknown as { label: string }).label).toBe("first");
      expect(borrowed).toEqual([handle.editor()]);
      // nothing lent: every kind's local sees no print raster
      expect(locals.map((h) => h.print)).toEqual([undefined, undefined, undefined]);
    } finally {
      handle.dispose();
      ce.dispose();
    }
  });

  it("a desk whose objects declare no DOM half has no editor, and the halves are asked for nothing", () => {
    const locals: KindHost[] = [];
    const Plain = defineObject({ type: "test.plain", version: 1, props: {}, kind: scribbleKind("plain", locals) });
    expect(hostOf(Plain)).toBeUndefined();
    const { ce, handle } = mountDesk([Plain], fakeText);
    try {
      expect(handle.editor()).toBeUndefined();
      expect(locals.length).toBe(1);
      expect(locals[0]?.print).toBeUndefined();
      expect(locals[0]?.text).toBe(fakeText);
    } finally {
      handle.dispose();
      ce.dispose();
    }
  });
});
