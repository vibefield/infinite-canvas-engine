// THE FLAT-CARD PIPELINE (K7b, design-016 §6 K7 — the run question). In mixed sibling order a run of one kind ends at the
// next object of another: rig:scale measured draws ≈ 0.3 × the objects drawn at every zoom (610 at zoom 0.2 — a pipeline and a
// bind group a run). The kinds that declare a CARD MATERIAL (kind.ts `CardMaterial` — the note, the print, the whiteboard) are
// composed here into ONE pipeline: the kit's pieces and every material's structs and modules (deduplicated by name and label),
// every material's bindings (numbers dealt after the card's own four), its card functions and a dispatch on the card's
// material. Interleaved objects of every such kind are then one run, ONE draw: an instance a card, `cards[i]` its material (the
// high byte) and its slot in that kind's records (the low 24 bits). Each is drawn by its OWN kind's functions over its own
// kind's records, uniforms and textures, bound here beside the slot's view block and mat — the pixels its own pipeline makes
// (the golden holds it). A kind still draws what its pass keeps (`cardSlot` −1: a print with its detail bound, a board with its
// raster or its live stroke), and an object with a live inside always (its inside goes right after it).
//
// The ground names no kind here either (design-015 §5.2, K-L2): a plugin kind that declares a material is composed the same way.

import { type BindEntry, bindGroup, bindLayout, renderPipeline, storageBuffer } from "../engine/pipeline";
import { type ComposeOptions, compile, compose, type ShaderPart } from "../engine/shader";
import type { StructDef } from "../engine/struct";
import type { CardMaterial, KindPass, KindProgram, SlotContext } from "../kind";
import type { MatPass } from "../kit/view";
import { litByOwn } from "../mat/layout";

/** Premultiplied "source over" — every flat kind's blend; the card draws what they draw, into the pass they share. */
const BLEND_PREMUL: GPUBlendState = {
  color: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
  alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
};

/** A card's slot in its kind's records: the low 24 bits; the high byte its material. */
export const CARD_SLOT_BITS = 24;
const SLOT_MASK = 2 ** CARD_SLOT_BITS - 1;
/** The card's own bindings before the materials': the slot's view block, its gobo silhouette, the blue noise, the draw list. */
const OWN: readonly BindEntry[] = [
  { binding: 0, stages: ["vertex", "fragment"], buffer: "uniform" },
  { binding: 1, stages: ["fragment"], texture: "float" },
  { binding: 2, stages: ["fragment"], texture: "float" },
  { binding: 3, stages: ["vertex"], buffer: "read-only-storage" },
];

/** A kind composed into the card: its name (the ground's key), its material, and its program (the material's `shaders()`, asked once). */
export interface CardKind { readonly name: string; readonly material: CardMaterial; readonly shaders: ComposeOptions }

/** What one card pipeline composes: its kinds by material index, and what it could not (a limit it would pass — they draw themselves). */
export interface CardPlan { readonly kinds: readonly CardKind[]; readonly left: readonly { readonly name: string; readonly why: string }[] }

type Limits = Pick<GPUSupportedLimits, "maxSampledTexturesPerShaderStage" | "maxSamplersPerShaderStage" | "maxStorageBuffersPerShaderStage" | "maxUniformBuffersPerShaderStage" | "maxBindingsPerBindGroup">;

/** The card's own bindings' names (`cardEntry`): a material's binding may not take one. */
const OWN_NAMES: readonly string[] = ["u", "gobo_tex", "noise_tex", "cards"];
/** A binding's name from its WGSL (`var<uniform> paper_k: PaperUniforms` → `paper_k`); null when it declares none the card can read. */
export const bindingName = (wgsl: string): string | null => /^\s*var(?:\s*<[^>]*>)?\s+([A-Za-z_][A-Za-z0-9_]*)\s*:/.exec(wgsl)?.[1] ?? null;

/**
 * What one card program cannot hold twice (K9 R3): a binding's name, a card function's name, a struct's name with OTHER text, a
 * module's label with OTHER text. `cardShaders` deduplicates structs by name and modules by label — two kinds sharing the kit's
 * pieces compose them once — but a kind whose struct or module only NAMES like another's, with different fields or text, would
 * either fail the compile (and, before K9, take every kind's card down) or read the other's layout silently. The names go to the
 * kind registered first; the later kind is left out and draws itself.
 */
interface Taken {
  readonly names: Map<string, string>;     // a binding or card function name → the kind that has it (the card's own: "the card")
  readonly structs: Map<string, { readonly text: string; readonly by: string }>;
  readonly modules: Map<string, { readonly text: string; readonly by: string }>;
}

