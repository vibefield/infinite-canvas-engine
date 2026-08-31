/**
 * The GL metrics panel — the engine-specific renderer readout strata has no
 * counterpart for (2026-07-13, James: "comprehensive r3f profiler ... and our
 * engine specific optimization metrics ... with nice visuals").
 *
 * Pure DOM, strata's visual language (same palette/typography as the observer
 * + profiler HUD so the three read as one toolset). Fed by pushes of
 * `GlPanelStats` — the STRUCTURAL MIRROR of @ice/r3f's `GlFrameStats`
 * (devtools cannot import r3f under the walls; keep the shapes aligned):
 *
 *   head      fps · gpu ms + a gpu sparkline against the frame budget
 *   frame     cpu / gpu bars vs budget, with session maxima
 *   render    draw calls · triangles · points/lines · programs · geoms · textures
 *   virtual   live render targets + total resolution, FBO bytes vs budget,
 *   textures  the island phase census as a segmented bar, repaint/evict counters
 *   lod       zoom → hysteresis band → effective DPR, live targets per band
 *   widgets   Visible vs Culled population
 *
 * All values land via `textContent` (never innerHTML with data). Rendering is
 * throttled — pushes arrive per composited frame, the DOM refreshes at ~8 Hz.
 */

/** Mirror of @ice/r3f `GlFrameStats` (structural — see the header). */
export interface GlPanelStats {
  readonly cpuMs: number;
  readonly gpuMs: number;
  readonly fps: number;
  readonly drawCalls: number;
  readonly triangles: number;
  readonly points: number;
  readonly lines: number;
  readonly programs: number;
  readonly geometries: number;
  readonly textures: number;
  readonly renderTargets: number;
  readonly renderMegaPixels: number;
  readonly fboBytes: number;
  readonly fboBudgetBytes: number;
  /** Optional for older producers; current @ice/r3f reports outgoing FBO pins. */
  readonly retainedQuads?: number;
  readonly islands: {
    readonly total: number;
    readonly hot: number;
    readonly warm: number;
    readonly waking: number;
    readonly cold: number;
    readonly dormant: number;
  };
  readonly bandHistogram: Readonly<Record<string, number>>;
  readonly repainted: number;
  readonly pendingPaints: number;
  readonly evicted: number;
  readonly zoom: number;
  readonly band: number;
  readonly effectiveDpr: number;
  readonly visibleWidgets: number;
  readonly culledWidgets: number;
}

export type GlPanelCorner = "tl" | "tr" | "bl" | "br";

export interface GlPanelOptions {
  readonly container?: HTMLElement;
  readonly corner?: GlPanelCorner;
  /** Frame budget in ms — the sparkline's reference line (default 16.7). */
  readonly budgetMs?: number;
  /** Start with the detail body open (default false). */
  readonly expanded?: boolean;
}

export interface GlPanel {
  push(stats: GlPanelStats): void;
  dispose(): void;
}

const STYLE_ID = "ice-gl-style";

// strata-prof's palette, verbatim — the panels must read as one toolset.
const CSS = `
.ice-gl { position: fixed; z-index: 99998; background: rgba(13,17,23,.96);
  border: 1px solid #30363d; border-radius: 10px; color: #e6edf3;
  font: 11px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
  box-shadow: 0 6px 22px rgba(0,0,0,.45); user-select: none; }
.ice-gl * { box-sizing: border-box; }
.ice-gl.tl { top: 10px; left: 10px; } .ice-gl.tr { top: 10px; right: 10px; }
.ice-gl.bl { bottom: 10px; left: 10px; } .ice-gl.br { bottom: 10px; right: 10px; }
.ice-gl-head { display: flex; align-items: center; gap: 8px; padding: 6px 9px; cursor: pointer; }
.ice-gl-name { font-weight: 700; color: #56d4dd; }
.ice-gl-fps { font-weight: 700; color: #a371f7; min-width: 46px; }
.ice-gl-gpu { color: #8b949e; min-width: 74px; }
.ice-gl-caret { color: #8b949e; margin-left: auto; }
.ice-gl-body { display: none; border-top: 1px solid #21262d; padding: 7px 9px 8px; min-width: 300px; }
.ice-gl.open .ice-gl-body { display: block; }
.ice-gl-sect { color: #8b949e; font-weight: 700; padding: 5px 0 2px; }
.ice-gl-row { display: flex; align-items: center; gap: 7px; padding: 1px 0; white-space: nowrap; }
.ice-gl-name2 { min-width: 64px; color: #8b949e; }
.ice-gl-bar { flex: 1; height: 5px; border-radius: 3px; background: #21262d; overflow: hidden; }
.ice-gl-bar > i { display: block; height: 100%; background: #58a6ff; border-radius: 3px; }
.ice-gl-stat { color: #e6edf3; margin-left: auto; }
.ice-gl-dim { color: #8b949e; }
.ice-gl-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 3px 10px; padding: 2px 0; }
.ice-gl-cell b { display: block; color: #e6edf3; font-weight: 700; }
.ice-gl-cell span { color: #8b949e; }
.ice-gl-seg { display: flex; height: 7px; border-radius: 3px; overflow: hidden; background: #21262d; margin: 3px 0 2px; }
.ice-gl-seg > i { display: block; height: 100%; }
.ice-gl-legend { color: #8b949e; padding-bottom: 2px; }
`;

