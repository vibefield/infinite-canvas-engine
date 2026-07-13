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

describe("trace: wheel-zoom speed — the v2 prototype curve (adopted 2026-07-13)", () => {
  it("factor = 2^(−clamp(Δ, ±10)·0.01): a mouse notch caps at ×2^0.1, a pinch tick is unclamped", () => {
    const rig = cameraRig();

    // Mouse notch (Δ = −100): the ±10 clamp makes it one strong pinch frame.
    rig.wheel(400, 300, 0, 0, -100);
    rig.step();
    expect(readCamera(rig).zoom).toBeCloseTo(2 ** 0.1, 6);

    rig.step(); // idle frame — per-frame delta zeroed, no further zoom
    expect(readCamera(rig).zoom).toBeCloseTo(2 ** 0.1, 6);

    // Trackpad pinch tick (Δ = −2, under the clamp): full-resolution step.
    rig.wheel(400, 300, 0, 0, -2);
    rig.step();
    expect(readCamera(rig).zoom).toBeCloseTo(2 ** 0.1 * 2 ** 0.02, 6);
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

describe("trace: wheel-pan direction (James's field report 2026-07-10)", () => {
  it("scroll direction = travel direction: wheel-down/right INCREASES camera x/y by d/zoom", () => {
    const rig = cameraRig();

    // Wheel-down + wheel-right at zoom 1: the viewport travels down/right the
    // world (content slides opposite) — Figma/Freeform convention for mouse
    // wheels AND macOS natural-scroll trackpads. The sign was inverted until
    // this trace pinned it.
    rig.wheel(400, 300, 50, 120, 0);
    rig.step();
    expect(readCamera(rig).x).toBeCloseTo(50, 6);
    expect(readCamera(rig).y).toBeCloseTo(120, 6);

    // At zoom 2 the same screen deltas cover HALF the world distance.
    rig.world.setResource(Camera, { x: 0, y: 0, zoom: 2, gesturing: false });
    rig.step(12); // let the first WheelPan recognizer end (150ms silence)
    rig.wheel(400, 300, 50, 120, 0);
    rig.step();
    expect(readCamera(rig).x).toBeCloseTo(25, 6);
    expect(readCamera(rig).y).toBeCloseTo(60, 6);

    // The DRAG pan keeps the opposite, design-pinned sign (content follows the
    // pointer — grab-the-canvas): drag right ⇒ camera.x DECREASES.
    rig.step(12);
    const beforeDrag = readCamera(rig).x;
    rig.down("mouse", 400, 300, { button: 4 }); // middle button → RoutedPan
    rig.step();
    rig.move("mouse", 420, 300);
    rig.step(); // claim frame (dead-zone exit)
    rig.move("mouse", 440, 300);
    rig.step();
    expect(readCamera(rig).x).toBeLessThan(beforeDrag);
    rig.up("mouse", 440, 300);
    rig.step(2);
  });
});
