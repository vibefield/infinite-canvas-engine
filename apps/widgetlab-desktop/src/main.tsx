/**
 * widgetlab-desktop boot. This is a COMPOSITED-profile build (design-012 §11
 * Q1 — composited-first for Electron/desktop) and it ships exactly one profile,
 * so boot is a gate, not a negotiation:
 *
 *   probe HiC → acquire the app-owned device → instrument submits → mount
 *
 * Any failure in that chain is an honest boot-time refusal (§11 Q2), never a
 * silent swap to the stratified profile.
 *
 * ORDER IS LOAD-BEARING. The device is acquired before the engine exists and
 * the submit instrument is installed before ANY consumer holds the queue —
 * that is what makes a "0 submits while idle" claim about the whole process
 * rather than about our own reflector (three submits for its own uploads and
 * passes, and it must be counted too).
 */
import {
  acquireCompositorDevice,
  GpuUnavailableError,
  type EngineGpu,
} from "@ice/core";
import { describeHicProbe, instrumentSubmits, probeHic, type HicProbeResult } from "@ice/ground";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { renderProfileRefusal } from "./boot/refusal";
import "./index.css";

declare global {
  interface Window {
    /** The boot probe verdict — read by the preflight/smoke harness. */
    __iceHicProbe?: HicProbeResult;
    /** The app-owned GPU facts, for the S1 rigs (adoption, idle-zero). */
    __iceGpu?: {
      readonly hasCoreFeatures: boolean;
      readonly hasTimestampQuery: boolean;
      readonly enabled: readonly string[];
      readonly errors: () => readonly { type: string; message: string }[];
      /** Total queue.submit calls since boot, whoever made them. */
      readonly submits: () => number;
      /** Submits in the trailing window — the idle-zero measurement. */
      readonly submitsInWindow: (ms: number) => number;
      readonly resetSubmits: () => void;
    };
  }
}

async function boot(root: HTMLElement): Promise<void> {
  const probe = probeHic();
  window.__iceHicProbe = probe;
  console.log(`[ice] ${describeHicProbe(probe)} ${JSON.stringify(probe.capabilities)}`);
  if (!probe.supported) {
    renderProfileRefusal(root, probe);
    return;
  }

  let gpu: EngineGpu;
  try {
    gpu = await acquireCompositorDevice();
  } catch (err) {
    // WebGPU passed the probe but the device would not come up. Same posture:
    // refuse, and say which capability the host actually failed on.
    const why = err instanceof GpuUnavailableError ? err.message : String(err);
    console.error(`[ice] device acquisition failed: ${why}`);
    renderProfileRefusal(root, {
      capabilities: { ...probe.capabilities, webgpu: false },
      supported: false,
      missing: ["webgpu"],
    });
    return;
  }

  // Before any consumer: three has not been constructed yet, so every submit
  // from here on is counted.
  const submits = instrumentSubmits(gpu.device);
  console.log(
    `[ice] device acquired — coreFeatures=${gpu.hasCoreFeatures} timestampQuery=${gpu.hasTimestampQuery}`,
  );
  window.__iceGpu = {
    hasCoreFeatures: gpu.hasCoreFeatures,
    hasTimestampQuery: gpu.hasTimestampQuery,
    enabled: gpu.enabled,
    errors: () => gpu.errors().map((e) => ({ type: e.type, message: e.message })),
    submits: () => submits.total(),
    submitsInWindow: (ms) => submits.inWindow(ms),
    resetSubmits: () => submits.reset(),
  };

  createRoot(root).render(
    <StrictMode>
      <App gpu={gpu} />
    </StrictMode>,
  );
}

const root = document.getElementById("root");
if (root) void boot(root);
