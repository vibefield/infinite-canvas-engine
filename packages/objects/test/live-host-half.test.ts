// Petition I51 (M24 LT4): THE LIVE FACE'S HOST HALF — `createLiveTexture` (the writer that takes frames) and `stillLive` (a still
// host's source of committed bytes), with their types — is the HOST's: on `@vibecook/ice/desk` beside `deskLayer`, off `/desk/kit`. A
// KIND reads the face through the kit (`LIVE`, `LiveFace`, `LiveTexture`, the sight) and never makes one (VibeField's PA-22: a plugin
// never touches a frame). The cruiser holds the import half inside the desk (`desk-dom-free`: the kit — nothing outside host/ — cannot
// import host/live-texture.ts); the objects import the desk by its ENTRY, where a cruiser sees no names — so this is the API half, the
// grep a cruiser cannot be: no kind's source (the six built-ins', the example plugin kind's) and no kit module names the host half.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { code } from "../../desk/test/dom-touch";

const repo = resolve(import.meta.dirname, "../../..");
/** The host half's names, as code names them (a comment may say them: `code` strips comments). */
const HOST_HALF = /\b(createLiveTexture|stillLive|LiveWriter|LiveTextureOptions|LiveImage|LiveStill)\b/;

function* files(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* files(p);
    else if (name.endsWith(".ts")) yield p;
  }
}
const named = (dir: string): { read: number; offenders: string[] } => {
  const offenders: string[] = [];
  let read = 0;
  for (const p of files(resolve(repo, dir))) {
    read += 1;
    code(readFileSync(p, "utf8")).split("\n").forEach((line, i) => { if (HOST_HALF.test(line)) offenders.push(`${relative(repo, p)}:${i + 1}: ${line.trim()}`); });
  }
  return { read, offenders };
};

describe("no kind names the live face's host half (petition I51)", () => {
  it("the six built-ins and the example plugin kind: none of their sources names the writer or the still source", () => {
    const objects = named("packages/objects/src");
    const example = named("examples/desk-clock/src");
    expect(objects.read).toBeGreaterThan(60);
    expect(example.read).toBeGreaterThan(2);
    expect([...objects.offenders, ...example.offenders]).toEqual([]);
  });

  it("the kit — what a kind is handed whole — names none of it; the host's module does, so the regex is live", () => {
    const kit = named("packages/desk/src/kit");
    expect(kit.read).toBeGreaterThan(20);
    expect(kit.offenders).toEqual([]);
    const host = code(readFileSync(resolve(repo, "packages/desk/src/host/live-texture.ts"), "utf8")).split("\n").filter((l) => HOST_HALF.test(l));
    expect(host.some((l) => /export function createLiveTexture\b/.test(l))).toBe(true);
    expect(host.some((l) => /export function stillLive\b/.test(l))).toBe(true);
  });
});