/** Why `k` cannot join the card beside what `taken` already holds — null when it can (then its names are recorded). */
function collision(k: CardKind, taken: Taken): string | null {
  const names: string[] = [];
  for (const b of k.material.bindings) {
    const n = bindingName(b.wgsl);
    if (n === null) return `its binding \`${b.wgsl}\` declares no name (\`var… <name>: <type>\`)`;
    names.push(n);
  }
  names.push(k.material.quad);
  if (k.material.frag !== undefined) names.push(k.material.frag);
  for (const n of names) {
    const by = taken.names.get(n);
    if (by !== undefined) return `its name \`${n}\` is ${by === "the card" ? "the card's own" : `"${by}"'s`}`;
  }
  if (new Set(names).size !== names.length) return "two of its bindings or card functions share a name";
  for (const s of k.shaders.structs ?? []) {
    const had = taken.structs.get(s.name);
    if (had !== undefined && had.text !== s.wgsl) return `its struct \`${s.name}\` differs from "${had.by}"'s of the same name`;
  }
  for (const m of k.shaders.modules ?? []) {
    const had = taken.modules.get(m.label);
    if (had !== undefined && had.text !== m.text) return `its module "${m.label}" differs from "${had.by}"'s of the same label`;
  }
  for (const n of names) taken.names.set(n, k.name);
  for (const s of k.shaders.structs ?? []) if (!taken.structs.has(s.name)) taken.structs.set(s.name, { text: s.wgsl, by: k.name });
  for (const m of k.shaders.modules ?? []) if (!taken.modules.has(m.label)) taken.modules.set(m.label, { text: m.text, by: k.name });
  return null;
}

/**
 * The kinds one card pipeline composes, in registration order — a material kind is left out (and draws itself) when it is a
 * composite (its objects are one target's), when adding it would pass one of the device's per-stage limits, or (K9 R3) when a
 * name of its would collide with the card's own or an earlier kind's.
 */
export function planCards(programs: readonly KindProgram[], limits: Limits): CardPlan {
  const kinds: CardKind[] = [];
  const left: { name: string; why: string }[] = [];
  // what the card's own four take: a uniform block (both stages), two textures, a storage buffer (the vertex stage)
  const used = { vertex: { tex: 0, samp: 0, sto: 1, uni: 1 }, fragment: { tex: 2, samp: 0, sto: 0, uni: 1 }, bindings: OWN.length };
  const taken: Taken = { names: new Map(OWN_NAMES.map((n) => [n, "the card"])), structs: new Map(), modules: new Map() };
  for (const p of programs) {
    if (p.card === undefined) continue;
    if (p.composite === true) { left.push({ name: p.name, why: "a composite draws one target of its own" }); continue; }
    if (p.card.frag === undefined && p.card.fragInline === undefined) { left.push({ name: p.name, why: "its material names no fragment" }); continue; }
    if (kinds.length > 255) { left.push({ name: p.name, why: "a card's material is its high byte: 256 at most" }); continue; }
    const next = { vertex: { ...used.vertex }, fragment: { ...used.fragment }, bindings: used.bindings + p.card.bindings.length };
    for (const b of p.card.bindings) {
      for (const st of b.entry.stages) {
        if (st === "compute") continue;
        const u = next[st];
        if ("buffer" in b.entry) { if (b.entry.buffer === "uniform") u.uni += 1; else u.sto += 1; }
        else if ("texture" in b.entry) u.tex += 1;
        else u.samp += 1;
      }
    }
    const over = (["vertex", "fragment"] as const).find((st) => next[st].tex > limits.maxSampledTexturesPerShaderStage || next[st].samp > limits.maxSamplersPerShaderStage || next[st].sto > limits.maxStorageBuffersPerShaderStage || next[st].uni > limits.maxUniformBuffersPerShaderStage);
    if (over !== undefined || next.bindings > limits.maxBindingsPerBindGroup) { left.push({ name: p.name, why: `its bindings would pass the device's ${over ?? "bind group"} limits` }); continue; }
    const k: CardKind = { name: p.name, material: p.card, shaders: p.card.shaders() };
    const clash = collision(k, taken);
    if (clash !== null) { left.push({ name: p.name, why: clash }); continue; }
    used.vertex = next.vertex; used.fragment = next.fragment; used.bindings = next.bindings;
    kinds.push(k);
  }
  return { kinds, left };
}

