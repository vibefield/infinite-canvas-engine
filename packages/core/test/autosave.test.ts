/**
 * Autosave kit (design-005 §6.6): debounce + max-wait ceiling, gesture-deferral,
 * explicit flush, and the never-brick restore/quarantine path (M5 exit).
 *
 * All timing is driven by an injected clock + scheduler (`fakeTimer`) — NO real
 * timers, so every assertion is deterministic. Changes are produced by REAL
 * local commits on a durable session (the `subscribeOutbound` trigger fires
 * synchronously during `store.transaction`, loro-snapshot finding 1).
 */
import { createWorld } from "@vibecook/strata-ecs";
import type { World } from "@vibecook/strata-ecs";
import { describe, expect, it } from "vitest";
import {
  Camera,
  GesturePhases,
  Position,
  Size,
  StackZ,
  Tap,
  createDocSession,
  decodeEnvelope,
  defineQuery,
  restoreAutosave,
  startAutosave,
  type CancelScheduled,
} from "../src";

/** A hand-driven clock + single-slot scheduler (the kit only ever arms one timer). */
function fakeTimer() {
  let t = 0;
  let pending: { fn: () => void; at: number } | undefined;
  return {
    now: (): number => t,
    schedule: (fn: () => void, ms: number): CancelScheduled => {
      const slot = { fn, at: t + ms };
      pending = slot;
      return () => {
        if (pending === slot) pending = undefined;
      };
    },
    advance: (ms: number): void => {
      t += ms;
    },
    /** Delay until the pending timer fires, from now (undefined if none armed). */
    delay: (): number | undefined => (pending ? pending.at - t : undefined),
    hasPending: (): boolean => pending !== undefined,
    fire: (): void => {
      const p = pending;
      pending = undefined;
      p?.fn();
    },
  };
}

function fakeStorage() {
  const puts: Uint8Array[] = [];
  return {
    puts,
    put: (bytes: Uint8Array): void => {
      puts.push(bytes);
    },
    get: (): Uint8Array | undefined => puts.at(-1),
  };
}

const posQ = defineQuery([Position]);

function makeSession() {
  const world = createWorld();
  world.setResource(Camera, { x: 0, y: 0, zoom: 1, gesturing: false });
  const session = createDocSession(world);
  let n = 0;
  const commit = (): void => {
    session.store.transaction((tx) => {
      tx.spawn({
        components: [
          [Position, { x: n++, y: 0 }],
          [Size, { w: 10, h: 10 }],
          [StackZ, { z: 0 }],
        ],
      });
    });
  };
  return { world, session, commit };
}

function countPositions(world: World): number {
  world.sync();
  let count = 0;
  world.query(posQ).each((b) => {
    count += b.count;
  });
  return count;
}

describe("autosave: debounce", () => {
  it("writes ONE envelope a debounce after a change, stamped with the injected clock", () => {
    const timer = fakeTimer();
    const storage = fakeStorage();
    const { world, session, commit } = makeSession();
    startAutosave(session, { storage, world, now: timer.now, schedule: timer.schedule });

    commit();
    expect(timer.delay()).toBe(800); // armed at the default debounce
    expect(storage.puts).toHaveLength(0); // nothing yet

    timer.advance(800);
    timer.fire();
    expect(storage.puts).toHaveLength(1);
    expect(decodeEnvelope(storage.puts[0] as Uint8Array).header.savedAt).toBe(800);
  });

  it("coalesces a burst into a single save (the timer keeps resetting)", () => {
    const timer = fakeTimer();
    const storage = fakeStorage();
    const { world, session, commit } = makeSession();
    startAutosave(session, { storage, world, now: timer.now, schedule: timer.schedule });

    commit();
    timer.advance(500);
    commit(); // resets the debounce
    timer.advance(500);
    commit();
    expect(storage.puts).toHaveLength(0); // never idle for a full 800ms window

    timer.advance(800);
    timer.fire();
    expect(storage.puts).toHaveLength(1);
  });
});

describe("autosave: max-wait ceiling", () => {
  it("caps the debounce so a steady stream of edits still saves by maxWaitMs", () => {
    const timer = fakeTimer();
    const storage = fakeStorage();
    const { world, session, commit } = makeSession();
    startAutosave(session, { storage, world, now: timer.now, schedule: timer.schedule, maxWaitMs: 10_000 });

    commit(); // firstDirtyAt = 0
    timer.advance(9500);
    commit(); // elapsed 9500 ⇒ delay capped at 10000-9500 = 500, not the 800 debounce
    expect(timer.delay()).toBe(500);

    timer.advance(500); // t = 10000
    timer.fire();
    expect(storage.puts).toHaveLength(1);
    expect(decodeEnvelope(storage.puts[0] as Uint8Array).header.savedAt).toBe(10_000);
  });
});

