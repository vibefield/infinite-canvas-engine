/**
 * WHICH BROWSER THE RIGS DRIVE (scripts/cdp.mjs). Every rig launches one binary through `launchChrome`; it was a constant, the
 * Google Chrome application. `chromeBinary` reads it from `DESK_CHROME`, so a rig can be pointed at another Chromium build that
 * takes the same switches, and today's path stays the default. These rows read the choice alone: nothing here launches a browser.
 */
import { describe, expect, it } from "vitest";
// @ts-expect-error — a rig harness module (plain ESM, no declarations)
import { DEFAULT_CHROME, chromeBinary } from "../scripts/cdp.mjs";

describe("the rigs' browser is named by DESK_CHROME", () => {
  it("with no variable it is today's: the Google Chrome application", () => {
    expect(DEFAULT_CHROME).toBe("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
    expect(chromeBinary({})).toBe(DEFAULT_CHROME);
  });

  it("a named binary is the one launched, said as it is given", () => {
    expect(chromeBinary({ DESK_CHROME: "/opt/chromium/chrome" })).toBe("/opt/chromium/chrome");
  });

  it("an empty variable is the default, never an empty path", () => {
    expect(chromeBinary({ DESK_CHROME: "" })).toBe(DEFAULT_CHROME);
  });
});
