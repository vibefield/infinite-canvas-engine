/**
 * M4 camera-slice frame traces (design-003 §5 item 9; §11 decision 14 red-team).
 *
 * Each trace drives the real loop through the queue and asserts tick-by-tick:
 *  - mid-pan wheel-zoom cursor-lock: the world point under the wheel anchor stays
 *    fixed across the zoom frames, the pan keeps integrating at the NEW zoom with
 *    no retroactive jump (decision 14 — per-frame delta at current zoom, never
 *    total/zoomAtClaim), and the drag stays Active throughout (WheelZoom is
 *    Simultaneous — zoom-while-drag is legal);
 *  - fly-back tween: TransformTween eases Position to its target and reaps on arrival;
 *  - inertia: a fast pan release keeps the camera coasting, it decelerates, and a
 *    new pointer-down kills it dead (touch-to-stop).
 */
import { describe, expect, it } from "vitest";
import { screenToWorld } from "@ice/kernel";
import { Camera, ClaimedBy, GesturePhases, Position, TransformTween } from "../../src";
import { CameraInertia, createCameraSystems } from "../../src/systems/camera-sim";
import { createTraceRig } from "./rig";

const P = GesturePhases;

/** Rig + camera systems wired, Camera seeded at identity. */
function cameraRig() {
  const rig = createTraceRig();
  rig.world.setResource(Camera, { x: 0, y: 0, zoom: 1, gesturing: false });
  const cam = createCameraSystems(rig.world);
  rig.engine.addSystems("ctl:behave", cam.cameraControl);
  rig.engine.addSystems("simulate", cam.cameraInertia, cam.tweenSystem);
  return rig;
}

function readCamera(rig: ReturnType<typeof cameraRig>) {
  const cam = rig.world.getResource(Camera);
  if (cam === undefined) throw new Error("Camera unexpectedly unset");
  return cam;
}

describe("trace: mid-pan wheel-zoom cursor-lock (design-003 decision 14)", () => {
  it("anchor world point stays fixed under zoom; pan resumes at the new zoom; drag stays Active", () => {
    const rig = cameraRig();

    // Middle-button drag on canvas (no rig.target ⇒ canvas fallback) → RoutedPan.
    rig.down("mouse", 400, 300, { button: 4 });
    rig.step(); // recognizers Possible
    rig.move("mouse", 420, 300); // 20px > slop → Active, dead-zone exit at 420, RoutedPan
    rig.step(); // claim frame: total 0, memo 0, no camera move

    rig.move("mouse", 440, 300);
    rig.step(); // total 20, per-frame delta 20 → camera.x -= 20/1
    rig.move("mouse", 460, 300);
    rig.step(); // total 40 → camera.x -= 20 more
    expect(readCamera(rig).x).toBeCloseTo(-40, 6);

    const before = readCamera(rig);
    const anchorX = 460;
    const anchorY = 300;
    const worldBefore = screenToWorld(anchorX, anchorY, before);

    // Wheel-zoom mid-pan for 2 frames AT the pointer (pointer stationary ⇒ pan
    // delta 0 those frames; the wheel event coords equal the live pointer, so no
    // spurious drag jump). WheelZoom is Simultaneous — it never claims the pointer.
    rig.wheel(anchorX, anchorY, 0, 0, -100);
    rig.step();
    rig.wheel(anchorX, anchorY, 0, 0, -100);
    rig.step();

    const afterZoom = readCamera(rig);
    expect(afterZoom.zoom).toBeGreaterThan(before.zoom); // zoomed in
    // (a) the world point under the anchor is unmoved across the zoom frames.
    const worldAfter = screenToWorld(anchorX, anchorY, afterZoom);
    expect(worldAfter.x).toBeCloseTo(worldBefore.x, 6);
    expect(worldAfter.y).toBeCloseTo(worldBefore.y, 6);

    // (c) the pan drag is still Active (Simultaneous wheel never failed it).
    const pointer = rig.pointerEntity("mouse");
    expect(pointer).toBeDefined();
    if (pointer === undefined) return;
    const claimant = rig.world.getRelation(pointer, ClaimedBy);
    expect(claimant).toBeDefined();
    if (claimant === undefined) return;
    expect(rig.world.hasTag(claimant, P.tags.Active)).toBe(true);

    // (b) resume the pan: this frame's delta converts at the NEW zoom — no
    // retroactive reconvert of the accumulated total (that is decision 14).
    rig.move("mouse", 480, 300);
    rig.step(); // total 60, delta 20 → camera.x -= 20/newZoom
    const afterResume = readCamera(rig);
    expect(afterResume.x).toBeCloseTo(afterZoom.x - 20 / afterZoom.zoom, 6);
  });
});

describe("trace: fly-back tween (design-003 §5 item 5)", () => {
  it("eases Position toward the target and reaps the rider exactly on arrival", () => {
    const rig = cameraRig();
    const e = rig.world.spawn({
      components: [
        [Position, { x: 100, y: 50 }],
        [TransformTween, { toX: 0, toY: 0, durationMs: 64, elapsedMs: 0 }],
      ],
    });

    rig.step(); // first frame dt is 0 (no prior clock) — captures the start, no progress
    rig.step(3); // 48ms elapsed — mid-flight
    expect(rig.world.has(e, TransformTween)).toBe(true);
    const mid = rig.world.read(e, Position);
    expect(mid.x).toBeGreaterThan(0);
    expect(mid.x).toBeLessThan(100); // eased inbound toward the target

    rig.step(2); // crosses durationMs → snap + remove
    expect(rig.world.has(e, TransformTween)).toBe(false);
    expect(rig.world.read(e, Position)).toEqual({ x: 0, y: 0 });
  });
});

describe("trace: pan inertia + touch-to-stop (design-003 §5 item 9)", () => {
  it("a fast release coasts, decelerates, and a new pointer-down stops it dead", () => {
    const rig = cameraRig();

    rig.down("mouse", 400, 300, { button: 4 });
    rig.step();
    rig.move("mouse", 420, 300);
    rig.step(); // Active
    rig.move("mouse", 480, 300);
    rig.step(); // +60px fast
    rig.move("mouse", 540, 300);
    rig.step(); // +60px fast — high release velocity
    rig.up("mouse", 540, 300);
    rig.step(); // Ended → seed inertia; cameraInertia takes its first step this frame

    const x5 = readCamera(rig).x;
    rig.step();
    const x6 = readCamera(rig).x;
    rig.step();
    const x7 = readCamera(rig).x;
    expect(x6).toBeLessThan(x5); // still coasting (camera.x drifting negative)
    expect(x7).toBeLessThan(x6);
    expect(x5 - x6).toBeGreaterThan(x6 - x7); // decelerating (exponential decay)

    // New pointer-down: touch-to-stop kills inertia dead the same frame.
    rig.down("mouse", 100, 100);
    rig.step();
    const x8 = readCamera(rig).x;
    expect(rig.world.getResource(CameraInertia)).toEqual({ vx: 0, vy: 0 });
    rig.step(2);
    expect(readCamera(rig).x).toBe(x8); // frozen — no more coasting
  });
});
