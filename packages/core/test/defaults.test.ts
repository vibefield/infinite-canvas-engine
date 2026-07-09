import { describe, expect, it } from "vitest";
import {
  CAMERA_DEFAULTS,
  GESTURE_DEFAULTS,
  POINTER_DEFAULTS,
  RUNTIME_BUDGETS,
  SNAP_DEFAULTS,
} from "../src/settings/defaults";

describe("settings/defaults (load-bearing constants, design-003/004/005)", () => {
  it("tap: 250ms / 8px slop (design-003 §4.2)", () => {
    expect(GESTURE_DEFAULTS.tapMaxMs).toBe(250);
    expect(GESTURE_DEFAULTS.tapSlopPx).toBe(8);
  });

  it("longPress: 500ms / 10px slop (design-003 §4.2)", () => {
    expect(GESTURE_DEFAULTS.longPressMs).toBe(500);
    expect(GESTURE_DEFAULTS.longPressSlopPx).toBe(10);
  });

  it("drag activates past 10px slop (design-003 §4.2)", () => {
    expect(GESTURE_DEFAULTS.dragSlopPx).toBe(10);
  });

  it("pinch activates past 6px spread change (design-003 §4.2)", () => {
    expect(GESTURE_DEFAULTS.pinchSlopPx).toBe(6);
  });

  it("inertia: seeds above 120px/s, decays over 325ms (design-003 §5 item 9)", () => {
    expect(GESTURE_DEFAULTS.inertiaMinVelocityPxPerS).toBe(120);
    expect(GESTURE_DEFAULTS.inertiaDecayMs).toBe(325);
  });

  it("snap threshold defaults to 5px (design-005 §4)", () => {
    expect(SNAP_DEFAULTS.thresholdPx).toBe(5);
  });

  it("zoom clamps to [0.1, 5] (design-003 §5 item 9)", () => {
    expect(CAMERA_DEFAULTS.minZoom).toBe(0.1);
    expect(CAMERA_DEFAULTS.maxZoom).toBe(5);
  });

  it("frame dt clamps at 64ms (design-002 §1)", () => {
    expect(CAMERA_DEFAULTS.dtClampMs).toBe(64);
  });

  it("pointer pick radii: mouse 0 / touch 12 / pen 4 (design-003 §3)", () => {
    expect(POINTER_DEFAULTS.radiusMousePx).toBe(0);
    expect(POINTER_DEFAULTS.radiusTouchPx).toBe(12);
    expect(POINTER_DEFAULTS.radiusPenPx).toBe(4);
  });

  it("runtime budgets match design-004 defaults", () => {
    expect(RUNTIME_BUDGETS.keepMountedWidgets).toBe(256);
    expect(RUNTIME_BUDGETS.fboBytes).toBe(268_435_456);
    expect(RUNTIME_BUDGETS.portSpawnPerFrame).toBe(64);
  });
});
