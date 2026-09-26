// apps/desk's PARITY page (design-015 §11 witness 1; plan D1's witness 5) — `parity.html`, D1's page kept whole
// beside the real desk (`index.html`, D2a-world), what `rig:parity` still drives. Every oracle
// scene is drawn straight through @ice/desk's engine in Chrome by the Node oracle's OWN desk
// (packages/desk/oracle/frame.mjs: the same passes, the same fixtures, the same scene builder, the
// same prepareFrame → drawFrame), so `rig:parity` can hold this page to the Dawn render at maxΔ 0.
// The only differences are the host's: the canvas's swap-chain texture (the preferred format)
// instead of a readable target, the generated shader text instead of the .wgsl files, the fixtures
// fetched instead of read. It draws on demand — the rig's `__parity.render(name)` — never on a clock.
// Its door is `window.__parity`: `window.__desk` is the REAL desk's (api.ts), a different page and shape.
import { acquire } from "@ice/desk/engine";
import { surface } from "@ice/desk/host";
import { blueNoise } from "@ice/desk/noise";
import { createOracleDesk } from "@ice/desk/oracle/frame.mjs";
import { ORACLE_SCENES, VIEW } from "@ice/desk/oracle/scenes.mjs";
import { shaderText } from "@ice/desk/shaders";
import goboBUrl from "@ice/desk/oracle/fixtures/assets/gobo-b.rgba?url";
import goboCUrl from "@ice/desk/oracle/fixtures/assets/gobo-c.rgba?url";
import glyphMetaUrl from "@ice/desk/oracle/fixtures/assets/glyphs-mono-2x.json?url";
import glyphsUrl from "@ice/desk/oracle/fixtures/assets/glyphs-mono-2x.r8?url";
import inkMetaUrl from "@ice/desk/oracle/fixtures/assets/ink-note-1.json?url";
import inkUrl from "@ice/desk/oracle/fixtures/assets/ink-note-1.r8?url";
import photoMetaUrl from "@ice/desk/oracle/fixtures/assets/photo-1.json?url";
import photoUrl from "@ice/desk/oracle/fixtures/assets/photo-1.rgba?url";

/** The page's door for the rig (and a person at the console). */
export interface DeskParity {
  /** Every oracle scene's name, in the oracle's order. */
  readonly scenes: readonly string[];
  readonly view: { readonly cssW: number; readonly cssH: number; readonly dpr: number };
  /** The swap chain's format (the preferred one; the oracle draws rgba8unorm — the bytes must still agree). */
  readonly format: GPUTextureFormat;
  /** The last scene drawn and how many frames were, and every GPU error — uncaptured, or caught by the probe's scopes (`scoped`: the desk's creation and every frame, each in scopes of its own — D3r-b). */
  readonly state: { drawn: string | null; frames: number; scoped: number; readonly errors: string[] };
  /** Draw one scene into the canvas inside a frame; resolves once the GPU has finished it. */
  render(name: string): Promise<{ readonly portals: number }>;
}

declare global {
  interface Window { __parity?: DeskParity }
}

const byId = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} is missing from index.html`);
  return el as T;
};
const canvas = byId<HTMLCanvasElement>("gpu");
const failEl = byId<HTMLDivElement>("fail");
function fail(e: unknown): void {
  failEl.textContent = e instanceof Error ? (e.stack ?? e.message) : String(e);
  failEl.hidden = false;
}

async function bytesOf(url: string): Promise<Uint8Array<ArrayBuffer>> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}
async function jsonOf<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return (await res.json()) as T;
}

async function boot(): Promise<void> {
  if (!navigator.gpu) throw new Error("WebGPU is not available here — check chrome://gpu");
  const errors: string[] = [];
  const gpu = await acquire({
    gpu: navigator.gpu,
    label: "desk/parity",
    onLost: (info) => fail(`device lost: ${info.reason} — ${info.message}`),
    onError: (err) => { errors.push(err.message); fail(`GPU error: ${err.message}`); },
  });
  const { device } = gpu;
  // The oracle's view, exactly: 1200 × 800 CSS px, a 2400 × 1600 drawing buffer whatever the window's ratio.
  canvas.style.width = `${VIEW.cssW}px`;
  canvas.style.height = `${VIEW.cssH}px`;
  canvas.width = VIEW.cssW * VIEW.dpr;
  canvas.height = VIEW.cssH * VIEW.dpr;
  const surf = surface(device, canvas);
  // The fixtures, the same bytes the oracle reads from disk; the blue noise from the generated module (gen:check keeps it equal to assets/).
  const [goboC, goboB, glyphs, glyphMeta, ink, inkMeta, photo, photoMeta] = await Promise.all([
    bytesOf(goboCUrl), bytesOf(goboBUrl), bytesOf(glyphsUrl), jsonOf<{ count: number }>(glyphMetaUrl), bytesOf(inkUrl), jsonOf<{ w: number; h: number }>(inkMetaUrl),
    bytesOf(photoUrl), jsonOf<{ w: number; h: number }>(photoMetaUrl),
  ]);
  // THE ERROR-SCOPE PROBE (design-015 D3r-b): the desk's creation and every frame in scopes of their own — validation,
  // out-of-memory, internal — so an error is counted where it happened, not only when it escapes (the notebook's and the
  // calendar's layers are recorded into the frame's encoder: the host that submits the frame watches it)
  const SCOPES: GPUErrorFilter[] = ["validation", "out-of-memory", "internal"];
  let scoped = 0;
  const scope = async <T>(what: string, fn: () => T | Promise<T>): Promise<T> => {
    for (const f of SCOPES) device.pushErrorScope(f);
    const out = await fn();
    for (const f of [...SCOPES].reverse()) { const e = await device.popErrorScope(); if (e) { errors.push(`${what} (${f}): ${e.message}`); fail(`GPU error: ${e.message}`); } }
    scoped += 1;
    return out;
  };
  const desk = await scope("creation", () => createOracleDesk({
    device, format: surf.format, text: shaderText,
    assets: { noise: blueNoise(), goboC, goboB, glyphMeta, glyphs, inkMeta, ink, photoMeta, photo },
    log: (message) => console.warn(message),
  }));
  const state: DeskParity["state"] = { drawn: null, frames: 0, get scoped() { return scoped; }, errors };
  window.__parity = {
    scenes: ORACLE_SCENES.map((s) => s.name),
    view: VIEW,
    format: surf.format,
    state,
    async render(name) {
      const sc = ORACLE_SCENES.find((s) => s.name === name);
      if (!sc) throw new Error(`no oracle scene "${name}"`);
      await new Promise((resolve) => requestAnimationFrame(resolve));   // inside a frame, as a host's clock draws
      const { prepared } = await scope(`frame ${name}`, () => {
        const encoder = device.createCommandEncoder();
        const r = desk.encode(encoder, surf.view(), surf.size(), sc.scene);
        device.queue.submit([encoder.finish()]);
        return r;
      });
      await device.queue.onSubmittedWorkDone();
      state.drawn = name;
      state.frames += 1;
      return { portals: prepared.portals };
    },
  };
}

boot().catch(fail);