/** The card's own entry: its bindings, every material's, their `only` and card functions, and the dispatch on the card's material. */
export function cardEntry(kinds: readonly CardKind[]): string {
  const out: string[] = [
    "// THE FLAT-CARD PIPELINE (K7b; desk card/card.ts): every card material's functions over its own bindings, one dispatch.",
    "override LIT_ELSEWHERE: bool = false;",
    "@group(0) @binding(0) var<uniform> u: MatUniforms;",
    "@group(0) @binding(1) var gobo_tex: texture_2d<f32>;",
    "@group(0) @binding(2) var noise_tex: texture_2d<f32>;",
    "@group(0) @binding(3) var<storage, read> cards: array<u32>;   // the draw list: material << 24 | the record's slot in its kind",
  ];
  let b = OWN.length;
  for (const k of kinds) for (const x of k.material.bindings) out.push(`@group(0) @binding(${b++}) ${x.wgsl};   // ${k.name}`);
  for (const k of kinds) if (k.material.only !== undefined) out.push(k.material.only);
  for (const k of kinds) out.push(k.shaders.entry.text);
  const vs = kinds.map((k, m) => `    case ${m}u: { out.clip = ${k.material.quad}(slot, vid); }`).join("\n");
  const fs = kinds.map((k, m) => (k.material.fragInline !== undefined ? `    case ${m}u: {\n${k.material.fragInline}\n    }` : `    case ${m}u: { c = ${k.material.frag}(slot, in.clip); }`)).join("\n");
  out.push(`struct CardOut {
  @builtin(position) clip: vec4f,
  @location(0) @interpolate(flat) card: u32,
}

@vertex
fn vs(@builtin(vertex_index) vid: u32, @builtin(instance_index) iid: u32) -> CardOut {
  var out: CardOut;
  out.clip = vec4f(2.0, 2.0, 2.0, 1.0);
  let c = cards[iid];
  out.card = c;
  let slot = c & ${SLOT_MASK}u;
  switch (c >> ${CARD_SLOT_BITS}u) {
${vs}
    default: {}
  }
  return out;
}

@fragment
fn fs(in: CardOut) -> @location(0) vec4f {
  let slot = in.card & ${SLOT_MASK}u;
  var c = vec4f(-1.0);
  switch (in.card >> ${CARD_SLOT_BITS}u) {
${fs}
    default: {}
  }
  if (c.a < 0.0) { discard; }
  return c;
}
`);
  return out.join("\n");
}

/** The card's program: every material's structs (by name) and modules (by label) once, in order, then the card's entry. */
export function cardShaders(kinds: readonly CardKind[]): ComposeOptions {
  const structs: StructDef<string>[] = [];
  const modules: ShaderPart[] = [];
  const names = new Set<string>();
  const labels = new Set<string>();
  for (const k of kinds) {
    for (const s of k.shaders.structs ?? []) if (!names.has(s.name)) { names.add(s.name); structs.push(s); }
    for (const m of k.shaders.modules ?? []) if (!labels.has(m.label)) { labels.add(m.label); modules.push(m); }
  }
  return { structs, modules, entry: { label: "card/card (composed)", text: cardEntry(kinds) } };
}

/** The layout: the card's own four, then every material's bindings in order. */
export function cardLayoutEntries(kinds: readonly CardKind[]): BindEntry[] {
  const entries: BindEntry[] = [...OWN];
  for (const k of kinds) for (const x of k.material.bindings) entries.push({ ...x.entry, binding: entries.length } as BindEntry);
  return entries;
}

/** The pipelines every slot's card draws with (once per device). */
export interface CardShared {
  /** The kinds composed, by material index. */
  readonly kinds: readonly string[];
  readonly material: ReadonlyMap<string, number>;
  readonly layout: GPUBindGroupLayout;
  readonly pipeline: GPURenderPipeline;
  /** The same, for a slot lit from elsewhere (MINIMAT.md §4) — the materials' `LIT_ELSEWHERE`. */
  readonly litPipeline: GPURenderPipeline;
  /** What was left out, and why. */
  readonly left: CardPlan["left"];
}

type Built = { readonly ok: true; readonly layout: GPUBindGroupLayout; readonly pipeline: GPURenderPipeline; readonly litPipeline: GPURenderPipeline } | { readonly ok: false; readonly why: string };

