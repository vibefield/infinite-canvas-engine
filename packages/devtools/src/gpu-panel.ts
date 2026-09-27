/**
 * The GPU panel — the WebGPU desk's frames as its GPU saw them (design-016 §4.5, K2), the dock's `gpu` slot: what the "ice gl"
 * panel was for the r3f islands until design-015 D5b, rebuilt for the desk's profiler.
 *
 * Pure DOM, strata's visual language (the observer's and the profiler's palette and type, so the dock reads as one toolset).
 * Fed by pushes of `GpuPanelFrame` + `GpuPanelStats` — STRUCTURAL MIRRORS of `@ice/desk`'s `GpuFrameReport` and
 * `GpuProfileStats` (devtools cannot import desk under the walls — `nobody-imports-desk`; this is how `GlPanelStats`
 * mirrored r3f's `GlFrameStats`). apps/desk holds the two in step: its typecheck asserts desk's are assignable to these.
 *
 *   head      the GPU SPAN's p50 (THE headline: first pass begun → last pass ended), p95 · max, a sparkline against the budget
 *   warning   timestamps quantised to 100 µs — and the Chrome switch that turns it off
 *   frame     span / encode / desk flush bars against the budget, p50 · p95 · max
 *   passes    the last timed frame's passes on its span (they overlap on a tiler: the sum overstates the frame — both shown)
 *   calls     draws · instances · pipelines · bind groups · passes · submits · writes · upload bytes
 *   by kind   draws and instances by the kind that drew (a run of notes is ONE instanced draw)
 *   uploads   the frame's bytes by label · memory: live GPU bytes by label (the ledger), textures / buffers
 *   capture   "capture N frames" → a Chrome trace-event JSON, saved (Perfetto / chrome://tracing)
 *
 * All values land via `textContent` (never innerHTML with data). Rendering is throttled: pushes arrive per frame, the DOM
 * refreshes at ~8 Hz.
 */

/** Mirror of `@ice/desk` `PassTime`. */
export interface GpuPanelPass {
  readonly label: string;
  readonly begin: number;
  readonly end: number;
}

/** Mirror of `@ice/desk` `GpuFrameReport` (structural — see the header). */
export interface GpuPanelFrame {
  readonly frame: number;
  readonly span: number | null;
  readonly sum: number | null;
  readonly passes: readonly GpuPanelPass[];
  readonly counts: {
    readonly draws: number;
    readonly instances: number;
    readonly pipelines: number;
    readonly bindGroups: number;
    readonly passes: number;
    readonly submits: number;
    readonly writes: number;
    readonly uploadBytes: number;
  };
  readonly byKind: Readonly<Record<string, { readonly draws: number; readonly instances: number }>>;
  readonly uploads: Readonly<Record<string, { readonly writes: number; readonly bytes: number }>>;
  readonly cpu: { readonly encode: number; readonly flush: number | null };
  readonly memory: {
    readonly byLabel: Readonly<Record<string, { readonly bytes: number; readonly textures: number; readonly buffers: number }>>;
    readonly textures: number;
    readonly buffers: number;
    readonly total: number;
  } | null;
  readonly quantised: boolean | null;
}

/** Mirror of `@ice/desk` `Rolling`. */
export interface GpuPanelRolling {
  readonly n: number;
  readonly p50: number;
  readonly p95: number;
  readonly max: number;
}

/** Mirror of `@ice/desk` `GpuProfileStats` (the fields the panel reads). */
export interface GpuPanelStats {
  readonly frames: number;
  readonly span: GpuPanelRolling | null;
  readonly encode: GpuPanelRolling | null;
  readonly flush: GpuPanelRolling | null;
  readonly quantised: boolean | null;
  readonly unquantise: string;
  readonly dropped: number;
}

