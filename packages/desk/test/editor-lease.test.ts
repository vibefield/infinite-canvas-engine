// @vitest-environment happy-dom
// K8a (design-016 §5 · K-L2 — "text input … a plugin kind declares the same way"): until K8a the ONE focused editor was the NOTE's
// DOM half — a desk with no note kind had none, the calendar borrowed the note's, and no plugin kind could take text. The editor is
// the DESK's now (host/editor.ts, made at the mount whatever kinds are registered), and a kind LEASES it through the TEXT PARTS its
// object declares (`defineObject({ host: { text } })`). Here a THIRD-PARTY kind of the test's own — no reference kind in sight — takes
// text two ways: a part the desk routes a TAP to, and a part its own DOM half leases at event time. The halves are made at the
// mount, before the device boots, so the page is happy-dom's and the GPU never answers (the layer stays `pending`).
import { createCanvasEngine, type WidgetType } from "@ice/core";
import { afterEach, describe, expect, it } from "vitest";
import { EDITOR_ATTR } from "../src/host/editor";
import { deskLayer } from "../src/host/layer";
import type { KindPass } from "../src/kind";
import type { ObjectDomHost, ObjectKind } from "../src/kinds/world";
import type { DeskEditor, EditorLease, TextTap } from "../src/kit/editor";
import { defineObject } from "../src/object";
import { type Palette, themeFrom } from "../src/theme";

const PALETTE: Palette = { canvasBg: { token: "--bg", css: "#101010" }, select: { token: "--sel", css: "#3080ff" } };

/** A kind of the test's own: no pass is ever made (no device boots), no geometry is ever asked. */
const labelKind = (name: string): ObjectKind => ({ name, stratum: "things", reach: 0, create: async () => ({}) as KindPass, resolve: () => ({}), record: () => ({}), hit: () => null });

/** What a fixture lease was told, in order. */
interface Told { readonly calls: string[]; value: string | null; alive: boolean }

/** A plugin's lease: it keeps a line of text, one line, its box fixed. */
function lineLease(part: string, told: Told): EditorLease {
  return {
    part,
    label: `write on the ${part}`,
    value: () => told.value,
    input(v) { told.calls.push(`input ${v}`); told.value = v; },
    keydown(ev) { told.calls.push(`key ${ev.key}`); return ev.key === "Enter"; },
    caret(i) { told.calls.push(`caret ${i}`); },
    place: () => ({ x: 10, y: 20, w: 120, h: 18, fontPx: 14 }),
    idle() { told.calls.push("idle"); },
    ended() { told.calls.push("ended"); },
    live: () => told.alive,
  };
}

const mounted: (() => void)[] = [];
afterEach(() => { for (const end of mounted.splice(0)) end(); document.body.innerHTML = ""; });

function mountDesk(objects: WidgetType[]) {
  const ce = createCanvasEngine({ widgets: objects });
  ce.docs.create();
  const container = document.createElement("div");
  document.body.appendChild(container);
  const { stack } = ce;
  const handle = deskLayer({ theme: themeFrom("light", PALETTE), palette: PALETTE, objects, gpu: { requestAdapter: () => new Promise(() => {}) } as unknown as GPU })({
    host: { container } as never, world: ce.world,
    framePick: stack.framePick, navGeometry: stack.navGeometry, heldPose: stack.heldPose,
    transitions: ce.transitions, catalog: ce.catalog, readMarquee: () => stack.marqueeBuffer, spatial: stack.index,
  });
  mounted.push(() => { handle.dispose(); ce.dispose(); });
  return { ce, handle, container };
}

/** A tap as the platform delivers it: a primary press and its click, the pointer still. */
function tap(container: HTMLElement, x: number, y: number, mods: Partial<MouseEventInit> = {}): void {
  container.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, isPrimary: true, button: 0, pointerId: 1, pointerType: "mouse", clientX: x, clientY: y }));
  container.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0, clientX: x, clientY: y, ...mods }));
}

