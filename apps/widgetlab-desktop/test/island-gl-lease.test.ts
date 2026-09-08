/**
 * The board Canvas's renderer LEASE (design-013 D-C0.4, corrected at C4c).
 *
 * The `app` rig grades the OUTCOME on a real device — created 1, live 1 after the
 * StrictMode boot; created 2, live 1 after a remount. What it cannot drive is the
 * ORDERING that the Phase C review found leaking: a build still in flight when a real
 * unmount sweeps, and a remount that starts a second one before the first arrives. On
 * a physical host the build resolves in a millisecond and the sequence never occurs;
 * here the promise is held open by hand.
 *
 * These are the lease's own tests, with the renderer faked: `dispose()` is a spy and
 * the build is a promise the test resolves. Nothing here touches a GPU.
 */
import { describe, expect, it, vi } from "vitest";
import type { WebGPURenderer } from "three/webgpu";
import { createIslandGlLease } from "../src/BoardGLCanvas";

const device = {} as GPUDevice;

/** A `WebGPURenderer` that is nothing but a disposal spy. */
function fakeRenderer(): WebGPURenderer & { dispose: ReturnType<typeof vi.fn> } {
  return { dispose: vi.fn() } as unknown as WebGPURenderer & { dispose: ReturnType<typeof vi.fn> };
}

/** Let the lease's deferred sweep (`setTimeout(…, 0)`) run. */
const flush = (): Promise<void> => new Promise<void>((r) => setTimeout(r, 5));

/** A build the test resolves by hand, one deferred promise per call. */
function deferredBuild(): {
  build: () => Promise<WebGPURenderer>;
  resolve: (i: number, r: WebGPURenderer) => void;
  calls: () => number;
} {
  const resolvers: Array<(r: WebGPURenderer) => void> = [];
  return {
    build: () => new Promise<WebGPURenderer>((res) => resolvers.push(res)),
    resolve: (i, r) => {
      const res = resolvers[i];
      if (res === undefined) throw new Error(`no build #${i} yet (have ${resolvers.length})`);
      res(r);
    },
    calls: () => resolvers.length,
  };
}

describe("the island GL lease", () => {
  it("drops a build that resolves after an unmount AND a remount — exactly one live renderer", async () => {
    // THE LEAK the review found: `sweep` nulls `pending` while build A is in flight, the
    // remount builds B, and A resolves with `retained === 1` — passing the old guard,
    // installed, then overwritten by B and never disposed.
    const { build, resolve, calls } = deferredBuild();
    const lease = createIslandGlLease(device, build);
    const a = fakeRenderer();
    const b = fakeRenderer();

    lease.retain(); // mount
    const pa = lease.gl(); // build A starts
    lease.release(); // a REAL unmount
    await flush(); // …and its deferred sweep runs, with A still in flight

    lease.retain(); // the remount
    const pb = lease.gl(); // build B starts
    expect(calls()).toBe(2);

    resolve(0, a);
    await pa;
    resolve(1, b);
    await pb;

    expect(a.dispose).toHaveBeenCalledTimes(1); // the stale build is dropped on arrival
    expect(b.dispose).not.toHaveBeenCalled();
    expect(lease.census()).toEqual({ created: 2, disposed: 1, live: 1 });
  });

  it("survives StrictMode's retain → release → retain inside one task: ONE build, nothing disposed", async () => {
    const { build, resolve, calls } = deferredBuild();
    const lease = createIslandGlLease(device, build);
    const r = fakeRenderer();

    lease.retain();
    lease.release(); // StrictMode's cleanup…
    lease.retain(); // …and its immediate remount, inside the same task
    const p = lease.gl();
    resolve(0, r);
    await p;
    await flush(); // the deferral the release scheduled — it must find the lease retained

    expect(calls()).toBe(1);
    expect(r.dispose).not.toHaveBeenCalled();
    expect(lease.census()).toEqual({ created: 1, disposed: 0, live: 1 });
  });

  it("disposes the renderer on a plain unmount, after the deferral and not before", async () => {
    const { build, resolve } = deferredBuild();
    const lease = createIslandGlLease(device, build);
    const r = fakeRenderer();

    lease.retain();
    const p = lease.gl();
    resolve(0, r);
    await p;
    expect(lease.census()).toEqual({ created: 1, disposed: 0, live: 1 });

    lease.release();
    expect(r.dispose).not.toHaveBeenCalled(); // deferred: a StrictMode remount may re-retain
    await flush();
    expect(r.dispose).toHaveBeenCalledTimes(1);
    expect(lease.census()).toEqual({ created: 1, disposed: 1, live: 0 });
  });

  it("ends on dispose(): the live renderer freed at once, an in-flight build freed on arrival", async () => {
    // The per-device rebuild's half: the component ends the old lease when `gpu.device`
    // changes, and a lease that has ended must never install a renderer on a device
    // nothing draws to.
    const live = deferredBuild();
    const leaseA = createIslandGlLease(device, live.build);
    const r = fakeRenderer();
    leaseA.retain();
    const p = leaseA.gl();
    live.resolve(0, r);
    await p;
    leaseA.dispose();
    expect(r.dispose).toHaveBeenCalledTimes(1);
    expect(leaseA.census()).toEqual({ created: 1, disposed: 1, live: 0 });

    const inflight = deferredBuild();
    const leaseB = createIslandGlLease(device, inflight.build);
    const r2 = fakeRenderer();
    leaseB.retain();
    const p2 = leaseB.gl();
    leaseB.dispose(); // the device changed while the build was in flight
    inflight.resolve(0, r2);
    await p2;
    expect(r2.dispose).toHaveBeenCalledTimes(1);
    expect(leaseB.census()).toEqual({ created: 1, disposed: 1, live: 0 });
  });

  it("carries the device it was built for, so the component can key on it", () => {
    const d1 = {} as GPUDevice;
    expect(createIslandGlLease(d1, () => new Promise<WebGPURenderer>(() => {})).device).toBe(d1);
  });

  it("keeps its census to itself: two leases do not stomp each other", async () => {
    const one = deferredBuild();
    const two = deferredBuild();
    const l1 = createIslandGlLease(device, one.build);
    const l2 = createIslandGlLease(device, two.build);
    const r1 = fakeRenderer();
    l1.retain();
    const p1 = l1.gl();
    one.resolve(0, r1);
    await p1;
    l1.release();
    await flush();

    expect(l1.census()).toEqual({ created: 1, disposed: 1, live: 0 });
    expect(l2.census()).toEqual({ created: 0, disposed: 0, live: 0 }); // untouched by l1's whole life
  });
});
