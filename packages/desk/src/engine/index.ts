// The lean engine. Five files, no dependencies, no scene graph: what a pass
// needs to exist and nothing a pass does not use. (`surface()` — the swap chain, the one
// call that names a canvas — is `@ice/desk/host`'s since D2a-world; its `Surface` type stays here.)
export { defineStruct, type StructDef, type StructBuffer, type FieldType, type StructValues } from "./struct";
export { compose, compile, type ComposedShader, type ShaderPart } from "./shader";
export { acquire, adopt, type Gpu, type GpuOptions, type Surface } from "./device";
export {
  bindLayout, bindGroup, renderPipeline, uniformBuffer, storageBuffer, BLEND_OVER,
  type BindEntry, type RenderPipelineOptions,
} from "./pipeline";
export { Target, beginPass, readback, type Clear, type TargetOptions } from "./target";
