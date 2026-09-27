# @ice/devtools

`attachDevtools(engine, opts)` — ONE draggable dock (published as `@vibecook/ice/devtools`) holding:

- **strata's frame profiler** — fps, the tick, per-system lanes, the worst frame;
- **the GPU slot** (design-016 §4, K2) — the WebGPU desk's frames as its GPU saw them;
- **strata's observer** — the entities, systems, timeline, and the durable/ephemeral tabs.

It reads the world outside the tick and never writes ECS; nobody imports it (a depcruise-enforced leaf).
It cannot import `@ice/desk`, so the GPU slot reads `GpuPanelFrame` / `GpuPanelStats`. These are
**structural mirrors** of the desk's `GpuFrameReport` / `GpuProfileStats`. `apps/desk/src/devtools.ts`
asserts at compile time that desk's types are assignable to them, so `pnpm run ci` fails the day either
side drifts.

## Opening it in `apps/desk`

Press **`~`** (⇧`; the backtick alone is the dev panel). The dock opens and **arms the GPU profiler**.
Pressing `~` again closes the dock and disarms the profiler. Opening it never wakes the desk: at rest the
desk draws nothing (idle-zero), and the slot says it is waiting for a frame. Move the camera and the
numbers arrive.

Wiring it into another host:

```ts
const profiler = handle.profiler();            // the desk layer's — unarmed until armed
const devtools = attachDevtools(engine, { gpu: { capture: (n) => profiler.capture(n) } });
const release = profiler.arm();
const off = profiler.subscribe((r) => { if (r.kind === "frame") devtools.gpuFrame(r, profiler.stats()); });
// …closing: off(); release(); devtools.detach();
```

For the memory table the host must keep a ledger: `deskLayer({ gpuLedger: true })` (D-K2.2). A GPU
resource made before a ledger exists cannot be found afterwards, so the ledger is installed at the
layer's boot or not at all.

## What each number means

Rolling numbers are **p50 · p95 · max** over the last 120 drawn frames. Work between frames (a raster made
while nothing was drawn) is reported as "loose" and stays out of the window.

| reading | what it is |
|---|---|
| **gpu span** (the headline) | GPU ms from the first timed pass's begin to the last one's end: what the frame took on the GPU's timeline, **waits included** (e.g. for the canvas's drawable). |
| **gpu busy** | The union of the frame's pass intervals: overlapping passes counted once, waits not at all. `span − busy` is what the frame waited between passes. |
| sum (the passes header) | The passes' durations added. **Never the frame's time** (below). |
| encode | CPU ms from the frame's first command encoder to its close: the render call's preparing and encoding. |
| desk flush | CPU ms of the desk layer's flush that held the frame: the kinds' ticks, the build and the encode. |
| passes | Every *labelled* render/compute pass (`ground`, `mat/wind`, `notebook/shadow i`, `notebook/layer`, `board/*`, `hold/*` …), placed on the frame's span. Unlabelled passes are counted, not timed. |
| draws · instances | `draw` + `drawIndexed` + the indirect draws, and the instances the direct ones asked for. |
| pipelines · bind groups | `setPipeline` / `setBindGroup` calls. Every call counts, a rebind of the same object included (each is a command). |
| passes · submits | Render + compute passes begun; `queue.submit` calls in the frame. |
| writes · uploaded | `writeBuffer` + `writeTexture` + `copyExternalImageToTexture` calls and their bytes. An external copy weighs its texels in the destination's format (a 260² rgba8 calendar tile is 270,400 B). |
| by kind | Draws and instances by the kind that drew: the prefix of the pipeline set last (`paper/notes` → `paper`). A run of notes is **one** instanced draw. |
| uploads | The frame's upload bytes by the written resource's label prefix. |
| memory | Live GPU bytes by label, from the ledger. For a texture: Σ over mips of ⌈w/bw⌉·⌈h/bh⌉·blockBytes·layers, × samples, the format's block (1×1 uncompressed, 4×4 BC/ETC2/EAC, ASTC's own). This is the logical size, not what the driver allocates. The swap chain is not in it. |
| dropped | Frames counted but not timed because all three readback slots were still in flight. The profiler never waits for one. |

## The span, never a sum

The Apple tiler keeps passes in flight together, so a pass's own begin/end does not isolate its cost.
The GPU also waits between passes, for example for the drawable the `ground` pass draws into. Measured
at K2 on this Mac (D-K2.4), over 60 real frames:

- in 52 the sum **overstates** the frame (the passes overlap);
- in 8 it **understates** it (1–4 ms of waiting between passes).

Headline the span; read `busy` for the work and `span − busy` for the waits.

The same frame reads differently depending on how it is drawn. A **real** frame renders into a fresh
drawable, and its span includes the wait for it. A frame drawn back to back, or alone and drained,
renders into one texture. On a 60-object scene, the real frames' span p50 was 7.6 ms, while the same frame
isolated read 3.9 ms and the saturated batch 3.9 ms/frame. So compare like with like:

- **latency** — the real frames' span;
- **GPU work** of a still frame — `holdCost`'s saturated batch;
- **a kind's share** — `window.__desk.perf.kindCost()`: ablation over saturated, drained, round-robined
  batches with an A/A control and its noise floor. Every kind draws inside the one `ground` pass, so
  timestamps cannot split them.

## Real timings need two things from Chrome

- **Unquantised timestamps.** Dawn rounds timestamp queries to 100 µs unless Chrome runs with
  `--disable-dawn-features=timestamp_quantization`. The rigs pass it (`apps/desk/scripts/cdp.mjs`).
  Without it, any frame whose every timestamp delta is a whole multiple of 100 µs reads `quantised`, and
  the slot shows a warning that names the switch.
- **Cross-origin isolation.** `performance.now()` is 100 µs-coarse unless the page is cross-origin
  isolated (COOP `same-origin` + COEP `require-corp`). Vite dev and the rig server send both;
  `rig:stress` asserts it.

## Capture

"**capture 120 frames**" saves the next 120 drawn frames as a Chrome trace-event JSON,
`desk-gpu-<time>.json`. Open it in [Perfetto](https://ui.perfetto.dev) or `chrome://tracing`. It holds:

- the CPU spans `desk flush` and `encode`, on the main thread (also as `performance.measure` entries, for
  the Performance panel's Timings track);
- the frame's span and each GPU pass, each on a track of its own, since overlapping passes cannot nest
  on one;
- counters for draws, uploads and memory.

The GPU's clock and `performance.now()` are not correlated. GPU spans are placed at each frame's first
submit, so their durations and relative offsets are the GPU's own, while their placement is the CPU's.
At rest a capture answers at its timeout with what came; it never asks the desk for a frame. Rigs use
`window.__desk.perf.gpu().capture(n)`.

## What it costs

| state | cost |
|---|---|
| unarmed | Nothing is installed. The device's `createCommandEncoder` and the queue's `submit` / writes are the natives. |
| armed | A closure per wrapped method per encoder and pass, and a counter per call. On `rig:stress`'s pan the JS step read 1.21 ms armed against 1.17 ms unarmed. No submit is added (each encoder resolves its own queries inside its own command buffer), no frame is scheduled, and readbacks land in a later task. |

The strata tools arm the engine's telemetry when the dock opens, which turns on reactive stamping
(+17–28 % on write-heavy paths). That stays armed for the page's life, so keep the dock to dev
sessions.

## For rigs

`window.__desk.perf.gpu()` is the profiler (`arm`, `take`, `stats`, `capture`). `perf.take().gpu` drains
the frames completed since the last take. `perf.kindCost(opts)` measures per-kind GPU cost by ablation.
`rig:gpu` witnesses all of it on real frames.
