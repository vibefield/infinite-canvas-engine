// THE FLAT-CARD PIPELINE (K7b, design-016 §6 K7 — the run question): kinds that declare a card MATERIAL are composed into ONE
// pipeline, and the ground draws their interleaved objects as ONE run — any kind, a plugin's as a built-in's (K-L2), so these
// kinds are fakes. The pixels are the oracle's (`card` check: the card vs every object its own kind's, byte for byte).

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { bindingName, type CardKind, cardEntry, cardLayoutEntries, createCardShared, planCards } from "../src/card/card";
import type { ComposeOptions } from "../src/engine/shader";
import { Ground } from "../src/ground";
import type { CardMaterial, KindPass, KindProgram, StratumName } from "../src/kind";
import { MAT_SHADER_FILES, matShaders } from "../src/mat/shaders";
import { shaderText } from "../src/shaders";
import { themeFrom } from "../src/theme";
import { fakeDevice, fakeSurface, installGpuFlags } from "./fake-gpu";

const VIEW = { camX: 5, camY: 7, zoom: 1, width: 1200, height: 800, dpr: 2 };
const THEMES = { light: themeFrom("light", { canvasBg: { token: "--vf-canvas-bg", css: "#fafafa" }, select: { token: "--vf-select", css: "#4a90d9" } }) };
const LIMITS = { maxSampledTexturesPerShaderStage: 16, maxSamplersPerShaderStage: 16, maxStorageBuffersPerShaderStage: 8, maxUniformBuffersPerShaderStage: 12, maxBindingsPerBindGroup: 1000 };

/** A material over a uniform, a record array and a texture array, its functions named after the kind. */
const material = (name: string, extra: Partial<CardMaterial> = {}): CardMaterial => ({
  shaders: (): ComposeOptions => ({ modules: [{ label: `${name}/shared.wgsl`, text: "fn shared_one() -> f32 { return 1.0; }" }], entry: { label: `${name}/card.wgsl`, text: `fn ${name}_quad(slot: u32, vid: u32) -> vec4f { return vec4f(0.0); }\nfn ${name}_frag(slot: u32, clip: vec4f) -> vec4f { return vec4f(1.0); }` } }),
  bindings: [
    { wgsl: `var<uniform> ${name}_k: vec4f`, entry: { stages: ["fragment"], buffer: "uniform" } },
    { wgsl: `var<storage, read> ${name}s: array<vec4f>`, entry: { stages: ["vertex", "fragment"], buffer: "read-only-storage" } },
    { wgsl: `var ${name}_tex: texture_2d_array<f32>`, entry: { stages: ["fragment"], texture: "float", dimension: "2d-array" } },
  ],
  quad: `${name}_quad`,
  frag: `${name}_frag`,
  ...extra,
});

/** A material naming no fragment function (`exactOptionalPropertyTypes`: the key absent, not undefined). */
const fragless = (m: CardMaterial): CardMaterial => { const { frag: _frag, ...rest } = m; return rest; };

