/**
 * The HiC preflight (design-012 §3, plan §5 S0.2) — re-run on EVERY Electron
 * bump. It launches the REAL app twice and grades both halves of the ruling:
 *
 *   1. flags ON  → the probe is green and the composited app MOUNTS.
 *   2. ICE_HIC=off → the probe fails and the app REFUSES at boot with an
 *      honest screen (§11 Q2: never a silent swap to the stratified profile).
 *
 * A one-sided run proves nothing: a probe that returns true unconditionally
 * passes (1) and fails (2), and a build that refuses unconditionally does the
 * reverse. Both arms must land.
 *
 * Screenshots of both windows land in `screenshots/` as the durable witness.
 *
 * Run: `pnpm --filter widgetlab-desktop hic:probe`
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { _electron } = require("playwright-core");

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const shotDir = path.join(appDir, "screenshots");

const log = (msg) => console.log(`[hic-probe] ${msg}`);
const failures = [];
const check = (ok, what) => {
  log(`${ok ? "PASS" : "FAIL"}  ${what}`);
  if (!ok) failures.push(what);
};

async function waitFor(fn, what, timeoutMs = 30_000, everyMs = 200) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn().catch(() => undefined);
    if (v !== undefined && v !== false && v !== null) return v;
    if (Date.now() - t0 > timeoutMs) throw new Error(`timeout waiting for ${what}`);
    await new Promise((r) => setTimeout(r, everyMs));
  }
}

/** Launch the app, read the boot probe + what actually rendered, screenshot, close. */
async function run(label, extraEnv) {
  const app = await _electron.launch({
    executablePath: require("electron"),
    args: [appDir],
    env: { ...process.env, ICE_URL: "", ICE_MESH: "off", ICE_WINDOWS: "1", ...extraEnv },
  });
  try {
    const page = await app.firstWindow();
    page.on("console", (m) => {
      if (m.text().startsWith("[ice]")) console.log(`  [renderer] ${m.text()}`);
    });
    // Wait for a SETTLED outcome, not merely for the probe to exist: the probe
    // is assigned before React commits, so reading the DOM at that moment finds
    // neither the canvas nor the refusal and grades a race instead of a build.
    const state = await waitFor(
      async () => {
        const s = await page.evaluate(() => {
          const probe = window.__iceHicProbe;
          if (probe === undefined) return null;
          const mounted = document.querySelector("[data-ice-canvas]") !== null;
          const refused = /cannot run on this host/i.test(document.body.innerText);
          if (!mounted && !refused) return null; // still booting
          return { probe, mounted, refused, bodyText: document.body.innerText };
        });
        return s ?? undefined;
      },
      `${label} to settle on mounted-or-refused`,
    );
    fs.mkdirSync(shotDir, { recursive: true });
    const shot = path.join(shotDir, `hic-${label}.png`);
    fs.writeFileSync(shot, await page.screenshot());
    log(`${label}: wrote ${path.relative(appDir, shot)}`);
    return state;
  } finally {
    await app.close().catch(() => {});
  }
}

// --- arm 1: flags ON — the composited build must boot ------------------------
log("arm 1/2: CanvasDrawElement switches ON");
const on = await run("flags-on", {});
log(`  capabilities: ${JSON.stringify(on.probe.capabilities)}`);
check(on.probe.supported === true, "flags ON: probe reports HiC supported");
check(on.probe.capabilities.drawElementImage === true, "flags ON: drawElementImage present");
check(on.probe.capabilities.copyElementImageToTexture === true, "flags ON: copyElementImageToTexture present");
check(on.probe.capabilities.requestPaint === true, "flags ON: requestPaint present");
check(on.probe.capabilities.webgpu === true, "flags ON: WebGPU present");
check(on.mounted === true, "flags ON: the composited app MOUNTED");
check(on.refused === false, "flags ON: no refusal screen");

// --- arm 2: flags OFF — the composited build must refuse, loudly -------------
log("arm 2/2: ICE_HIC=off (switches withheld)");
const off = await run("flags-off", { ICE_HIC: "off" });
log(`  capabilities: ${JSON.stringify(off.probe.capabilities)}`);
check(off.probe.supported === false, "flags OFF: probe reports HiC unsupported");
check(off.probe.missing.length > 0, "flags OFF: probe NAMES the missing capabilities");
check(off.refused === true, "flags OFF: the boot-time refusal screen rendered");
check(off.mounted === false, "flags OFF: the canvas never mounted (no silent swap)");
// The screen must NAME each absent capability, not just say "unsupported".
check(/Missing:/.test(off.bodyText), "flags OFF: the screen has a Missing: line");
for (const key of off.probe.missing) {
  check(off.bodyText.includes(key), `flags OFF: the screen names ${key}`);
}
check(
  /enable-features=CanvasDrawElement/.test(off.bodyText),
  "flags OFF: the screen states the fix (the switch to pass)",
);

// The discriminator: the two arms must DIFFER. Identical verdicts mean the
// probe is not reading the platform at all.
check(on.probe.supported !== off.probe.supported, "the two arms disagree (the probe reads the host)");

console.log(
  failures.length === 0
    ? "[hic-probe] ALL PASS"
    : `[hic-probe] ${failures.length} FAILED:\n  - ${failures.join("\n  - ")}`,
);
process.exitCode = failures.length === 0 ? 0 : 1;
