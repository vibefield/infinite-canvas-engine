/**
 * The wheel cede gate (design-007 §3.5, petition I4): a `wheelHandled` fact —
 * native scroll consumed the deltas — parks BOTH wheel consumers for the tick.
 * `wheelSpawn` skips (no recognizer), and a LIVE recognizer's feed
 * (`wheelSystem`) treats the tick as silence instead of panning the camera —
 * the spawn gate alone can't cover a recognizer already live inside its
 * end-silence window. A same-tick canvas DOWN is untouched (F6: the whole
 * reason this is a wheel-specific tag, not the shared `HandledByWidget`).
 */
import { describe, expect, it } from "vitest";
import { Camera, Drag, GesturePhases, WheelPan, defineQuery } from "../../src";
import { NO_MODS } from "../../src/input/queue";
import { createCameraSystems } from "../../src/systems/camera-sim";
import { createTraceRig } from "./rig";

const wheelPanQ = defineQuery([WheelPan]);
const dragQ = defineQuery([Drag]);

function cameraRig() {
  const rig = createTraceRig();
  rig.world.setResource(Camera, { x: 0, y: 0, zoom: 1, gesturing: false });
  const cam = createCameraSystems(rig.world);
  rig.engine.addSystems("ctl:behave", cam.cameraControl);
  rig.engine.addSystems("simulate", cam.cameraInertia, cam.tweenSystem);
  return rig;
}

function count(rig: ReturnType<typeof cameraRig>, q: typeof wheelPanQ): number {
  let n = 0;
  rig.world.query(q).each((b) => {
    for (const _ of b) n++;
  });
  return n;
}

function readCamera(rig: ReturnType<typeof cameraRig>) {
  const cam = rig.world.getResource(Camera);
  if (cam === undefined) throw new Error("Camera unexpectedly unset");
  return cam;
}

/** A wheel fact the adapter ceded to widget scroll (no preventDefault happened). */
function cededWheel(rig: ReturnType<typeof cameraRig>, dy: number): void {
  rig.core.queue.enqueue({
    kind: "wheel",
    pointerId: "mouse",
    device: "mouse",
    screenX: 400,
    screenY: 300,
    buttons: 0,
    mods: { ...NO_MODS },
    wheel: { dx: 0, dy, pinch: 0 },
    wheelHandled: true,
  });
}

describe("trace: wheel cede (design-007 §3.5 — WheelHandled parks both consumers)", () => {
  it("a ceded wheel spawns no recognizer and moves no camera", () => {
    const rig = cameraRig();
    cededWheel(rig, 120);
    rig.step(2);
    expect(count(rig, wheelPanQ)).toBe(0);
    expect(readCamera(rig)).toMatchObject({ x: 0, y: 0, zoom: 1 });
  });

  it("a LIVE recognizer treats a ceded tick as wheel silence (the feed gate)", () => {
    const rig = cameraRig();
    // Plain wheel: recognizer spawns, camera pans (+120/zoom on the feed frame).
    rig.wheel(400, 300, 0, 120);
    rig.step(2); // spawn frame + feed frame
    const afterPlain = readCamera(rig).y;
    expect(afterPlain).toBeCloseTo(120, 6);
    expect(count(rig, wheelPanQ)).toBe(1);

    // Ceded wheel while the recognizer is still live (inside its silence
    // window): deltas land on the pointer, but the feed must not pan.
    cededWheel(rig, 500);
    rig.step(2);
    expect(readCamera(rig).y).toBeCloseTo(afterPlain, 6);

    // The next PLAIN wheel keeps working (recognizer reused or respawned).
    rig.wheel(400, 300, 0, 60);
    rig.step(2);
    expect(readCamera(rig).y).toBeCloseTo(afterPlain + 60, 6);
  });

  it("a same-tick canvas down still spawns its gesture (F6 — no shared-latch collision)", () => {
    const rig = cameraRig();
    // One tick carries BOTH: a ceded wheel over widget scroll and a fresh
    // canvas down on the same (persistent) mouse pointer.
    cededWheel(rig, 120);
    rig.down("mouse", 200, 200);
    rig.step();
    expect(count(rig, dragQ)).toBe(1); // the down's recognizers spawned
    expect(count(rig, wheelPanQ)).toBe(0); // the wheel side stayed parked
    // The drag proceeds normally — Active after crossing the dead zone.
    rig.move("mouse", 240, 200);
    rig.step();
    let dragActive = false;
    rig.world.query(dragQ).each((b) => {
      for (const r of b) dragActive ||= rig.world.hasTag(b.entity(r), GesturePhases.tags.Active);
    });
    expect(dragActive).toBe(true);
  });
});