describe("the ONE editor is the desk's, and a plugin kind LEASES it through the text parts its object declares (K8a)", () => {
  it("a desk with no kind that takes text still has its editor: one textarea, hidden, lent to nothing", () => {
    const Plain = defineObject({ type: "test.plain-text", version: 1, props: {}, kind: labelKind("plain-text") });
    const { handle, container } = mountDesk([Plain]);
    const ed = handle.editor();
    expect(ed.element.tagName).toBe("TEXTAREA");
    expect(container.querySelectorAll(`[${EDITOR_ATTR}]`).length).toBe(1);
    expect(ed.element.hidden).toBe(true);
    expect(ed.lease()).toBeUndefined();
  });

  it("a TAP is routed to a declared part: its lease takes the editor — focus, value, caret, placement — and the platform's events are the lease's", () => {
    const told: Told = { calls: [], value: "tick", alive: true };
    const taps: TextTap[] = [];
    let editor: DeskEditor | undefined;
    const lease = lineLease("label.text", told);
    const Label = defineObject({
      type: "test.label", version: 1, props: {}, kind: labelKind("label"),
      host: { text: (h: ObjectDomHost) => { editor = h.editor; return [{ part: "label.text", tap: (t) => { taps.push(t); return { lease, caret: 2 }; } }]; } },
    });
    const { handle, container } = mountDesk([Label]);
    // the half was handed the desk's own editor
    expect(editor).toBe(handle.editor());
    const ed = handle.editor();
    tap(container, 40, 30);
    // the pointer never entered the world (no interaction stack ran): the part is told so, and looks for itself
    expect(taps).toEqual([{ wx: 40, wy: 30, found: false, hit: undefined }]);
    expect(ed.lease()).toBe(lease);
    expect(ed.lease()?.part).toBe("label.text");
    expect(ed.element.hidden).toBe(false);
    expect(document.activeElement).toBe(ed.element);
    expect(ed.element.value).toBe("tick");
    expect(ed.element.getAttribute("aria-label")).toBe("write on the label.text");
    expect(told.calls).toEqual(["caret 2"]);
    expect(ed.placement()).toEqual({ cx: 70, cy: 29, w: 120, h: 18, angle: 0 });
    expect(ed.element.style.transform).toBe("translate(10px, 20px)");
    // the platform's value, keys and caret are the lease's; a key it takes stops there (the keymap stands down)
    ed.element.value = "tock";
    ed.element.dispatchEvent(new Event("input", { bubbles: true }));
    const enter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    ed.element.dispatchEvent(enter);
    const other = new KeyboardEvent("keydown", { key: "a", bubbles: true, cancelable: true });
    ed.element.dispatchEvent(other);
    expect(told.calls.slice(1)).toEqual(["input tock", "key Enter", "key a"]);
    expect(enter.defaultPrevented).toBe(true);
    expect(other.defaultPrevented).toBe(false);
    // a blur ends the lease: the holder told, the textarea hidden
    ed.element.blur();
    expect(told.calls.at(-1)).toBe("ended");
    expect(ed.lease()).toBeUndefined();
    expect(ed.element.hidden).toBe(true);
  });

  it("a tap with a modifier, or one that moved past the slop, is no tap; a part that answers nothing leaves the editor alone", () => {
    const told: Told = { calls: [], value: "", alive: true };
    let answer = true;
    const Label = defineObject({
      type: "test.label-2", version: 1, props: {}, kind: labelKind("label-2"),
      host: { text: () => [{ part: "label.text", tap: () => (answer ? { lease: lineLease("label.text", told) } : undefined) }] },
    });
    const { handle, container } = mountDesk([Label]);
    tap(container, 5, 5, { shiftKey: true });
    expect(handle.editor().lease()).toBeUndefined();
    container.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, isPrimary: true, button: 0, pointerId: 1, pointerType: "mouse", clientX: 0, clientY: 0 }));
    container.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0, clientX: 40, clientY: 0 }));
    expect(handle.editor().lease()).toBeUndefined();
    answer = false;
    tap(container, 5, 5);
    expect(handle.editor().lease()).toBeUndefined();
    answer = true;
    tap(container, 5, 5);
    expect(handle.editor().lease()?.part).toBe("label.text");
  });

  it("a part WITHOUT a tap is leased by its own half at event time; another lease takes the editor over — the first told, the focus kept", () => {
    const a: Told = { calls: [], value: "one", alive: true };
    const b: Told = { calls: [], value: "two", alive: true };
    let dom: ObjectDomHost | undefined;
    const Stamp = defineObject({ type: "test.stamp", version: 1, props: {}, kind: labelKind("stamp"), host: { text: () => [{ part: "stamp.line" }], mount: (h) => { dom = h; } } });
    const { handle } = mountDesk([Stamp]);
    const ed = handle.editor();
    expect(dom?.editor).toBe(ed);
    const first = lineLease("stamp.line", a);
    dom?.editor.lend(first);
    expect(ed.element.value).toBe("one");
    expect(a.calls).toEqual(["caret 3"]);   // the caret at the end of the lease's value
    const second = lineLease("stamp.line", b);
    dom?.editor.lend(second, 1);
    expect(a.calls.at(-1)).toBe("ended");
    expect(b.calls).toEqual(["caret 1"]);
    expect(ed.lease()).toBe(second);
    expect(ed.element.value).toBe("two");
    expect(document.activeElement).toBe(ed.element);   // handed over, never blurred between the two
    // release names its lease: another's release leaves it be
    ed.release(first);
    expect(ed.lease()).toBe(second);
    ed.release(second);
    expect(ed.lease()).toBeUndefined();
  });

  it("each frame the editor follows its lease: a value the world moved reaches the field, and a lease whose object is gone lets go", async () => {
    const told: Told = { calls: [], value: "abc", alive: true };
    let dom: ObjectDomHost | undefined;
    const Stamp = defineObject({ type: "test.stamp-2", version: 1, props: {}, kind: labelKind("stamp-2"), host: { mount: (h) => { dom = h; } } });
    const { handle } = mountDesk([Stamp]);
    const ed = handle.editor();
    dom?.editor.lend(lineLease("stamp.line", told), 1);
    told.value = "abcdef";   // a peer wrote between sessions
    ed.follow();
    expect(ed.element.value).toBe("abcdef");
    expect(told.calls.at(-1)).toBe("caret 1");
    told.value = null;   // a session is open: the field is the truth
    ed.element.value = "typed";
    ed.follow();
    expect(ed.element.value).toBe("typed");
    told.alive = false;   // its object was deleted
    ed.follow();
    await Promise.resolve();
    expect(ed.lease()).toBeUndefined();
    expect(told.calls.at(-1)).toBe("ended");
  });

  it("the tap's parts are asked in registration order, the first lease wins — the second kind's part is never asked", () => {
    const asked: string[] = [];
    const told: Told = { calls: [], value: "", alive: true };
    const part = (name: string) => ({ part: name, tap: (): { readonly lease: EditorLease } => { asked.push(name); return { lease: lineLease(name, told) }; } });
    const A = defineObject({ type: "test.first-part", version: 1, props: {}, kind: labelKind("first-part"), host: { text: () => [part("a.text")] } });
    const B = defineObject({ type: "test.second-part", version: 1, props: {}, kind: labelKind("second-part"), host: { text: () => [part("b.text")] } });
    const { handle, container } = mountDesk([A, B]);
    tap(container, 1, 1);
    expect(asked).toEqual(["a.text"]);
    expect(handle.editor().lease()?.part).toBe("a.text");
  });
});