describe("the flat-card plan: which material kinds ONE pipeline composes (K7b)", () => {
  const program = (name: string, card?: CardMaterial, composite = false): KindProgram => ({ name, stratum: "things", ...(card ? { card } : {}), ...(composite ? { composite: true } : {}), create: async () => { throw new Error("not made"); } });

  it("every material kind in registration order; a kind without one draws itself, a composite (its objects are one target's) is left out, a material naming no fragment too", () => {
    const plan = planCards([program("note", material("note")), program("mat"), program("print", material("print")), program("book", material("book"), true), program("odd", fragless(material("odd")))], LIMITS);
    expect(plan.kinds.map((k) => k.name)).toEqual(["note", "print"]);
    expect(plan.left.map((l) => l.name)).toEqual(["book", "odd"]);
  });

  it("a material past the device's per-stage limits is left out (it draws itself) — the kinds before it kept", () => {
    // the card's own four take two textures: with a limit of 4 sampled textures a stage, two materials of one texture each fit, the third does not
    const plan = planCards(["a", "b", "c"].map((n) => program(n, material(n))), { ...LIMITS, maxSampledTexturesPerShaderStage: 4 });
    expect(plan.kinds.map((k) => k.name)).toEqual(["a", "b"]);
    expect(plan.left).toEqual([{ name: "c", why: "its bindings would pass the device's fragment limits" }]);
  });

  it("the composed entry: the card's four bindings, then each material's in order, numbered on; its functions; a dispatch on the high byte — a written-out fragment spliced in place of the call", () => {
    const kinds: CardKind[] = [material("note"), fragless(material("board", { fragInline: "      c = vec4f(0.5);" }))].map((m, i) => ({ name: i === 0 ? "note" : "board", material: m, shaders: m.shaders() }));
    const wgsl = cardEntry(kinds);
    const bound = [...wgsl.matchAll(/@group\(0\) @binding\((\d+)\) var(?:<[^>]+>)? (\w+)/g)].map((m) => `${m[1]} ${m[2]}`);
    expect(bound).toEqual(["0 u", "1 gobo_tex", "2 noise_tex", "3 cards", "4 note_k", "5 notes", "6 note_tex", "7 board_k", "8 boards", "9 board_tex"]);
    expect(wgsl).toContain("case 0u: { out.clip = note_quad(slot, vid); }");
    expect(wgsl).toContain("case 1u: { out.clip = board_quad(slot, vid); }");
    expect(wgsl).toContain("case 0u: { c = note_frag(slot, in.clip); }");
    expect(wgsl).toContain("case 1u: {\n      c = vec4f(0.5);\n    }");
    expect(wgsl).toContain("switch (c >> 24u)");
    expect(cardLayoutEntries(kinds).map((e) => e.binding)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
});

describe("the ground's runs with the card (K7b): interleaved material kinds are ONE draw", () => {
  const undo: (() => void)[] = [];
  beforeAll(() => { undo.push(installGpuFlags()); });
  afterAll(() => { for (const u of undo.splice(0)) u(); });

  /** A kind's pass: every record the card's unless its id says `own` — its slot the record index × 10. */
  const kindPass = (name: string, log: string[]): KindPass => {
    let ids: string[] = [];
    return {
      spawn: () => kindPass(name, log),
      prepare: (_e, _s, records) => { ids = (records as { id: string }[]).map((r) => r.id); return records.length; },
      drawRange: (_p, first, end) => log.push(`${name} ${first}..${end}`),
      cardResources: () => ({ version: 1, resources: [{ label: `${name}/k` }, { label: `${name}/records`, getMappedRange: () => new ArrayBuffer(0) }, { label: `${name}/tex` }] as unknown as GPUBuffer[] }),
      cardSlot: (i) => (ids[i]?.endsWith("own") ? -1 : i * 10),
      dispose: () => {},
    };
  };
  const program = (name: string, log: string[], card: boolean, stratum: StratumName = "things"): KindProgram => ({ name, stratum, ...(card ? { card: material(name) } : {}), create: async () => kindPass(name, log) });
  const object = (kind: string, id: string) => ({ kind, record: { id } });

  it("notes, prints and a thing of a third kind interleaved: the material kinds run as cards — one draw each run however they interleave — the third its own, in paint order", async () => {
    const log: string[] = [];
    const { device } = fakeDevice(log);
    const ground = await Ground.create({ device, surface: fakeSurface(2400, 1600), mat: matShaders(shaderText(MAT_SHADER_FILES)), kinds: [program("note", log, true), program("print", log, true), program("mug", log, false)] });
    const objects = [object("note", "n0"), object("print", "p0"), object("note", "n1"), object("print", "p1"), object("mug", "m0"), object("print", "p2"), object("note", "n2")];
    ground.render({ view: VIEW, theme: THEMES.light, objects });
    const frame = log.slice(log.indexOf("pass ground"));
    const draws = frame.filter((l) => l.startsWith("draw 6") || / \d+\.\.\d+$/.test(l));
    // n0 p0 n1 p1: four cards, ONE draw [0, 4); the mug its own; p2 n2: cards [4, 6), one draw
    expect(draws).toEqual(["draw 6,4,0,0", "mug 0..1", "draw 6,2,0,4"]);
    expect(frame.filter((l) => l === "pipeline card/flat")).toHaveLength(2);
    ground.dispose();
  });

  it("a record its pass keeps (`cardSlot` −1 — a print with its detail bound) is drawn by its kind between the cards, in paint order; with the card OFF every object is its kind's again", async () => {
    const log: string[] = [];
    const { device } = fakeDevice(log);
    const ground = await Ground.create({ device, surface: fakeSurface(2400, 1600), mat: matShaders(shaderText(MAT_SHADER_FILES)), kinds: [program("note", log, true), program("print", log, true)] });
    const objects = [object("note", "n0"), object("print", "p0-own"), object("note", "n1"), object("print", "p1")];
    ground.render({ view: VIEW, theme: THEMES.light, objects });
    let frame = log.slice(log.indexOf("pass ground"));
    expect(frame.filter((l) => l.startsWith("draw 6") || / \d+\.\.\d+$/.test(l))).toEqual(["draw 6,1,0,0", "print 0..1", "draw 6,2,0,1"]);
    const card = ground.root.card;
    expect(card).toBeDefined();
    if (card) card.on = false;
    log.length = 0;
    ground.render({ view: { ...VIEW, camX: 6 }, theme: THEMES.light, objects });
    frame = log.slice(log.indexOf("pass ground"));
    expect(frame.filter((l) => l.startsWith("draw 6") || / \d+\.\.\d+$/.test(l))).toEqual(["note 0..1", "print 0..1", "note 1..2", "print 1..2"]);
    ground.dispose();
  });
});

describe("one material's fault is its own kind's, never the desk's (K9 R3)", () => {
  const undo: (() => void)[] = [];
  beforeAll(() => { undo.push(installGpuFlags()); });
  afterAll(() => { for (const u of undo.splice(0)) u(); });
  afterEach(() => { vi.restoreAllMocks(); });
  const program = (name: string, card?: CardMaterial): KindProgram => ({ name, stratum: "things", ...(card ? { card } : {}), create: async () => ({ spawn: () => { throw new Error("not spawned"); }, prepare: () => 0, drawRange: () => {}, dispose: () => {} }) as unknown as KindPass });
  type Struct = NonNullable<ComposeOptions["structs"]>[number];
  const struct = (name: string, wgsl: string): Struct => ({ name, wgsl }) as unknown as Struct;
  /** A material whose program carries `structs`/`modules` beside the helper's, and `marker` in its entry (what the refusing device reads). */
  const withProgram = (name: string, o: { structs?: Struct[]; modules?: { label: string; text: string }[]; marker?: string }, extra: Partial<CardMaterial> = {}): CardMaterial => {
    const base = material(name, extra);
    const shaders = (): ComposeOptions => { const s = base.shaders(); return { ...s, ...(o.structs ? { structs: o.structs } : {}), modules: o.modules ?? s.modules ?? [], entry: { ...s.entry, text: `${s.entry.text}\n// ${o.marker ?? ""}` } }; };
    return { ...base, shaders };
  };
  /** A device that refuses a module naming BROKEN, or naming CLASH twice (two kinds' pieces that cannot stand in one program). */
  const refusing = (): GPUDevice => {
    const { device } = fakeDevice();
    (device as unknown as { createShaderModule: unknown }).createShaderModule = (d: GPUShaderModuleDescriptor) => ({
      label: d.label ?? "",
      getCompilationInfo: async () => {
        const broken = d.code.includes("BROKEN");
        const clash = d.code.split("CLASH").length > 2;
        return { messages: broken || clash ? [{ type: "error", lineNum: 1, linePos: 1, message: broken ? "unresolved value 'BROKEN'" : "redeclaration of 'clash'" }] : [] };
      },
    });
    return device;
  };

  it("bindingName: the name after `var` and its template, or none", () => {
    expect(bindingName("var<uniform> paper_k: PaperUniforms")).toBe("paper_k");
    expect(bindingName("var<storage, read> boards: array<Board>")).toBe("boards");
    expect(bindingName("var ink_tex: texture_2d_array<f32>")).toBe("ink_tex");
    expect(bindingName("var  ink_samp : sampler")).toBe("ink_samp");
    expect(bindingName("let x = 1")).toBeNull();
  });

  it("the plan refuses a name that is the card's own, another kind's binding or card function, and a struct or module that only NAMES like an earlier kind's — the earlier kind keeps its names", () => {
    const own = planCards([program("a", material("a", { bindings: [{ wgsl: "var<uniform> u: vec4f", entry: { stages: ["fragment"], buffer: "uniform" } }] }))], LIMITS);
    expect(own.kinds).toEqual([]);
    expect(own.left).toEqual([{ name: "a", why: "its name `u` is the card's own" }]);
    const bound = planCards([program("a", material("a")), program("b", material("b", { bindings: [{ wgsl: "var<uniform> a_k: vec4f", entry: { stages: ["fragment"], buffer: "uniform" } }] }))], LIMITS);
    expect(bound.kinds.map((k) => k.name)).toEqual(["a"]);
    expect(bound.left).toEqual([{ name: "b", why: 'its name `a_k` is "a"\'s' }]);
    const fn = planCards([program("a", material("a")), program("b", material("b", { quad: "a_quad" }))], LIMITS);
    expect(fn.left).toEqual([{ name: "b", why: 'its name `a_quad` is "a"\'s' }]);
    const structs = planCards([program("a", withProgram("a", { structs: [struct("Rec", "struct Rec { x: f32 }")] })), program("b", withProgram("b", { structs: [struct("Rec", "struct Rec { x: f32, y: f32 }")] })), program("c", withProgram("c", { structs: [struct("Rec", "struct Rec { x: f32 }")] }))], LIMITS);
    expect(structs.kinds.map((k) => k.name)).toEqual(["a", "c"]);   // c's struct IS a's, text for text: composed once, as before
    expect(structs.left).toEqual([{ name: "b", why: 'its struct `Rec` differs from "a"\'s of the same name' }]);
    const modules = planCards([program("a", withProgram("a", { modules: [{ label: "shared.wgsl", text: "fn one() -> f32 { return 1.0; }" }] })), program("b", withProgram("b", { modules: [{ label: "shared.wgsl", text: "fn one() -> f32 { return 2.0; }" }] }))], LIMITS);
    expect(modules.left).toEqual([{ name: "b", why: 'its module "shared.wgsl" differs from "a"\'s of the same label' }]);
    const nameless = planCards([program("a", material("a", { bindings: [{ wgsl: "texture_2d<f32>", entry: { stages: ["fragment"], texture: "float" } }] }))], LIMITS);
    expect(nameless.left[0]?.why).toBe("its binding `texture_2d<f32>` declares no name (`var… <name>: <type>`)");
  });

  it("a material the device refuses is left out with its error, said once — the card is made of the rest", async () => {
    const said = vi.spyOn(console, "error").mockImplementation(() => {});
    const shared = await createCardShared(refusing(), "bgra8unorm", [program("note", material("note")), program("bad", withProgram("bad", { marker: "BROKEN" })), program("print", material("print"))]);
    expect(shared).not.toBeNull();
    expect(shared?.kinds).toEqual(["note", "print"]);
    expect([...(shared?.material ?? [])]).toEqual([["note", 0], ["print", 1]]);
    expect(shared?.left.map((l) => l.name)).toEqual(["bad"]);
    expect(shared?.left[0]?.why).toMatch(/^its card material does not compile: .*unresolved value 'BROKEN'$/);
    expect(said).toHaveBeenCalledTimes(1);
    expect(said.mock.calls[0]?.[0]).toContain('kind "bad" is left out of the flat card');
  });

  it("two materials that compile alone and not together: the LATER registered goes (a plugin registers after the built-ins), the innocent kind after it stays", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const shared = await createCardShared(refusing(), "bgra8unorm", [program("a", withProgram("a", { marker: "CLASH" })), program("b", material("b")), program("c", withProgram("c", { marker: "CLASH" })), program("d", material("d"))]);
    expect(shared?.kinds).toEqual(["a", "b", "d"]);
    expect(shared?.left.map((l) => l.name)).toEqual(["c"]);
    expect(shared?.left[0]?.why).toMatch(/^its card material does not compile beside the kinds it is composed with: .*redeclaration of 'clash'/);
  });

  it("every material refused: no card, and the ground is still made — every kind draws itself (before K9 the desk never came up)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const device = refusing();
    const ground = await Ground.create({ device, surface: fakeSurface(2400, 1600), mat: matShaders(shaderText(MAT_SHADER_FILES)), kinds: [program("bad", withProgram("bad", { marker: "BROKEN" })), program("mug")] });
    expect(ground.root.card).toBeUndefined();
    expect([...ground.root.kinds.keys()]).toEqual(["bad", "mug"]);
    ground.dispose();
  });
});