export interface GpuPanelOptions {
  readonly container?: HTMLElement;
  /** The frame budget, ms — the bars' and the sparkline's reference (default 16.7). */
  readonly budgetMs?: number;
  /** Start with the detail body open (default true: the dock opens to read it). */
  readonly expanded?: boolean;
  /** "capture N frames": the host's capture (a trace-event JSON) — the panel saves what it answers. Absent: no button. */
  readonly capture?: (frames: number) => Promise<unknown>;
  /** The frames a capture asks for (default 120). */
  readonly captureFrames?: number;
}

export interface GpuPanel {
  push(frame: GpuPanelFrame, stats?: GpuPanelStats): void;
  readonly el: HTMLElement;
  dispose(): void;
}

const STYLE_ID = "ice-gpu-style";

// strata-prof's palette, verbatim — the panels must read as one toolset.
const CSS = `
.ice-gpu { background: rgba(13,17,23,.96); color: #e6edf3; font: 11px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; user-select: none; }
.ice-gpu * { box-sizing: border-box; }
.ice-gpu-head { display: flex; align-items: center; gap: 8px; padding: 6px 9px; cursor: pointer; }
.ice-gpu-name { font-weight: 700; color: #56d4dd; }
.ice-gpu-span { font-weight: 700; color: #a371f7; min-width: 64px; }
.ice-gpu-tail { color: #8b949e; min-width: 118px; }
.ice-gpu-caret { color: #8b949e; margin-left: auto; }
.ice-gpu-body { display: none; border-top: 1px solid #21262d; padding: 5px 9px 8px; }
.ice-gpu.open .ice-gpu-body { display: block; }
.ice-gpu-warn { display: none; color: #ffa657; padding: 4px 0 2px; white-space: normal; }
.ice-gpu-warn.on { display: block; }
.ice-gpu-sect { color: #8b949e; font-weight: 700; padding: 5px 0 2px; }
.ice-gpu-row { display: flex; align-items: center; gap: 7px; padding: 1px 0; white-space: nowrap; }
.ice-gpu-label { min-width: 84px; max-width: 120px; overflow: hidden; text-overflow: ellipsis; color: #8b949e; }
.ice-gpu-bar { position: relative; flex: 1; height: 5px; border-radius: 3px; background: #21262d; overflow: hidden; }
.ice-gpu-bar > i { position: absolute; top: 0; bottom: 0; left: 0; display: block; background: #58a6ff; border-radius: 3px; }
.ice-gpu-stat { color: #e6edf3; margin-left: auto; min-width: 64px; text-align: right; }
.ice-gpu-dim { color: #8b949e; }
.ice-gpu-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 3px 10px; padding: 2px 0; }
.ice-gpu-cell b { display: block; color: #e6edf3; font-weight: 700; }
.ice-gpu-cell span { color: #8b949e; }
.ice-gpu-foot { display: flex; align-items: center; gap: 8px; padding-top: 6px; color: #8b949e; }
.ice-gpu-btn { background: #21262d; border: 1px solid #30363d; border-radius: 6px; color: #e6edf3; cursor: pointer; font: inherit; padding: 2px 8px; }
.ice-gpu-btn:hover { border-color: #58a6ff; }
.ice-gpu-btn:disabled { color: #8b949e; cursor: default; }
`;

const SPARK_W = 120;
const SPARK_H = 22;
const SPARK_SAMPLES = SPARK_W / 2;

function injectStyle(doc: Document): void {
  if (doc.getElementById(STYLE_ID) !== null) return;
  const el = doc.createElement("style");
  el.id = STYLE_ID;
  el.textContent = CSS;
  doc.head.appendChild(el);
}

export const fmtMs = (ms: number | null | undefined): string => (ms === null || ms === undefined ? "–" : ms >= 10 ? `${ms.toFixed(1)} ms` : `${ms.toFixed(2)} ms`);
export const fmtBytes = (b: number): string => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : b >= 1024 ? `${(b / 1024).toFixed(1)} KB` : `${b} B`);
const fmtK = (n: number): string => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e4 ? `${(n / 1e3).toFixed(1)}k` : String(n));

