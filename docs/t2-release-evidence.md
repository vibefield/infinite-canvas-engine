# T2 release evidence

Browser run: 2026-08-26. Evidence review: 2026-08-27.

Status: **the public “near-zero performance regression” claim remains blocked**.
The retained cross-ground implementation passes its deterministic ownership tests,
its WebGL2 performance gates, and the defined flight-compositing checks. The browser
run also found issues that functional CI could not expose:

1. WebGPU camera-motion CPU p50 and ground-GPU p50 exceed the ratified limits.
2. Forced WebGL2 renders materially different root magnet geometry from WebGPU.
3. Rapid nested navigation releases measured resources but does not preserve camera
   pose.
4. Real WebGPU process loss reaches the correct ground failure posture, but several
   R3F widgets recover with incorrect dark/gray materials.
5. Fresh pages can intermittently resume continuous ground redraw after appearing
   quiet.

Automatic fallback passes a controlled WebGPU-absence branch test. A physical
no-WebGPU device is still required before calling that row complete.

This document is the evidence ledger for design-011 §14. Raw data and lossless
screenshots are under [`docs/evidence/t2-2026-08-26`](evidence/t2-2026-08-26/README.md).

## Candidate and environment

- Base HEAD: `a166aca`, plus the current design-011 worktree.
- Device: Apple M1 Max, 32-core integrated GPU.
- OS: macOS 26.5.2, build 25F84.
- Power: AC, battery charged to 100%.
- Performance and leak profile: Chrome 151, 1728×996 CSS px, DPR 2, observed
  rAF cadence approximately 8.3 ms.
- Controlled visual and isolated WebGPU-loss profile: Chrome 152, 1200×900 CSS
  px, DPR 2.

The primary machine-readable records are:

- [`browser-evidence-main-profile.json`](evidence/t2-2026-08-26/browser-evidence-main-profile.json)
- [`browser-evidence-isolated-webgpu-loss.json`](evidence/t2-2026-08-26/browser-evidence-isolated-webgpu-loss.json)
- [`browser-evidence-simulated-webgpu-absence-fallback.json`](evidence/t2-2026-08-26/browser-evidence-simulated-webgpu-absence-fallback.json)
- [`performance-summary.json`](evidence/t2-2026-08-26/performance-summary.json)
- [`startup-idle-diagnostics.json`](evidence/t2-2026-08-26/startup-idle-diagnostics.json)

## Deterministic lifecycle evidence

| Trace | Scope | Result |
| --- | --- | --- |
| Coordinator, 240 cycles | cancel, supersede, interrupt, settle; three planes | PASS — exact release and zero terminal retainers |
| DOM, 200 cycles | mount references, inert departing plane, all terminal reasons | PASS — zero held mounts and departing planes |
| R3F, 200 cycles | retained quads, mount holds, FBO pins | PASS — all 200 holds and pins released exactly |
| GroundHost, 120 cycles | procedural, freezable, snapshot; observers and GPU ledger | PASS — peak one 1,920,000-byte snapshot and zero terminal reservations |
| Device loss during flight | renderer failure and coordinator cleanup | PASS — target disposed and reservation released |
| Renderer callbacks | loss classification and initialization failure | PASS — physical failure is distinct from program quarantine |

The source traces are in `packages/core/test/presentation-transition.test.ts`,
`packages/dom/test/dom-widgets.test.ts`, `packages/r3f/test/retained-quads.test.ts`,
and the ground package tests. These prove ownership inverses; they do not replace
the browser evidence below.

The alternating headless CPU proxy remains encouraging: across three seven-repeat
runs, idle measured 0.464–0.492 µs/frame legacy and 0.466–0.487 µs/frame typed;
camera motion measured 2.040–2.181 µs/frame legacy and 2.050–2.174 µs/frame typed.
It has no WebGPU/WebGL2 device and is not used for the public performance verdict.

## Browser performance decision

Protocol: five fresh pages per variant in a balanced crossover; odd pairs ran
legacy then typed and even pairs typed then legacy. Every accepted run completed
360 consecutive quiet frames, 60 warm-up frames, 300 idle frames, and 300 camera
frames. Garbage collection was requested before each run. Rejected attempts were
retained separately rather than silently discarded.

All values below are medians of the five run-level results. Delta is typed minus
legacy. The limit is the largest allowed positive regression.

