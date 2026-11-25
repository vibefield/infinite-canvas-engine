// @vitest-environment node
// AN ACT MAY BE A CHOICE (petition I62): what a kind says of its choices is read safely — only what is well-formed is kept, a choice
// with a field that is not one is dropped whole, a throw is told and the act stands as one op — and the choice a host TOOK is held to
// what the act offers NOW: its id among them, and every value the one handed or the field's own, a number finite, within its bounds
// and on its step, a text within its length. `defineWidget` refuses a `choices` that is not a function, and a held tool's on a mode.
import { describe, expect, it } from "vitest";
import { type ActChoice, defineWidget, readActChoices, takenChoice } from "../src";

const of = (said: unknown) => ({ choices: () => said as readonly ActChoice[] });
const CUSTOM: ActChoice = {
  id: "custom", label: "Custom", fields: [
    { id: "width", label: "Width", kind: "number", value: 1280, min: 320, max: 8192, step: 1 },
    { id: "zoom", label: "Zoom", kind: "number", value: 1, min: 0.5, max: 3, step: 0.1 },
    { id: "agent", label: "User agent", kind: "text", value: "", maxLength: 16, placeholder: "The browser's own" },
  ],
};

describe("an act may be a choice (petition I62)", () => {
  it("readActChoices keeps what is well-formed: ids unique, labels, hints, swatches, groups, the current mark, fields that are fields", () => {
    expect(readActChoices({}, {})).toBeUndefined();
    expect(readActChoices(of(undefined), {})).toBeUndefined();
    expect(readActChoices(of([]), {})).toBeUndefined();
    expect(readActChoices(of("laptop"), {})).toBeUndefined();
    expect(readActChoices(of([
      { id: "laptop", label: "Laptop", hint: "1280 × 800", current: true, group: "devices", extra: 1 },
      { id: "laptop", label: "Laptop again" },                 // a repeated id: the first stands
      { id: "", label: "No id" }, { id: "x", label: "" },     // no id, no label: dropped
      { id: "blue", label: "Deep Blue", swatch: "#2b3c5c", current: "yes", hint: "" },   // a current that is not true, an empty hint: not kept
      CUSTOM,
    ]), {})).toEqual([
      { id: "laptop", label: "Laptop", hint: "1280 × 800", current: true, group: "devices" },
      { id: "blue", label: "Deep Blue", swatch: "#2b3c5c" },
      CUSTOM,
    ]);
  });

  it("a choice with a field that is not one is dropped whole; at most 64 choices are read", () => {
    const bad = (field: unknown) => readActChoices(of([{ id: "c", label: "C", fields: [field] }, { id: "d", label: "D" }]), {});
    expect(bad({ id: "w", label: "W", kind: "number", value: "1" })).toEqual([{ id: "d", label: "D" }]);         // a number's value is a number
    expect(bad({ id: "w", label: "W", kind: "number", value: 1, min: 5, max: 2 })).toEqual([{ id: "d", label: "D" }]);   // bounds crossed
    expect(bad({ id: "w", label: "W", kind: "number", value: 1, step: 0 })).toEqual([{ id: "d", label: "D" }]);
    expect(bad({ id: "t", label: "T", kind: "text", value: "x".repeat(3), maxLength: 2 })).toEqual([{ id: "d", label: "D" }]);
    expect(bad({ id: "t", label: "T", kind: "colour", value: "" })).toEqual([{ id: "d", label: "D" }]);
    expect(readActChoices(of([{ id: "c", label: "C", fields: [] }]), {})).toBeUndefined();   // fields, when said, are some
    expect(readActChoices(of([{ id: "c", label: "C", fields: [
      { id: "w", label: "W", kind: "number", value: 1 }, { id: "w", label: "W2", kind: "number", value: 2 },
    ] }]), {})).toBeUndefined();   // a field's id is unique within its choice
    const many = Array.from({ length: 70 }, (_, i) => ({ id: `c${i}`, label: `C${i}` }));
    expect(readActChoices(of(many), {})).toHaveLength(64);
  });

  it("a `choices` that THROWS is told once a call, and the act stands as one op", () => {
    const told: unknown[] = [];
    expect(readActChoices({ choices: () => { throw new Error("no choices today"); } }, {}, (err) => { told.push(err); })).toBeUndefined();
    expect(told.map(String)).toEqual(["Error: no choices today"]);
  });

  it("takenChoice holds a taken choice to the choices now: its id, and every value in bounds, on its step, within its length", () => {
    const now = readActChoices(of([{ id: "laptop", label: "Laptop" }, CUSTOM]), {});
    expect(takenChoice(now, { id: "phone" })).toBeUndefined();
    expect(takenChoice(undefined, { id: "laptop" })).toBeUndefined();
    expect(takenChoice(now, { id: "laptop", values: { width: 9 } })).toEqual({ id: "laptop" });   // a choice with no fields takes no values
    // the values handed, the others as they stand; a number handed as a field's text is read as one
    expect(takenChoice(now, { id: "custom", values: { width: "1024", agent: "Test/1" } })).toEqual({ id: "custom", values: { width: 1024, zoom: 1, agent: "Test/1" } });
    // 0.1 × 7 is 0.7000000000000001 in floats: on a step of 0.1 from 0.5 all the same
    expect(takenChoice(now, { id: "custom", values: { zoom: 0.1 * 7 } })).toEqual({ id: "custom", values: { width: 1280, zoom: 0.1 * 7, agent: "" } });
    expect(takenChoice(now, { id: "custom", values: { width: 100 } })).toBeUndefined();        // under its floor
    expect(takenChoice(now, { id: "custom", values: { width: 9000 } })).toBeUndefined();       // over its ceiling
    expect(takenChoice(now, { id: "custom", values: { width: 1024.5 } })).toBeUndefined();     // off its step
    expect(takenChoice(now, { id: "custom", values: { zoom: 0.55 } })).toBeUndefined();        // off its step, counted from its min
    expect(takenChoice(now, { id: "custom", values: { width: "" } })).toBeUndefined();         // an empty field is no number
    expect(takenChoice(now, { id: "custom", values: { width: "12px" } })).toBeUndefined();
    expect(takenChoice(now, { id: "custom", values: { agent: "x".repeat(17) } })).toBeUndefined();
    expect(takenChoice(now, { id: "custom", values: { agent: 7 } })).toBeUndefined();          // a text is a string
  });

  it("defineWidget refuses a `choices` that is not a function — and a held tool's on anything but an action", () => {
    expect(() => defineWidget({ type: "ac:bad", menu: [{ id: "a", label: "A", run: () => {}, choices: [] as never }] })).toThrow(/`choices` is a function/);
    expect(() => defineWidget({ type: "ac:mode", object: { name: "m" }, openable: true, heldTools: [{ id: "pen", label: "Pen", kind: "mode", choices: () => [] }] })).toThrow(/on an action/);
    expect(() => defineWidget({ type: "ac:ok", object: { name: "k" }, openable: true, heldTools: [{ id: "device", label: "Device", kind: "action", run: () => {}, choices: () => [] }] })).not.toThrow();
  });
});
