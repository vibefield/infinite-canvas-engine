/**
 * M7 exit (gl-board): the app's `boot()` runs end to end under happy-dom (which
 * has no WebGL) without throwing, and seeds the mixed scene into the durable
 * doc. Headless mode (`mount: false`) exercises the whole engine/session/seed
 * path plus the bridge + router + adapter wiring, skipping only the browser-only
 * pieces (GL <Canvas>, grid, rAF, relay, autosave, ResizeObserver).
 */
import { afterEach, describe, expect, it } from "vitest";
import { boot } from "../src/app";
import type { GlboardStorage } from "../src/storage";

/** In-memory autosave sink — a fresh (empty) store, so boot seeds. */
function memStorage(): GlboardStorage {
  let bytes: Uint8Array | undefined;
  return {
    get: () => bytes,
    put: (b) => {
      bytes = b;
    },
    stashQuarantine: () => {},
    clear: () => {
      bytes = undefined;
    },
  };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("gl-board M7 exit: boot smoke (headless)", () => {
  it("boots without throwing and seeds 4 note cards + 3 spin-cubes", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    const handle = await boot({ container, storage: memStorage(), mount: false });

    expect(handle.widgetCount).toBe(7);
    expect(handle.bridge).toBeDefined();
    expect(handle.router).toBeDefined();
    expect(handle.session.readOnly).toBe(false);

    handle.dispose();
  });
});
