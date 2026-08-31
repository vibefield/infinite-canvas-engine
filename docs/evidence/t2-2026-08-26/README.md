# T2 browser evidence — 2026-08-26

The evidence ledger and interpretation live in
[`../../t2-release-evidence.md`](../../t2-release-evidence.md). Do not interpret
an individual PNG or harness `pass` flag without that ledger: the run found
release blockers outside the original leak-only boolean.

Environment:

- Apple M1 Max, 32-core GPU, macOS 26.5.2 (25F84), AC power at 100%;
- performance/leak rows: Chrome 151, 1728×996 CSS px, DPR 2, observed rAF
  cadence about 8.3 ms;
- controlled visuals and isolated WebGPU process-loss test: Chrome 152,
  1200×900 CSS px, DPR 2.

Primary machine-readable artifacts:

- `browser-evidence-main-profile.json` — 20 accepted performance rows, two
  200-cycle rapid-navigation rows, their pre-warmup audits, WebGL2 context loss,
  and the rejected `GPUDevice.destroy()` diagnostic;
- `browser-evidence-isolated-webgpu-loss.json` — rejected internal-URL probe
  plus the passing isolated GPU-process termination probe;
- `browser-evidence-simulated-webgpu-absence-fallback.json` — automatic
  WebGL2 selection with `navigator.gpu` removed before app startup;
- `performance-summary.json` — exact crossover medians, limits, and decisions;
- `startup-idle-diagnostics.json` — excluded fresh-page attempts that violated
  the predeclared idle acceptance rule.

Controlled visual filenames begin with `controlled-`. The legacy/typed WebGL2
root pair is pixel-identical; the WebGPU pair is visually equivalent (ground
crop SSIM 0.992928). The typed WebGPU/WebGL2 root pair is deliberately retained
because it exposes the forced-WebGL2 magnet-field geometry failure. Midpoint,
settled-line, rapid-navigation, fallback, and loss-posture screenshots are named
directly for their state.

Raw JSON is emitted by `window.__iceReleaseEvidence`; PNG files are lossless
browser screenshots. Earlier unsuffixed root images and explicitly named failed
probe images are retained as diagnostic history, not acceptance artifacts.