describe("autosave: gesture deferral", () => {
  it("defers while Camera.gesturing, then saves once it clears", () => {
    const timer = fakeTimer();
    const storage = fakeStorage();
    const { world, session, commit } = makeSession();
    world.setResource(Camera, { x: 0, y: 0, zoom: 1, gesturing: true });
    const auto = startAutosave(session, { storage, world, now: timer.now, schedule: timer.schedule });

    commit();
    timer.advance(800);
    timer.fire();
    expect(storage.puts).toHaveLength(0); // deferred, not saved
    expect(auto.state().status).toBe("deferred");
    expect(timer.hasPending()).toBe(true); // re-armed to poll

    world.setResource(Camera, { x: 0, y: 0, zoom: 1, gesturing: false });
    timer.advance(800);
    timer.fire();
    expect(storage.puts).toHaveLength(1);
  });

  it("defers while a recognizer is non-terminal (a live Tap in Active)", () => {
    const timer = fakeTimer();
    const storage = fakeStorage();
    const { world, session, commit } = makeSession();
    // A recognizer entity mid-gesture (Tap component + GestureActive phase).
    const g = world.spawn({ components: [[Tap, { downAt: 0 }]] });
    world.addTag(g, GesturePhases.tags.Active);
    const auto = startAutosave(session, { storage, world, now: timer.now, schedule: timer.schedule });

    commit();
    timer.advance(800);
    timer.fire();
    expect(storage.puts).toHaveLength(0);
    expect(auto.state().status).toBe("deferred");

    // Recognizer reaches a terminal phase ⇒ no longer deferred.
    world.removeTag(g, GesturePhases.tags.Active);
    world.addTag(g, GesturePhases.tags.Ended);
    timer.advance(800);
    timer.fire();
    expect(storage.puts).toHaveLength(1);
  });
});

describe("autosave: flush", () => {
  it("forces an immediate save with no timer and cancels the pending one", async () => {
    const timer = fakeTimer();
    const storage = fakeStorage();
    const { world, session, commit } = makeSession();
    const auto = startAutosave(session, { storage, world, now: timer.now, schedule: timer.schedule });

    commit();
    expect(timer.hasPending()).toBe(true);
    await auto.flush();
    expect(storage.puts).toHaveLength(1);
    expect(timer.hasPending()).toBe(false); // flush cleared the debounce timer
    expect(auto.state().status).toBe("saved");
  });

  it("stop() unsubscribes so later changes do not save", () => {
    const timer = fakeTimer();
    const storage = fakeStorage();
    const { world, session, commit } = makeSession();
    const auto = startAutosave(session, { storage, world, now: timer.now, schedule: timer.schedule });

    auto.stop();
    commit();
    expect(timer.hasPending()).toBe(false); // no arming after stop
    timer.advance(10_000);
    expect(storage.puts).toHaveLength(0);
  });
});

describe("autosave: restore + quarantine (M5 exit — never brick boot)", () => {
  it("restores a valid envelope into a fresh world", async () => {
    const src = makeSession();
    src.commit();
    src.commit();
    const bytes = src.session.exportEnvelope(123);

    const world = createWorld();
    const result = await restoreAutosave(world, { get: () => bytes });
    expect(result.status).toBe("restored");
    if (result.status !== "restored") throw new Error("unreachable");
    expect(result.session.readOnly).toBe(false);
    expect(countPositions(world)).toBe(2); // both spawned boxes projected
  });

  it("returns { status: 'empty' } when nothing is stored", async () => {
    const world = createWorld();
    expect((await restoreAutosave(world, { get: () => undefined })).status).toBe("empty");
    expect((await restoreAutosave(world, { get: () => new Uint8Array(0) })).status).toBe("empty");
  });

  it("QUARANTINES corrupt bytes (bad magic) — returns the bytes, never throws", async () => {
    const world = createWorld();
    const corrupt = new Uint8Array([9, 8, 7, 6, 5, 4, 3, 2, 1, 0]);
    const result = await restoreAutosave(world, { get: () => corrupt });
    expect(result.status).toBe("quarantined");
    if (result.status !== "quarantined") throw new Error("unreachable");
    expect(result.bytes).toBe(corrupt); // handed back for the app to stash
    expect(result.reason).toMatch(/magic/i);
  });

  it("QUARANTINES a truncated envelope (valid header, severed payload)", async () => {
    const src = makeSession();
    src.commit();
    const good = src.session.exportEnvelope(7);
    const truncated = good.subarray(0, good.length - 8); // lop off the Loro payload tail

    const world = createWorld();
    const result = await restoreAutosave(world, { get: () => truncated });
    expect(result.status).toBe("quarantined");
    if (result.status !== "quarantined") throw new Error("unreachable");
    expect(result.reason.length).toBeGreaterThan(0);
  });
});