| Backend | Metric | Legacy | Typed | Delta | Limit | Result |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| WebGPU | idle redraws, each run | 0,0,0,0,0 | 0,0,0,0,0 | 0 | 0 | PASS |
| WebGPU | camera CPU p50 | 0.200 ms | 0.300 ms | +0.100 ms | +0.050 ms | **FAIL** |
| WebGPU | camera CPU p95 | 0.300 ms | 0.400 ms | +0.100 ms | +0.100 ms | PASS |
| WebGPU | camera GPU p50 | 2.884 ms | 3.080 ms | +0.197 ms | +0.144 ms | **FAIL** |
| WebGPU | camera GPU p95 | 3.932 ms | 4.129 ms | +0.197 ms | +0.393 ms | PASS |
| WebGPU | missed-frame ratio | 0% | 0% | 0 pp | +1 pp | PASS |
| WebGL2 | idle redraws, each run | 0,0,0,0,0 | 0,0,0,0,0 | 0 | 0 | PASS |
| WebGL2 | camera CPU p50 | 0.200 ms | 0.200 ms | 0 ms | +0.050 ms | PASS |
| WebGL2 | camera CPU p95 | 0.400 ms | 0.300 ms | -0.100 ms | +0.100 ms | PASS |
| WebGL2 | camera GPU p50 | 6.253 ms | 6.036 ms | -0.217 ms | +0.313 ms | PASS |
| WebGL2 | camera GPU p95 | 9.051 ms | 8.846 ms | -0.205 ms | +0.905 ms | PASS |
| WebGL2 | missed-frame ratio | 0.334% | 0% | -0.334 pp | +1 pp | PASS |

The WebGPU distributions include 1,461 legacy and 1,472 typed ground timestamp
samples; WebGL2 includes 1,129 and 1,288. These are the P0 ground renderer's own
Three timestamp-query values, not the independent R3F compositor timings.

### Startup idle diagnostic

Three excluded attempts violated the predeclared quiet/zero-redraw rule:

- legacy WebGPU resumed with 51 idle redraws after a 120-frame quiet window;
- legacy WebGL2 resumed with 51 redraws after a 360-frame quiet window;
- another legacy WebGL2 page never settled during 20 seconds, then redrew on all
  300 nominal idle frames.

Because this occurred on legacy paths too, it is not evidence of a typed-only
regression. It is still a release concern: a quiet-window gate can miss delayed
continuous work. The exact rejected rows are in `startup-idle-diagnostics.json`.

## Rapid-navigation evidence

Typed WebGPU and typed forced-WebGL2 each ran 20 warm-up cycles followed by 200
measured cycles, aborting every fifth transition.

| Check after warm-up | WebGPU | WebGL2 |
| --- | ---: | ---: |
| source observers delta | 0 | 0 |
| mount entries delta | 0 | 0 |
| DOM hosts delta | 0 | 0 |
| GL islands delta | 0 | 0 |
| allocator bytes delta | 0 | 0 |
| R3F FBO bytes delta | 0 | 0 |
| terminal retainers / reservations / outgoing content | 0 | 0 |
| post-GC JS heap delta | +244,429 B | -2,211,362 B |

The explicit resource-leak gates therefore pass. Heap is diagnostic only because
collection timing is nondeterministic.

The broader audit fails behavioral stability. Root-camera zoom drifted from
0.654545 initially to 2.125567 after WebGPU navigation and to 5.592084 after
WebGL2 navigation. Also, the initial seven live GL islands become zero during
warm-up while cached FBO/allocator bytes stay stable and 3D content remains
visible. This does not prove a leak, but the intended remount/owner semantics need
to be decided and tested. Evidence: [WebGPU after rapid navigation](evidence/t2-2026-08-26/typed-webgpu-after-rapid.png)
and [WebGL2 after rapid navigation](evidence/t2-2026-08-26/typed-webgl2-after-rapid.png).

## Controlled visual validation

The fixed visual profile used zoom 0.5 and a stationary pointer at CSS position
(600, 100).

| Comparison | Measurement | Decision |
| --- | ---: | --- |
| legacy vs typed WebGPU root ground crop | SSIM 0.992928 | PASS — visually equivalent |
| legacy vs typed WebGL2 root ground crop | SSIM 1.000000 | PASS — pixel-identical |
| typed WebGPU vs typed WebGL2 root ground crop | SSIM 0.705112 | **FAIL** |
| typed WebGPU vs WebGL2 settled line canvas | SSIM 0.997775 | PASS |

The forced-WebGL2 root magnet field has large rectangular dead zones around widget
regions instead of the continuous WebGPU field. It affects legacy and typed
WebGL2, so it is a backend-parity defect rather than a typed-registry regression.
See the controlled roots for [legacy WebGPU](evidence/t2-2026-08-26/controlled-legacy-webgpu-root.png),
[typed WebGPU](evidence/t2-2026-08-26/controlled-typed-webgpu-root.png),
[legacy WebGL2](evidence/t2-2026-08-26/controlled-legacy-webgl2-root.png), and
[typed WebGL2](evidence/t2-2026-08-26/controlled-typed-webgl2-root.png).

