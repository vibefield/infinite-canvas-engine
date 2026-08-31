/**
 * Bisect the `copyElementImageToTexture` precondition that the S2 board rig hit
 * ("No cached paint record for element") and gate zero did not. One variable
 * per arm; see hic-paint-record.html for the two candidates.
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { _electron } = require("playwright-core");
const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const app = await _electron.launch({
  executablePath: require("electron"),
  args: [appDir],
  env: { ...process.env, ICE_URL: "", ICE_MESH: "off", ICE_WINDOWS: "1" },
});
let out = null;
try {
  const page = await app.firstWindow();
  page.on("pageerror", (e) => console.error(`  [renderer:error] ${e.message}`));
  await page.goto(`file://${path.join(appDir, "hic-paint-record.html")}`);
  await page.waitForFunction(() => window.__paintRecord !== undefined, null, { timeout: 30_000 });
  out = await page.evaluate(() => window.__paintRecord.run());
  console.log(`[paint-record] dpr=${out.dpr} card=${out.W}x${out.H} device px`);
  for (const r of out.results) {
    console.log(
      `[paint-record] ${r.landed ? "LANDED" : "  ----"}  ${r.label}\n                 backing=${r.backing} paints=${r.paints} threw=${r.threw ?? "no"}${r.pixels ? ` distinct=${r.pixels.distinct} ink=${r.pixels.ink}/${r.pixels.total}` : ""}`,
    );
  }
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  await app.close().catch(() => {});
}
fs.writeFileSync(
  path.join(appDir, "screenshots", "hic-paint-record.json"),
  `${JSON.stringify(out, null, 2)}\n`,
);