/** One card program over `kinds` — its layout, module and both pipelines — or why the device refused it (the compile's first error). */
async function buildCard(device: GPUDevice, format: GPUTextureFormat, kinds: readonly CardKind[]): Promise<Built> {
  try {
    const layout = bindLayout(device, cardLayoutEntries(kinds), "card/flat");
    const module = await compile(device, compose(cardShaders(kinds)));
    const pl = device.createPipelineLayout({ bindGroupLayouts: [layout] });
    const [pipeline, litPipeline] = await Promise.all([
      renderPipeline(device, { label: "card/flat", layout: pl, module, format, blend: BLEND_PREMUL }),
      renderPipeline(device, { label: "card/flat, lit from elsewhere", layout: pl, module, format, blend: BLEND_PREMUL, constants: { LIT_ELSEWHERE: 1 } }),
    ]);
    return { ok: true, layout, pipeline, litPipeline };
  } catch (e) {
    const lines = (e instanceof Error ? e.message : String(e)).split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
    return { ok: false, why: (lines.length > 1 && lines[0]?.startsWith("WGSL ") ? lines[1] : lines[0]) ?? "refused" };
  }
}

/**
 * The card's pipelines for the registered programs; null when none declares a material the device can compose. A material the
 * device REFUSES (K9 R3 — a plugin's WGSL error, a binding whose type its layout belies) takes only its own kind out of the card:
 * each material is then compiled alone and the ones that fail are left with their error; if what remains still fails together (a
 * collision the plan did not see), the last registered goes until the card compiles (a plugin registers after the built-ins).
 * Every kind left out draws itself, as one past the device's limits does, and is said once (`console.error`, and `left`).
 */
export async function createCardShared(device: GPUDevice, format: GPUTextureFormat, programs: readonly KindProgram[]): Promise<CardShared | null> {
  const plan = planCards(programs, device.limits);
  const left = [...plan.left];
  const leave = (k: CardKind, why: string): void => { left.push({ name: k.name, why }); console.error(`desk: kind "${k.name}" is left out of the flat card — it draws itself: ${why}`); };
  let kinds = plan.kinds;
  let built: Built | null = kinds.length === 0 ? null : await buildCard(device, format, kinds);
  if (built !== null && !built.ok) {
    const alone = await Promise.all(kinds.map((k) => buildCard(device, format, [k])));
    const kept: CardKind[] = [];
    kinds.forEach((k, i) => { const b = alone[i] as Built; if (b.ok) kept.push(k); else leave(k, `its card material does not compile: ${b.why}`); });
    kinds = kept;
    built = kinds.length === 0 ? null : await buildCard(device, format, kinds);
    while (built !== null && !built.ok) {
      // the kind whose removal alone lets the rest compile — the LAST registered such one goes (of a clashing pair, the later: a
      // plugin registers after the built-ins); none (two clashes at once): the last registered goes, and the rest are asked again
      const why = built.why;
      let culprit = kinds.length - 1;
      let rest: Built | null = null;
      for (let i = kinds.length - 1; i >= 0; i--) {
        const others = kinds.filter((_, j) => j !== i);
        const b = others.length === 0 ? null : await buildCard(device, format, others);
        if (b === null || b.ok) { culprit = i; rest = b; break; }
      }
      leave(kinds[culprit] as CardKind, `its card material does not compile beside the kinds it is composed with: ${why}`);
      kinds = kinds.filter((_, j) => j !== culprit);
      built = rest !== null ? rest : kinds.length === 0 ? null : await buildCard(device, format, kinds);
    }
  }
  if (built === null || !built.ok) return null;
  return { kinds: kinds.map((k) => k.name), material: new Map(kinds.map((k, i) => [k.name, i])), layout: built.layout, pipeline: built.pipeline, litPipeline: built.litPipeline, left };
}

/**
 * One slot's card: its draw list (the ground pushes a card for every object a material kind's pass lets go, in the order its
 * runs walk them) and the bind group over the slot's view block and mat and ITS kinds' resources — made again only when one of
 * them was replaced. The list is uploaded only when it changed (a camera move over a settled desk writes nothing).
 */
export class CardPass {
  readonly name = "card";
  /** Off: the ground routes nothing here — every object is drawn by its kind's own pass (a witness's second draw, a rig's A/B). */
  on = true;
  private list = new Uint32Array(256);
  private sent = new Uint32Array(256);
  private n = 0;
  private sentN = -1;
  private buffer: GPUBuffer;
  private group: GPUBindGroup | null = null;
  /** What the group was made over: the mat's assets, the list's buffer, and each material's version. */
  private boundOver: number[] = [];
  private litElsewhere = false;
  /** Each object's card this frame (−1: none) — a slot's route, reused frame to frame (`route`). */
  private routes = new Int32Array(256);
  private readonly device: GPUDevice;
  private readonly shared: CardShared;
  private readonly mat: MatPass;
  private readonly kinds: ReadonlyMap<string, KindPass>;
  private bufferVersion = 0;

