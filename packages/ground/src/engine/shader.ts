// WebGPU has no #include. A shader here is COMPOSED: generated struct text
// first, then pure WGSL modules (functions only — no bindings), then the entry
// that declares its bindings and entry points. Compile errors are mapped back
// to the module and line they came from. (Lineage: research/sdf-card/src/gpu/shader.js.)
//
// Purity of modules is the one rule: a module may not declare `@group` /
// `@binding` resources. Helpers take the uniform block and textures as
// PARAMETERS, so the same module text serves every entry that imports it and
// the entry alone decides the binding layout.

import type { StructDef } from "./struct.ts";

export interface ShaderPart {
  readonly label: string;
  readonly text: string;
}

export interface ComposeOptions {
  /** Structs whose WGSL text is prepended, in order. */
  readonly structs?: ReadonlyArray<StructDef<string>>;
  /** Pure modules, in dependency order. */
  readonly modules?: ReadonlyArray<ShaderPart>;
  /** The entry: bindings + @vertex/@fragment/@compute. */
  readonly entry: ShaderPart;
}

export interface ComposedShader {
  readonly code: string;
  readonly label: string;
  /** Map a line of the composed code back to `<part>:<line>`. */
  locate(line: number): string;
}

const BINDING_IN_MODULE = /@(group|binding)\s*\(/;

export function compose(opts: ComposeOptions): ComposedShader {
  const parts: ShaderPart[] = [];
  for (const s of opts.structs ?? []) parts.push({ label: `struct ${s.name}`, text: s.wgsl });
  for (const m of opts.modules ?? []) {
    if (BINDING_IN_MODULE.test(m.text)) {
      throw new Error(`shader module "${m.label}" declares a binding; modules must be pure — declare it in the entry`);
    }
    parts.push(m);
  }
  parts.push(opts.entry);

  const starts: Array<{ label: string; line: number }> = [];
  let code = "";
  let line = 1;
  for (const p of parts) {
    starts.push({ label: p.label, line });
    code += `// ---- ${p.label}\n${p.text}\n`;
    line += p.text.split("\n").length + 1;
  }
  return {
    code,
    label: opts.entry.label,
    locate(n) {
      let s = starts[0];
      if (!s) return `?:${n}`;
      for (const c of starts) if (c.line <= n) s = c;
      return `${s.label}:${n - s.line}`;
    },
  };
}

/** Create the module and surface compilation errors with mapped locations. */
export async function compile(device: GPUDevice, shader: ComposedShader): Promise<GPUShaderModule> {
  const module = device.createShaderModule({ code: shader.code, label: shader.label });
  const info = await module.getCompilationInfo();
  const errors = info.messages.filter((m) => m.type === "error");
  if (errors.length) {
    const lines = shader.code.split("\n");
    throw new Error(
      `WGSL ${shader.label}:\n${errors
          .map((e) => `  ${shader.locate(e.lineNum)}:${e.linePos}  ${e.message}\n    > ${(lines[e.lineNum - 1] ?? "").trim()}`)
          .join("\n")}`,
    );
  }
  return module;
}
