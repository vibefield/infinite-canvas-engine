// Exercise the actual veil shader, including its quad bounds, on a real GPU.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { create, globals } from "webgpu";
import { acquire } from "../src/engine/device";
import { beginPass, readback, Target } from "../src/engine/target";
import { DEFAULT_GRID } from "../src/mat/grid";
import { STILL_MAT_FRAME } from "../src/mat/layout";
import { CuttingMat } from "../src/mat/mat-pass";
import { MAT_SHADER_FILES, matShaders } from "../src/mat/shaders";
import { shaderText } from "../src/shaders";
import { themeFrom } from "../src/theme";
import { contentShown, DRAWER, drawerRect } from "../src/tray/drawer";
import { TrayPass } from "../src/tray/pass";
import { trayShaders } from "../src/tray/shaders";

let device: GPUDevice;
let mat: CuttingMat;
let tray: TrayPass;
const view = { camX: 0, camY: 0, zoom: 1, width: 640, height: 480, dpr: 1 };
const theme = themeFrom("light", { canvasBg: { token: "--bg", css: "#fafafa" }, select: { token: "--sel", css: "#3080ff" } });

beforeAll(async () => {
  Object.assign(globalThis, globals);
  device = (await acquire({ gpu: create([]), label: "tray veil regression" })).device;
  mat = await CuttingMat.create(device, "rgba8unorm", matShaders(shaderText(MAT_SHADER_FILES)));
  tray = await TrayPass.create(device, "rgba8unorm", trayShaders(shaderText), mat);
});

afterAll(() => { tray?.dispose(); mat?.dispose(); device?.destroy(); });

describe("tray veil on Dawn", () => {
  it.each([1, 2])("keeps the whole bottom strip within 20 CSS px and preserves the header at DPR %s", async (dpr) => {
    const rect = drawerRect(view.width, view.height, 1);
    const target = new Target(device, { format: "rgba8unorm", readable: true }, view.width * dpr, view.height * dpr);
    try {
      // Narrow product footer, original default fade, and an explicitly hard edge.
      for (const footFade of [16, undefined, 0]) {
        device.pushErrorScope("validation");
        tray.prepare({ ...view, dpr }, theme, DEFAULT_GRID, STILL_MAT_FRAME, { p: 1, scroll: 123, foot: 4, ...(footFade !== undefined ? { footFade } : {}) });
        const encoder = device.createCommandEncoder();
        const pass = beginPass(encoder, target.view, [0, 0, 0, 0]);
        tray.drawVeil(pass);
        pass.end();
        device.queue.submit([encoder.finish()]);
        const pixels = await readback(device, target.texture, 4);
        expect(await device.popErrorScope()).toBeNull();
        // Across every pixel of the header and footer, the veil's alpha must match the CPU's
        // content mask. This also catches a footer quad that accidentally keeps the old height.
        const x = Math.floor(view.width * dpr / 2);
        for (let row = Math.ceil((rect.y + DRAWER.arris + 1) * dpr); row < view.height * dpr; row++) {
          const y = (row + 0.5) / dpr;
          const want = Math.round((1 - contentShown(rect, y, 4, footFade ?? DRAWER.fade)) * 255);
          const actual = pixels[(row * view.width * dpr + x) * 4 + 3] as number;
          expect(Math.abs(actual - want), `fade ${footFade}, row ${row}`).toBeLessThanOrEqual(1);
        }
      }
    } finally {
      target.dispose();
    }
  });
});