  constructor(device: GPUDevice, shared: CardShared, mat: MatPass, kinds: ReadonlyMap<string, { readonly pass: KindPass }>) {
    this.device = device; this.shared = shared; this.mat = mat;
    this.kinds = new Map(shared.kinds.map((name) => [name, (kinds.get(name) as { readonly pass: KindPass }).pass]));
    this.buffer = storageBuffer(device, this.list.byteLength, "card/list");
  }

  /** A slot's card on the same pipelines, over ITS mat and kinds. */
  spawn(mat: MatPass, kinds: ReadonlyMap<string, { readonly pass: KindPass }>): CardPass { return new CardPass(this.device, this.shared, mat, kinds); }

  /** The material index of kind `name`, or undefined when the card does not draw it. */
  materialOf(name: string): number | undefined { return this.shared.material.get(name); }

  /** A frame's list begins, and a route for `n` objects, every one −1 (drawn by its kind). */
  begin(n: number): Int32Array {
    this.n = 0;
    if (this.routes.length < n) this.routes = new Int32Array(Math.max(n, this.routes.length * 2));
    const r = this.routes.subarray(0, n);
    r.fill(-1);
    return r;
  }

  /** A card for record `slot` of material `m`: its index in this frame's list (the ground's run counts it). */
  push(m: number, slot: number): number {
    if (this.n === this.list.length) { const next = new Uint32Array(this.list.length * 2); next.set(this.list); this.list = next; }
    this.list[this.n] = ((m << CARD_SLOT_BITS) | (slot & SLOT_MASK)) >>> 0;
    return this.n++;
  }

  /** The list uploaded when it changed, the group made again when anything under it moved, the pipeline for the slot's light. */
  prepare(slot: SlotContext): number {
    const n = this.n;
    if (n > 0) {
      if (this.buffer.size < n * 4) {
        this.buffer.destroy();
        this.buffer = storageBuffer(this.device, this.list.byteLength, "card/list");
        this.bufferVersion += 1;
        this.sentN = -1;
      }
      let same = n === this.sentN;
      if (same) for (let i = 0; i < n; i++) if (this.list[i] !== this.sent[i]) { same = false; break; }
      if (!same) {
        this.device.queue.writeBuffer(this.buffer, 0, this.list, 0, n);
        if (this.sent.length < this.list.length) this.sent = new Uint32Array(this.list.length);
        this.sent.set(this.list.subarray(0, n));
        this.sentN = n;
      }
      this.rebind();
    }
    this.litElsewhere = !litByOwn(slot.view, slot.lit);
    return n;
  }

  private rebind(): void {
    const over = this.boundOver;
    let stale = this.group === null || over[0] !== this.mat.assetVersion || over[1] !== this.bufferVersion;
    let i = 2;
    for (const pass of this.kinds.values()) { const v = pass.cardResources?.().version ?? -1; if (over[i] !== v) stale = true; i++; }
    if (!stale) return;
    const resources: (GPUBuffer | GPUTextureView | GPUSampler)[] = [this.mat.view, this.mat.silhouette, this.mat.noiseTexture.createView(), this.buffer];
    const versions = [this.mat.assetVersion, this.bufferVersion];
    for (const [name, pass] of this.kinds) {
      const r = pass.cardResources?.();
      if (r === undefined) throw new Error(`card: kind "${name}" declares a card material but its pass hands no resources`);
      resources.push(...r.resources);
      versions.push(r.version);
    }
    this.group = bindGroup(this.device, this.shared.layout, resources, "card/flat");
    this.boundOver = versions;
  }

  /** Cards [first, end) of this frame's list — interleaved objects of every material kind — as ONE instanced draw. */
  drawRange(pass: GPURenderPassEncoder, first: number, end: number): void {
    const hi = Math.min(end, this.n);
    if (first >= hi || this.group === null) return;
    pass.setPipeline(this.litElsewhere ? this.shared.litPipeline : this.shared.pipeline);
    pass.setBindGroup(0, this.group);
    pass.draw(6, hi - first, 0, first);
  }

  /** The cards this frame. */
  get count(): number { return this.n; }

  dispose(): void { this.buffer.destroy(); }
}
