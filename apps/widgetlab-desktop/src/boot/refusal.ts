/**
 * The composited profile's boot-time refusal (design-012 §11 Q2).
 *
 * ONE profile ships per packaged app, so a capability-probe failure has no
 * fallback to swap to — and swapping silently is exactly what the ruling
 * forbids. This renders an honest screen instead: what is missing, why it is
 * missing, and the one thing that fixes it.
 *
 * Deliberately plain DOM with inline styles and no React: it must render on a
 * host where the thing the app is built on does not exist, so it may not depend
 * on the app's own boot succeeding, on Tailwind having loaded, or on anything
 * the canvas needs.
 */
import type { HicProbeResult } from "@ice/ground";

const LABELS: Record<string, string> = {
  webgpu: "WebGPU (navigator.gpu)",
  requestPaint: "HTMLCanvasElement.requestPaint",
  drawElementImage: "CanvasRenderingContext2D.drawElementImage",
  copyElementImageToTexture: "GPUQueue.copyElementImageToTexture",
  layoutSubtree: "canvas layoutsubtree",
  getElementTransform: "HTMLCanvasElement.getElementTransform",
};

export function renderProfileRefusal(root: HTMLElement, probe: HicProbeResult): void {
  const missing = probe.missing.map((k) => LABELS[k] ?? k);
  const rows = Object.entries(probe.capabilities)
    .map(([key, present]) => {
      const mark = present === true ? "✓" : "✗";
      const color = present === true ? "#7ec9a0" : "#e0776b";
      return `<tr>
        <td style="padding:2px 12px 2px 0;color:${color};font-weight:700">${mark}</td>
        <td style="padding:2px 0;color:#cfc7b8">${LABELS[key] ?? key}</td>
      </tr>`;
    })
    .join("");

  root.innerHTML = `
    <div style="
      position:fixed;inset:0;display:flex;align-items:center;justify-content:center;
      background:#12110e;color:#efe7d6;
      font:14px/1.55 -apple-system,system-ui,'Segoe UI',sans-serif;padding:40px;
    ">
      <div style="max-width:620px">
        <div style="font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#8d8578">
          widgetlab-desktop · composited profile
        </div>
        <h1 style="font-size:24px;font-weight:650;margin:10px 0 14px">
          This build cannot run on this host.
        </h1>
        <p style="margin:0 0 18px;color:#cfc7b8">
          It is built for the <strong>composited</strong> presentation profile, which draws every
          widget through HTML-in-Canvas on one WebGPU device. That is not available here, and this
          app ships only the one profile — so it refuses to start rather than quietly rendering
          something other than what it was built to render.
        </p>
        <p style="margin:0 0 8px;color:#cfc7b8">Missing: <strong>${missing.join(", ")}</strong></p>
        <table style="margin:0 0 18px;border-collapse:collapse;font-size:13px">${rows}</table>
        <p style="margin:0;color:#8d8578;font-size:13px">
          <code style="color:#cfc7b8">CanvasDrawElement</code> is a Chromium origin-trial feature,
          off by default. The host process must pass
          <code style="color:#cfc7b8">--enable-features=CanvasDrawElement</code> and
          <code style="color:#cfc7b8">--enable-blink-features=CanvasDrawElement</code> before
          <code style="color:#cfc7b8">app.whenReady()</code>, plus
          <code style="color:#cfc7b8">enableBlinkFeatures</code> on the window. Re-run the probe
          after every Electron bump — the trial ends at M154 and the API has been renamed once.
        </p>
      </div>
    </div>
  `;
}
