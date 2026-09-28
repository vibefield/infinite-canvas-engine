// @vitest-environment node
// THE RIGS' DOOR (design-015 D7, D-D7-C.3): the oracle's scenes and fixtures reach the app only through the harness rig.html
// loads (`window.__deskRig`); on the product page the door refuses BY NAME instead of reaching for fixtures a third-party app
// would not have. (What each page imports is test/exit-imports.test.ts's to hold.)
import { afterEach, describe, expect, it } from "vitest";
import { type DeskRig, deskRig } from "../src/rig-door";

const g = globalThis as { window?: { __deskRig?: DeskRig } };

describe("the rigs' door (D7)", () => {
  afterEach(() => { Reflect.deleteProperty(g, "window"); });

  it("is closed on the product page: no harness, a refusal that names rig.html", () => {
    g.window = {};
    expect(() => deskRig()).toThrow(/rig\.html/);
  });

  it("is the harness once rig.html's harness opened it", () => {
    const rig: DeskRig = { setScene: async () => ({ notes: [], minimats: [], boards: [], prints: [], books: [], pads: [], plugins: [] }), printFixture: async () => ({ hash: "h", w: 1, h: 1 }) };
    g.window = { __deskRig: rig };
    expect(deskRig()).toBe(rig);
  });
});