At the 180 ms enter midpoint on both backends, the transition retained three
planes, one 17,280,000-byte ground snapshot, seven R3F quads, and one departing DOM
plane. Settlement released all retainers/reservations and selected the whiteboard
line program. The empty nested-canvas exit retained only the source plane and did
not allocate a ground snapshot. The captures show no blank P0, vertical flip,
stretch, seam, or lingering double exposure:

- WebGPU: [enter](evidence/t2-2026-08-26/typed-webgpu-enter-midpoint.png),
  [settled line canvas](evidence/t2-2026-08-26/typed-webgpu-line-settled.png),
  [exit](evidence/t2-2026-08-26/typed-webgpu-exit-midpoint.png).
- WebGL2: [enter](evidence/t2-2026-08-26/typed-webgl2-enter-midpoint.png),
  [settled line canvas](evidence/t2-2026-08-26/typed-webgl2-line-settled.png),
  [exit](evidence/t2-2026-08-26/typed-webgl2-exit-midpoint.png).

## Device/context loss and fallback

### WebGL2

`WEBGL_lose_context` on the real ground canvas passes the ground contract:
`backend=webgl2`, `ready=false`, `failed=true`, failure kind `device-lost`, and
`ground.available=false`. Retainers and reservations reach zero while 21 DOM hosts,
seven GL islands, the surrounding UI, and input remain present. See the
[post-loss capture](evidence/t2-2026-08-26/typed-webgl2-after-context-loss.png).

### WebGPU

Destroying the exposed `GPUDevice` is not a valid probe here because Three ignores
loss reason `destroyed`. An internal crash URL also failed to deliver loss in the
test profile. The accepted test used an isolated Chrome profile containing only
the test page and terminated that profile's exact GPU-process PID.

The ground contract passes: `backend=webgpu`, `ready=false`, `failed=true`,
`ground.available=false`, failure API `WebGPU`, and zero terminal retainers and
reservations. DOM and R3F planes survive. However, five seconds later several R3F
widgets have incorrect dark/gray shading, so whole-product recovery fails even
though ground degradation is correct. Compare [immediate loss](evidence/t2-2026-08-26/typed-webgpu-after-gpu-process-kill.png)
with [five seconds later](evidence/t2-2026-08-26/typed-webgpu-five-seconds-after-gpu-process-kill.png).

### Automatic fallback

With `groundBackend=auto` and `navigator.gpu` removed at document start, the app
selects WebGL2 and reaches `ready=true`, `failed=false`, and `ground.available=true`
with 21 DOM hosts, seven GL islands, and no terminal reservations. This passes the
automatic-selection branch; [capture](evidence/t2-2026-08-26/typed-auto-simulated-webgpu-absent-fallback.png).

Chrome's `--disable-webgpu` flag did not remove WebGPU in the tested Chrome 152
build, so that attempt is diagnostic only. A physical browser/device without
WebGPU support remains **NOT RUN**.

## Harness and reproduction

Build and serve the production app, then open the four legacy/typed × auto/WebGL2
query variants with `evidence=1`:

```sh
pnpm --filter widgetlab build
pnpm --filter widgetlab exec vite preview --host 127.0.0.1 --port 4173
```

The page exposes `window.__iceReleaseEvidence`. Its `snapshot()`,
`measurePerformance()`, `runRapidNavigation()`, `triggerWebglContextLoss()`,
`awaitDeviceLoss()`, and `save()` methods emit the schema captured in the raw JSON.
Ordinary mounts do not pay profiling cost because collection is query-gated.

## Release ledger

| Evidence row | WebGPU | WebGL2 |
| --- | --- | --- |
| legacy vs typed root parity | PASS | PASS |
| cross-backend root geometry | **FAIL** | **FAIL** |
| five-run idle/camera performance | **FAIL — p50 CPU/GPU** | PASS |
| 200-cycle explicit resource gates | PASS | PASS |
| rapid-navigation camera stability | **FAIL** | **FAIL** |
| retained enter/settle/exit visual contract | PASS | PASS |
| ground loss posture | PASS | PASS |
| whole-product GPU-loss recovery | **FAIL** | N/A for context-loss probe |
| automatic WebGPU-unavailable fallback | controlled branch PASS; physical device NOT RUN | N/A |
| delayed startup-idle stability | **FAIL intermittently** | **FAIL intermittently** |

Until the failed rows are fixed or explicitly ratified and the physical fallback
row is collected, public language must not claim near-zero performance regression.