const PHASE_COLORS: Readonly<Record<string, string>> = {
  hot: "#ff7b72",
  waking: "#58a6ff",
  warm: "#3fb950",
  cold: "#8b949e",
  dormant: "#484f58",
};

const SPARK_W = 132;
const SPARK_H = 26;
const SPARK_SAMPLES = SPARK_W / 2;

function injectStyle(doc: Document): void {
  if (doc.getElementById(STYLE_ID) !== null) return;
  const el = doc.createElement("style");
  el.id = STYLE_ID;
  el.textContent = CSS;
  doc.head.appendChild(el);
}

const fmtInt = (n: number): string => n.toLocaleString();
const fmtK = (n: number): string => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n));
const fmtMs = (ms: number): string => `${ms.toFixed(2)}ms`;
const fmtMB = (b: number): string => `${(b / 1048576).toFixed(0)}MB`;

export function createGlPanel(opts: GlPanelOptions = {}): GlPanel {
  const container = opts.container ?? document.body;
  const doc = container.ownerDocument;
  const budgetMs = opts.budgetMs ?? 16.7;
  injectStyle(doc);

  const root = doc.createElement("div");
  root.className = `ice-gl ${opts.corner ?? "bl"}${opts.expanded === true ? " open" : ""}`;

  const head = doc.createElement("div");
  head.className = "ice-gl-head";
  const name = doc.createElement("span");
  name.className = "ice-gl-name";
  name.textContent = "ice gl";
  const fpsEl = doc.createElement("span");
  fpsEl.className = "ice-gl-fps";
  const gpuEl = doc.createElement("span");
  gpuEl.className = "ice-gl-gpu";
  const spark = doc.createElement("canvas");
  spark.width = SPARK_W;
  spark.height = SPARK_H;
  spark.style.display = "block";
  const caret = doc.createElement("span");
  caret.className = "ice-gl-caret";
  caret.textContent = "▾";
  head.append(name, fpsEl, gpuEl, spark, caret);
  head.addEventListener("click", () => root.classList.toggle("open"));

  const body = doc.createElement("div");
  body.className = "ice-gl-body";
  root.append(head, body);
  container.appendChild(root);

  // --- static skeleton (rebuilt values only — no per-push DOM churn) --------
  const sect = (label: string): void => {
    const s = doc.createElement("div");
    s.className = "ice-gl-sect";
    s.textContent = label;
    body.appendChild(s);
  };
  const bar = (label: string): { fill: HTMLElement; stat: HTMLElement } => {
    const row = doc.createElement("div");
    row.className = "ice-gl-row";
    const n = doc.createElement("span");
    n.className = "ice-gl-name2";
    n.textContent = label;
    const b = doc.createElement("div");
    b.className = "ice-gl-bar";
    const fill = doc.createElement("i");
    b.appendChild(fill);
    const stat = doc.createElement("span");
    stat.className = "ice-gl-stat";
    row.append(n, b, stat);
    body.appendChild(row);
    return { fill, stat };
  };
  const textRow = (): HTMLElement => {
    const row = doc.createElement("div");
    row.className = "ice-gl-row";
    body.appendChild(row);
    return row;
  };

  sect("frame");
  const cpuBar = bar("cpu");
  const gpuBar = bar("gpu");

  sect("render");
  const grid = doc.createElement("div");
  grid.className = "ice-gl-grid";
  body.appendChild(grid);
  const cell = (label: string): HTMLElement => {
    const c = doc.createElement("div");
    c.className = "ice-gl-cell";
    const v = doc.createElement("b");
    const l = doc.createElement("span");
    l.textContent = label;
    c.append(v, l);
    grid.appendChild(c);
    return v;
  };
  const callsEl = cell("calls");
  const trisEl = cell("triangles");
  const ptsEl = cell("pts+lines");
  const progsEl = cell("programs");
  const geosEl = cell("geometries");
  const texsEl = cell("textures");

  sect("virtual textures");
  const rtRow = textRow();
  const fboBar = bar("fbo mem");
  const seg = doc.createElement("div");
  seg.className = "ice-gl-seg";
  body.appendChild(seg);
  const legend = doc.createElement("div");
  legend.className = "ice-gl-legend";
  body.appendChild(legend);
  const paintRow = textRow();

  sect("lod");
  const lodRow = textRow();
  const bandsRow = textRow();

  sect("widgets");
  const cullBar = bar("visible");

  // --- push/render (throttled) ----------------------------------------------
  const samples: number[] = [];
  let latest: GlPanelStats | undefined;
  let maxCpu = 0;
  let maxGpu = 0;
  let evictedTotal = 0;
  let lastRender = 0;
  let disposed = false;

  const drawSpark = (): void => {
    const ctx = spark.getContext("2d");
    if (ctx === null) return;
    ctx.clearRect(0, 0, SPARK_W, SPARK_H);
    const top = budgetMs * 2; // budget sits mid-height
    for (let i = 0; i < samples.length; i++) {
      const v = samples[i] ?? 0;
      const h = Math.min(SPARK_H, (v / top) * SPARK_H);
      ctx.fillStyle = v > budgetMs ? "#ff7b72" : "#3fb950";
      ctx.fillRect(i * 2, SPARK_H - h, 1.6, h);
    }
    ctx.fillStyle = "rgba(139,148,158,.55)";
    ctx.fillRect(0, SPARK_H / 2, SPARK_W, 1);
  };

  const render = (): void => {
    const s = latest;
    if (s === undefined) return;
    fpsEl.textContent = s.fps > 0 ? `${Math.round(s.fps)} fps` : "– fps";
    gpuEl.textContent = s.gpuMs > 0 ? `gpu ${fmtMs(s.gpuMs)}` : "gpu –";
    drawSpark();
    if (!root.classList.contains("open")) return;

    cpuBar.fill.style.width = `${Math.min(100, (s.cpuMs / budgetMs) * 100)}%`;
    cpuBar.stat.textContent = `${fmtMs(s.cpuMs)} · max ${fmtMs(maxCpu)}`;
    gpuBar.fill.style.width = `${Math.min(100, (s.gpuMs / budgetMs) * 100)}%`;
    gpuBar.fill.style.background = s.gpuMs > budgetMs ? "#ff7b72" : "#58a6ff";
    gpuBar.stat.textContent = `${fmtMs(s.gpuMs)} · max ${fmtMs(maxGpu)}`;

    callsEl.textContent = fmtInt(s.drawCalls);
    trisEl.textContent = fmtK(s.triangles);
    ptsEl.textContent = fmtK(s.points + s.lines);
    progsEl.textContent = fmtInt(s.programs);
    geosEl.textContent = fmtInt(s.geometries);
    texsEl.textContent = fmtInt(s.textures);

    rtRow.textContent = `${s.renderTargets} targets · ${s.renderMegaPixels.toFixed(1)} MP total · ${s.retainedQuads ?? 0} retained`;
    fboBar.fill.style.width = `${Math.min(100, (s.fboBytes / s.fboBudgetBytes) * 100)}%`;
    fboBar.fill.style.background = s.fboBytes > s.fboBudgetBytes * 0.85 ? "#ffa657" : "#58a6ff";
    fboBar.stat.textContent = `${fmtMB(s.fboBytes)} / ${fmtMB(s.fboBudgetBytes)}`;

    seg.textContent = "";
    const phases: Array<[string, number]> = [
      ["hot", s.islands.hot],
      ["waking", s.islands.waking],
      ["warm", s.islands.warm],
      ["cold", s.islands.cold],
      ["dormant", s.islands.dormant],
    ];
    const denom = Math.max(1, s.islands.total);
    const legendParts: string[] = [];
    for (const [phase, count] of phases) {
      if (count === 0) continue;
      const i = doc.createElement("i");
      i.style.width = `${(count / denom) * 100}%`;
      i.style.background = PHASE_COLORS[phase] ?? "#8b949e";
      seg.appendChild(i);
      legendParts.push(`${count} ${phase}`);
    }
    legend.textContent = legendParts.length > 0 ? legendParts.join(" · ") : "no islands";
    paintRow.textContent = `repainted ${s.repainted}/frame · pending ${s.pendingPaints} · evicted Σ${evictedTotal}`;

    lodRow.textContent = `zoom ${(s.zoom * 100).toFixed(0)}% → band ×${s.band} → paint dpr ${s.effectiveDpr.toFixed(2)}`;
    const bands = Object.entries(s.bandHistogram).sort((a, b) => a[0].localeCompare(b[0]));
    bandsRow.textContent =
      bands.length > 0 ? `targets by band: ${bands.map(([k, v]) => `${k}: ${v}`).join(" · ")}` : "no live targets";

    const pop = Math.max(1, s.visibleWidgets + s.culledWidgets);
    cullBar.fill.style.width = `${(s.visibleWidgets / pop) * 100}%`;
    cullBar.fill.style.background = "#3fb950";
    cullBar.stat.textContent = `${s.visibleWidgets} visible · ${s.culledWidgets} culled`;
  };

  return {
    push(s) {
      if (disposed) return;
      latest = s;
      maxCpu = Math.max(maxCpu, s.cpuMs);
      maxGpu = Math.max(maxGpu, s.gpuMs);
      evictedTotal += s.evicted;
      samples.push(s.gpuMs > 0 ? s.gpuMs : s.cpuMs);
      if (samples.length > SPARK_SAMPLES) samples.splice(0, samples.length - SPARK_SAMPLES);
      const now = performance.now();
      if (now - lastRender >= 120) {
        lastRender = now;
        render();
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      root.remove();
    },
  };
}
