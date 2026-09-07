// ONE declaration of a GPU struct, in TypeScript. It yields the WGSL `struct`
// text the shader is compiled against, the byte layout the CPU packs to, and a
// packer that writes by field name. Because the shader's struct is generated
// from this same list in this same order, a layout mismatch is not possible —
// and a typo in a field name fails WGSL compilation, loudly, at startup, rather
// than silently reading garbage. (Lineage: research/sdf-card/src/gpu/uniforms.js.)
//
// Layout follows the WGSL host-shareable rules for the types we use:
//   f32 / i32 / u32   align 4   size 4
//   vec2f             align 8   size 8
//   vec3f             align 16  size 12   (a following scalar packs into its tail)
//   vec4f             align 16  size 16
//   mat4x4f           align 16  size 64   (four vec4f columns)
// A struct's size is rounded up to 16 so it is a legal uniform member AND a
// legal storage-array element with the same stride in both address spaces.

/** The scalar and vector types, and a fixed array of vec4f (`array<vec4f, N>`: stride 16, legal in a uniform block) — the portal chain's. */
export type FieldType = "f32" | "i32" | "u32" | "vec2f" | "vec3f" | "vec4f" | "mat4x4f" | `array<vec4f, ${number}>`;

interface TypeInfo { readonly align: number; readonly size: number; readonly n: number; readonly scalar: "f" | "i" | "u" }
const TYPES: Record<Exclude<FieldType, `array<vec4f, ${number}>`>, TypeInfo> = {
  f32: { align: 4, size: 4, n: 1, scalar: "f" },
  i32: { align: 4, size: 4, n: 1, scalar: "i" },
  u32: { align: 4, size: 4, n: 1, scalar: "u" },
  vec2f: { align: 8, size: 8, n: 2, scalar: "f" },
  vec3f: { align: 16, size: 12, n: 3, scalar: "f" },
  vec4f: { align: 16, size: 16, n: 4, scalar: "f" },
  // 4 columns of vec4f, column-major — what a projector matrix is uploaded as.
  mat4x4f: { align: 16, size: 64, n: 16, scalar: "f" },
};

/** A field type's layout: the table's, or a vec4f array's — N × 16 bytes, 4N floats, written as one flat list. */
export function typeInfo(type: FieldType): TypeInfo | undefined {
  if (type in TYPES) return TYPES[type as keyof typeof TYPES];
  const m = /^array<vec4f, (\d+)>$/.exec(type);
  const n = m ? Number(m[1]) : 0;
  return n > 0 ? { align: 16, size: 16 * n, n: 4 * n, scalar: "f" } : undefined;
}

export interface FieldSlot {
  readonly byte: number;
  readonly type: FieldType;
  readonly n: number;
}

export type FieldValue = number | boolean | ArrayLike<number>;
export type StructValues<F extends string> = Partial<Record<F, FieldValue>>;

export interface StructDef<F extends string> {
  readonly name: string;
  readonly fields: ReadonlyArray<readonly [F, FieldType]>;
  /** Padded size in bytes; also the array stride. */
  readonly size: number;
  readonly slots: Readonly<Record<F, FieldSlot>>;
  /** `struct <name> { ... }` — prepend to any shader that binds this. */
  readonly wgsl: string;
  /** Backing storage for `count` elements. */
  alloc(count?: number): StructBuffer<F>;
}

export interface StructBuffer<F extends string> {
  readonly def: StructDef<F>;
  readonly count: number;
  readonly bytes: ArrayBuffer;
  /** Write fields by name into element `index`. Unknown names and wrong arity throw. */
  set(values: StructValues<F>, index?: number): void;
  /** The byte view to upload; `elements` trims to a prefix of the array. */
  view(elements?: number): Uint8Array<ArrayBuffer>;
}

export function defineStruct<F extends string>(
  name: string,
  fields: ReadonlyArray<readonly [F, FieldType]>,
): StructDef<F> {
  let offset = 0;
  let maxAlign = 4;
  const slots = {} as Record<F, FieldSlot>;
  const seen = new Set<string>();
  for (const [field, type] of fields) {
    if (seen.has(field)) throw new Error(`struct ${name}: duplicate field "${field}"`);
    seen.add(field);
    const t = typeInfo(type);
    if (!t) throw new Error(`struct ${name}: unknown type ${String(type)} for "${field}"`);
    offset = Math.ceil(offset / t.align) * t.align;
    slots[field] = { byte: offset, type, n: t.n };
    offset += t.size;
    maxAlign = Math.max(maxAlign, t.align);
  }
  const size = Math.ceil(offset / 16) * 16;
  const width = Math.max(...fields.map(([f]) => f.length), 1);
  const wgsl =
    `struct ${name} {\n${fields.map(([f, t]) => `  ${f.padEnd(width)} : ${t},`).join("\n")}\n}\n`;

  const def: StructDef<F> = {
    name, fields, size, slots, wgsl,
    alloc(count = 1) {
      const bytes = new ArrayBuffer(size * count);
      const f = new Float32Array(bytes);
      const i = new Int32Array(bytes);
      const u = new Uint32Array(bytes);
      return {
        def, count, bytes,
        set(values, index = 0) {
          if (index < 0 || index >= count) throw new Error(`struct ${name}: element ${index} outside 0..${count - 1}`);
          const base = (index * size) / 4;
          for (const key in values) {
            const slot = slots[key as F];
            if (!slot) throw new Error(`struct ${name}: no field "${key}"`);
            const v = values[key as F] as FieldValue;
            const at = base + slot.byte / 4;
            if (slot.n === 1) {
              const num = typeof v === "boolean" ? (v ? 1 : 0) : (v as number);
              if (typeof num !== "number") throw new Error(`struct ${name}: "${key}" wants a number`);
              const s = (typeInfo(slot.type) as TypeInfo).scalar;
              if (s === "f") f[at] = num; else if (s === "i") i[at] = num | 0; else u[at] = num >>> 0;
            } else {
              const arr = v as ArrayLike<number>;
              if (!arr || typeof arr.length !== "number" || arr.length !== slot.n) {
                throw new Error(`struct ${name}: "${key}" wants ${slot.n} components`);
              }
              for (let k = 0; k < slot.n; k++) f[at + k] = arr[k] as number;
            }
          }
        },
        view(elements = count) {
          return new Uint8Array(bytes, 0, Math.min(elements, count) * size);
        },
      };
    },
  };
  return def;
}
