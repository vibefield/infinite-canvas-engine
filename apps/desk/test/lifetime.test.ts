import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { disposeOnLeave } from "../src/lifetime";

// The engine's lifetime under React's StrictMode: the development double-mount check (effect → cleanup → effect on the SAME
// state) must not dispose the engine the remount goes on to use; a real unmount must.
describe("disposeOnLeave — the desk app's engine lifetime", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("StrictMode's double mount (enter → leave → enter) keeps the engine alive", () => {
    const dispose = vi.fn();
    const life = disposeOnLeave(dispose);
    life.enter();
    life.leave();
    life.enter();
    vi.runAllTimers();
    expect(dispose).not.toHaveBeenCalled();
  });

  it("a real unmount disposes the engine once, on the next task", () => {
    const dispose = vi.fn();
    const life = disposeOnLeave(dispose);
    life.enter();
    life.leave();
    expect(dispose).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(dispose).toHaveBeenCalledTimes(1);
    life.leave();
    vi.runAllTimers();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("leaving twice before the task runs still disposes once", () => {
    const dispose = vi.fn();
    const life = disposeOnLeave(dispose);
    life.leave();
    life.leave();
    vi.runAllTimers();
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});
