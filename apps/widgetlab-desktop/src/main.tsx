/**
 * widgetlab-desktop boot. The FIRST thing that happens is the HTML-in-Canvas
 * capability probe: this is a composited-profile build (design-012 §11 Q1 —
 * composited-first for Electron/desktop), it ships exactly one profile, and a
 * probe failure is an honest boot-time refusal rather than a silent swap
 * (§11 Q2).
 */
import { probeHic, describeHicProbe, type HicProbeResult } from "@ice/ground";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { renderProfileRefusal } from "./boot/refusal";
import "./index.css";

declare global {
  interface Window {
    /** The boot probe verdict — read by the preflight/smoke harness. */
    __iceHicProbe?: HicProbeResult;
  }
}

const root = document.getElementById("root");
if (root) {
  const probe = probeHic();
  window.__iceHicProbe = probe;
  console.log(`[ice] ${describeHicProbe(probe)} ${JSON.stringify(probe.capabilities)}`);

  if (probe.supported) {
    createRoot(root).render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  } else {
    renderProfileRefusal(root, probe);
  }
}
