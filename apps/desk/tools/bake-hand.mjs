// BAKE A FACE'S HAND — `ice-hand/1` (petition I59): a TrueType file in, `<out>/<name>.hand.json` and `<out>/<name>.hand.bin` out,
// `<name>` the file's own, lower-cased (Caveat-500.ttf → caveat-500). The baker is `@ice/desk/bake` (published as
// `@vibecook/ice/desk/bake`, so a host bakes its own faces the same way); this is ICE's command line over it, and the gate that
// holds apps/desk's committed atlases to what it makes.
//
//   tsx tools/bake-hand.mjs <font.ttf> [<font.ttf> …] --out <dir> [--em 64] [--check]
//   tsx tools/bake-hand.mjs --desk [--check]     apps/desk's three faces, assets/fonts → assets/hand (`gen:hands`, `gen:check`)
//
// `--check` bakes again and compares bytes with what is on disk: a file missing or one byte off fails (exit 1), naming it, as
// `wgsl-to-ts.mjs --check` fails a stale shaders.gen.ts. A bake that refuses a correction fails too, and writes nothing: the
// derivation changed under it, and its glyph is to be looked at. It runs under tsx — the baker is TypeScript; apps/desk's own
// devDependency, as its rigs run and the objects' oracle does.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { bakeHand } from "@ice/desk/bake";

const app = resolve(import.meta.dirname, "..");
/** apps/desk's faces: the hand's three (`PEN_FACES`' caveat, caveat-bold, kalam). */
const DESK_FACES = ["Caveat-500.ttf", "Caveat-600.ttf", "Kalam-400.ttf"];

const args = process.argv.slice(2);
const VALUED = new Set(["--out", "--em"]);
const option = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const desk = args.includes("--desk");
const check = args.includes("--check");
const named = args.filter((a, i) => !a.startsWith("--") && !VALUED.has(args[i - 1]));
const fonts = desk ? DESK_FACES.map((f) => resolve(app, "assets/fonts", f)) : named.map((f) => resolve(f));
const outArg = option("out");
const out = desk ? resolve(app, "assets/hand") : outArg === undefined ? undefined : resolve(outArg);
const emArg = option("em");
const em = emArg === undefined ? undefined : Number(emArg);
if (fonts.length === 0 || out === undefined || (em !== undefined && !Number.isInteger(em))) {
  console.error("usage: tsx tools/bake-hand.mjs <font.ttf> [<font.ttf> …] --out <dir> [--em 64] [--check]\n       tsx tools/bake-hand.mjs --desk [--check]");
  process.exit(2);
}

const hex = (c) => `U+${c.toString(16).toUpperCase().padStart(4, "0")}`;
let failed = 0;
for (const font of fonts) {
  const file = basename(font);
  const name = file.replace(/\.ttf$/i, "").toLowerCase();
  const t0 = performance.now();
  const baked = bakeHand(new Uint8Array(readFileSync(font)), { file, ...(em === undefined ? {} : { em }) });
  const ms = Math.round(performance.now() - t0);
  const { json } = baked;
  const inked = Object.values(json.glyphs).filter((g) => g.rect !== undefined).length;
  const said = `${name}: ${json.family} ${json.weight}, ${Object.keys(json.glyphs).length} glyphs (${inked} inked), ${json.width} × ${json.height} at ${json.em} an em, ${Object.keys(json.kerning).length} kerning pairs, corrections [${json.corrections.join(", ")}], missing [${baked.missing.map(hex).join(" ")}] — ${ms} ms`;
  if (baked.refused.length > 0) {
    console.error(`${name}: corrections refused — ${baked.refused.join(", ")}: they no longer fit what the derivation finds; look at their glyphs (packages/desk/src/bake/corrections.ts)`);
    failed++;
    continue;
  }
  const paths = { json: resolve(out, `${name}.hand.json`), bin: resolve(out, `${name}.hand.bin`) };
  if (check) {
    const stale = [[paths.json, Buffer.from(baked.text)], [paths.bin, Buffer.from(baked.bin)]]
      .filter(([p, b]) => !existsSync(p) || !readFileSync(p).equals(b))
      .map(([p]) => `${basename(p)} ${existsSync(p) ? "is stale" : "is missing"}`);
    if (stale.length > 0) {
      console.error(`${name}: ${stale.join(", ")} — not what the bake makes; run \`pnpm --filter desk gen:hands\``);
      failed++;
    } else console.log(`${said}: fresh`);
  } else {
    mkdirSync(out, { recursive: true });
    writeFileSync(paths.json, baked.text);
    writeFileSync(paths.bin, baked.bin);
    console.log(`${said}: wrote ${basename(paths.json)}, ${basename(paths.bin)}`);
  }
}
process.exit(failed > 0 ? 1 : 0);