export function createGpuPanel(opts: GpuPanelOptions = {}): GpuPanel {
  const container = opts.container ?? document.body;
  const doc = container.ownerDocument;
  const budgetMs = opts.budgetMs ?? 16.7;
  injectStyle(doc);

  const root = doc.createElement("div");
  root.className = `ice-gpu${opts.expanded === false ? "" : " open"}`;
  const make = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] => {
    const el = doc.createElement(tag);
    el.className = cls;
    if (text !== undefined) el.textContent = text;
    return el;
  };

  const head = make("div", "ice-gpu-head");
  const spanEl = make("span", "ice-gpu-span", "–");
  const tailEl = make("span", "ice-gpu-tail", "no frame yet");
  const spark = doc.createElement("canvas");
  spark.width = SPARK_W;
  spark.height = SPARK_H;
  spark.style.display = "block";
  head.append(make("span", "ice-gpu-name", "gpu"), spanEl, tailEl, spark, make("span", "ice-gpu-caret", "▾"));
  head.addEventListener("click", () => root.classList.toggle("open"));

  const body = make("div", "ice-gpu-body");
  // until a frame comes: at rest the desk draws nothing, and the profiler never asks it to (K-L5)
  const hint = make("div", "ice-gpu-row ice-gpu-dim", "waiting for a frame — at rest the desk draws nothing (idle-zero); move the camera");
  const warn = make("div", "ice-gpu-warn");
  body.append(hint, warn);
  const sect = (label: string): HTMLElement => { const s = make("div", "ice-gpu-sect", label); body.appendChild(s); return s; };
  const bar = (label: string, into: HTMLElement = body): { fill: HTMLElement; stat: HTMLElement; label: HTMLElement } => {
    const row = make("div", "ice-gpu-row");
    const l = make("span", "ice-gpu-label", label);
    const b = make("div", "ice-gpu-bar");
    const fill = doc.createElement("i");
    b.appendChild(fill);
    const stat = make("span", "ice-gpu-stat");
    row.append(l, b, stat);
    into.appendChild(row);
    return { fill, stat, label: l };
  };
  /** A section whose rows change with the frame: rebuilt on each render. */
  const list = (): HTMLElement => { const el = doc.createElement("div"); body.appendChild(el); return el; };

  sect("frame");
  const spanBar = bar("gpu span");
  const encodeBar = bar("encode");
  const flushBar = bar("desk flush");
  const passesHead = sect("passes");
  const passesEl = list();
  sect("calls");
  const grid = make("div", "ice-gpu-grid");
  body.appendChild(grid);
  const cell = (label: string): HTMLElement => {
    const c = make("div", "ice-gpu-cell");
    const v = doc.createElement("b");
    c.append(v, make("span", "", label));
    grid.appendChild(c);
    return v;
  };
  const cells = {
    draws: cell("draws"), instances: cell("instances"), pipelines: cell("pipelines"), bindGroups: cell("bind groups"),
    passes: cell("passes"), submits: cell("submits"), writes: cell("writes"), uploadBytes: cell("uploaded"),
  };
  sect("by kind");
  const kindsEl = list();
  sect("uploads");
  const uploadsEl = list();
  const memoryHead = sect("memory");
  const memoryEl = list();
  const foot = make("div", "ice-gpu-foot");
  const footText = make("span", "ice-gpu-dim");
  foot.appendChild(footText);
  body.appendChild(foot);
  if (opts.capture !== undefined) {
    const n = opts.captureFrames ?? 120;
    const capture = opts.capture;
    const btn = make("button", "ice-gpu-btn", `capture ${n} frames`);
    btn.type = "button";
    btn.addEventListener("click", () => {
      btn.disabled = true;
      btn.textContent = "capturing…";
      capture(n).then(
        (trace) => { save(doc, trace); btn.textContent = `saved — capture ${n} frames`; },
        (e: unknown) => { btn.textContent = `capture failed: ${e instanceof Error ? e.message : String(e)}`; },
      ).finally(() => { btn.disabled = false; });
    });
    foot.prepend(btn);
  }
  root.append(head, body);
  container.appendChild(root);

  const samples: number[] = [];
  let latest: GpuPanelFrame | undefined;
  let timed: GpuPanelFrame | undefined;
  let stats: GpuPanelStats | undefined;
  let lastRender = Number.NEGATIVE_INFINITY;   // the first push always renders
  let trailing: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;

  const setBar = (b: { fill: HTMLElement; stat: HTMLElement }, ms: number | null | undefined, text: string, over = budgetMs): void => {
    b.fill.style.width = `${ms === null || ms === undefined ? 0 : Math.min(100, (ms / budgetMs) * 100)}%`;
    b.fill.style.background = ms !== null && ms !== undefined && ms > over ? "#ff7b72" : "#58a6ff";
    b.stat.textContent = text;
  };
  const rolling = (r: GpuPanelRolling | null | undefined): string => (r === null || r === undefined ? "–" : `${fmtMs(r.p50)} · p95 ${fmtMs(r.p95)} · max ${fmtMs(r.max)}`);
  const drawSpark = (): void => {
    const ctx = spark.getContext?.("2d") ?? null;
    if (ctx === null) return;
    ctx.clearRect(0, 0, SPARK_W, SPARK_H);
    const top = budgetMs * 2;   // the budget sits mid-height
    for (let i = 0; i < samples.length; i++) {
      const v = samples[i] ?? 0;
      const h = Math.min(SPARK_H, (v / top) * SPARK_H);
      ctx.fillStyle = v > budgetMs ? "#ff7b72" : "#3fb950";
      ctx.fillRect(i * 2, SPARK_H - h, 1.6, h);
    }
    ctx.fillStyle = "rgba(139,148,158,.55)";
    ctx.fillRect(0, SPARK_H / 2, SPARK_W, 1);
  };
  const rows = (into: HTMLElement, items: readonly [string, string, number][]): void => {
    into.textContent = "";
    for (const [label, text, share] of items) {
      const b = bar(label, into);
      b.fill.style.width = `${Math.max(0, Math.min(100, share * 100))}%`;
      b.stat.textContent = text;
      b.label.title = label;
    }
    if (items.length === 0) into.appendChild(make("div", "ice-gpu-row ice-gpu-dim", "none"));
  };

  const render = (): void => {
    const f = latest;
    if (f === undefined) return;
    hint.remove();
    const st = stats;
    spanEl.textContent = st?.span ? fmtMs(st.span.p50) : fmtMs(f.span);
    tailEl.textContent = st?.span ? `p95 ${fmtMs(st.span.p95)} · max ${fmtMs(st.span.max)}` : f.span === null ? "untimed" : "";
    drawSpark();
    const q = st?.quantised ?? f.quantised;
    warn.classList.toggle("on", q === true);
    warn.textContent = q === true ? `⚠ timestamps quantised to 100 µs — launch Chrome with ${st?.unquantise ?? "--disable-dawn-features=timestamp_quantization"}` : "";
    if (!root.classList.contains("open")) return;

    setBar(spanBar, st?.span?.p50 ?? f.span, rolling(st?.span));
    setBar(encodeBar, st?.encode?.p50 ?? f.cpu.encode, rolling(st?.encode));
    setBar(flushBar, st?.flush?.p50 ?? f.cpu.flush, rolling(st?.flush));

    const t = timed;
    const span = t?.span ?? null;
    passesHead.textContent = t === undefined || span === null
      ? "passes — untimed (no timestamp-query, or the readback ring was full)"
      : `passes · frame ${t.frame} · span ${fmtMs(span)} · sum ${fmtMs(t.sum)}`;
    passesEl.textContent = "";
    if (t !== undefined && span !== null && span > 0) {
      for (const p of t.passes) {
        const b = bar(p.label, passesEl);
        b.fill.style.left = `${(p.begin / span) * 100}%`;
        b.fill.style.width = `${Math.max(0.5, ((p.end - p.begin) / span) * 100)}%`;
        b.stat.textContent = fmtMs(p.end - p.begin);
        b.label.title = `${p.label}: ${p.begin.toFixed(3)} → ${p.end.toFixed(3)} ms`;
      }
    }

    const c = f.counts;
    cells.draws.textContent = fmtK(c.draws);
    cells.instances.textContent = fmtK(c.instances);
    cells.pipelines.textContent = fmtK(c.pipelines);
    cells.bindGroups.textContent = fmtK(c.bindGroups);
    cells.passes.textContent = fmtK(c.passes);
    cells.submits.textContent = fmtK(c.submits);
    cells.writes.textContent = fmtK(c.writes);
    cells.uploadBytes.textContent = fmtBytes(c.uploadBytes);

    const kinds = Object.entries(f.byKind).sort((a, b) => b[1].draws - a[1].draws);
    const most = Math.max(1, ...kinds.map(([, k]) => k.draws));
    rows(kindsEl, kinds.map(([name, k]) => [name, `${k.draws} draw${k.draws === 1 ? "" : "s"} · ${fmtK(k.instances)} inst`, k.draws / most]));
    const ups = Object.entries(f.uploads).sort((a, b) => b[1].bytes - a[1].bytes).slice(0, 6);
    const upTotal = Math.max(1, c.uploadBytes);
    rows(uploadsEl, ups.map(([name, u]) => [name, `${fmtBytes(u.bytes)} · ${u.writes}×`, u.bytes / upTotal]));
    const m = f.memory;
    memoryHead.textContent = m === null ? "memory — no ledger (the host keeps none)" : `memory · ${fmtBytes(m.total)} live · textures ${fmtBytes(m.textures)} · buffers ${fmtBytes(m.buffers)}`;
    rows(memoryEl, m === null ? [] : Object.entries(m.byLabel).sort((a, b) => b[1].bytes - a[1].bytes).slice(0, 8).map(([name, r]) => [name, fmtBytes(r.bytes), r.bytes / Math.max(1, m.total)]));
    footText.textContent = `${st?.frames ?? 1} frames in the window${st !== undefined && st.dropped > 0 ? ` · ${st.dropped} dropped (the readback ring was full)` : ""}`;
  };

  return {
    el: root,
    push(frame, s) {
      if (disposed) return;
      latest = frame;
      if (frame.span !== null) {
        timed = frame;
        samples.push(frame.span);
        if (samples.length > SPARK_SAMPLES) samples.splice(0, samples.length - SPARK_SAMPLES);
      }
      if (s !== undefined) stats = s;
      const now = performance.now();
      if (now - lastRender >= 120) {
        lastRender = now;
        render();
      } else if (trailing === undefined) {
        // the last push always shows: at rest the frames stop, and the panel must not keep one from before them
        trailing = setTimeout(() => { trailing = undefined; lastRender = performance.now(); if (!disposed) render(); }, 120 - (now - lastRender));
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (trailing !== undefined) clearTimeout(trailing);
      root.remove();
    },
  };
}

/** Save `trace` as a JSON file (the browser's download): `desk-gpu-<time>.json`. */
function save(doc: Document, trace: unknown): void {
  const view = doc.defaultView;
  if (view === null || typeof view.URL?.createObjectURL !== "function") return;
  const url = view.URL.createObjectURL(new view.Blob([JSON.stringify(trace)], { type: "application/json" }));
  const a = doc.createElement("a");
  a.href = url;
  a.download = `desk-gpu-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  doc.body.appendChild(a);
  a.click();
  a.remove();
  view.setTimeout(() => view.URL.revokeObjectURL(url), 1000);
}
