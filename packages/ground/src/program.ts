/** Public, renderer-package-local contract for lazy CanvasType backgrounds. */
import type { Component, Entity, GridConfig, Resource } from "@ice/core";
import type { AABB } from "@ice/kernel";
import type { Object3D } from "three/webgpu";
import type { GroundFrame } from "./pass";
import type { Pole, PoleSource } from "./poles";
import type { GroundRendererStatus } from "./renderer";

export type GroundProgramTransition = "procedural" | "freezable" | "snapshot";

export const GROUND_FRAME_CHILDREN_DEFAULT_LIMIT = 256;
export const GROUND_FRAME_CHILDREN_MAX_LIMIT = 1024;

export interface GroundFrameChildrenSource {
  readonly kind: "frame-children";
  /** Values in each row use this exact component order. */
  readonly components: readonly Component[];
  readonly limit?: number;
}

/** Reviewed source vocabulary. No declaration can smuggle in a raw World. */
export type GroundSourceDeclaration =
  | { readonly kind: "resource"; readonly resource: Resource }
  | { readonly kind: "active-spatial" }
  | { readonly kind: "poles"; readonly source: PoleSource }
  | GroundFrameChildrenSource;

export interface GroundFrameChildRow {
  /** Runtime identity for deterministic tie-breaking only; never a mutation handle. */
  readonly entity: Entity;
  readonly widgetType: string;
  /** Immutable component records, index-aligned with the declaration. */
  readonly values: readonly unknown[];
}

export interface GroundFrameChildrenSnapshot {
  readonly documentEpoch: number;
  readonly canvasEpoch: number;
  readonly frame: Entity;
  readonly total: number;
  readonly truncated: boolean;
  readonly rows: readonly GroundFrameChildRow[];
}

export interface GroundProgramInput {
  resource<S>(resource: Resource<S>): S | undefined;
  spatial(bounds: AABB): ReadonlyArray<AABB & { readonly id: number }>;
  poles(source: PoleSource): readonly Pole[];
  children(source: GroundFrameChildrenSource): GroundFrameChildrenSnapshot;
}

/** Definition helper whose object identity is the read-capability token. */
export function frameChildrenSource(
  components: readonly Component[],
  limit = GROUND_FRAME_CHILDREN_DEFAULT_LIMIT,
): GroundFrameChildrenSource {
  return Object.freeze({
    kind: "frame-children" as const,
    components: Object.freeze([...components]),
    limit,
  });
}

export interface GroundPresentation {
  readonly opacity: number;
}

export interface GroundActivationContext {
  readonly input: GroundProgramInput;
}

export interface FrozenGroundPresentation {
  readonly object: Object3D;
  collect(frame: GroundFrame, presentation: GroundPresentation): void;
  /** Exact, idempotent release for transferred/sealed state. */
  release(): void;
}

export interface GroundProgramInstance {
  readonly object: Object3D;
  /** External non-ECS wakes may be attached here; ECS sources are host-owned. */
  activate(
    context: GroundActivationContext,
    wake: () => void,
  ): readonly (() => void)[];
  collect(
    input: GroundProgramInput,
    frame: GroundFrame,
    presentation: GroundPresentation,
  ): void;
  freeze?(): FrozenGroundPresentation;
  deactivate(): void;
  estimateBytes?(): number;
  dispose(): void;
}

export interface GroundPrepareContext {
  /** Preparation is best-effort and may be cancelled by disposal. */
  readonly signal: AbortSignal;
}

export interface GroundProgramDefinition {
  readonly id: string;
  readonly transition: GroundProgramTransition;
  readonly sources?: readonly GroundSourceDeclaration[];
  create(): GroundProgramInstance;
  load?(): Promise<void>;
  prepare?(context: GroundPrepareContext): Promise<void>;
  /** Compatibility channel used by built-in grid programs only. */
  configureGrid?(config: Partial<GridConfig>): void;
}

export type GroundProgramStatusState = "cold" | "loading" | "ready" | "failed";

export interface GroundProgramStatus {
  readonly id: string;
  readonly state: GroundProgramStatusState;
  readonly message?: string;
}

export interface GroundProgramCacheOptions {
  readonly inactiveCount?: number;
  readonly bytes?: number;
}

export interface GroundHostStats {
  readonly activeProgram: string;
  readonly instantiatedPrograms: number;
  readonly inactivePrograms: number;
  readonly sourceObservers: number;
  readonly redraws: number;
  readonly renderer: GroundRendererStatus;
}
