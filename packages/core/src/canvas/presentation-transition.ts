/**
 * Epoch-keyed presentation retention for cut-first nested-canvas navigation.
 *
 * Core owns only timing, identity, and exact release. DOM/GL/Ground adapters
 * synchronously capture their already-presented state in `prepare`; they never
 * receive a World and cannot delay or veto the authority cut.
 */
import type { Entity, World } from "@vibecook/strata-ecs";
import { outgoingCamera, type CameraState, type PortalAffine } from "@ice/kernel";
import { Camera } from "../catalog";
import type { Engine } from "../engine/engine";
import { FrameInfo } from "../engine/frame-info";
import { NavTransition } from "../systems/nav-flight";

export type PresentationPlane = "ground" | "dom" | "gl";
export type PresentationReleaseReason =
  | "settled"
  | "interrupted"
  | "superseded"
  | "detached"
  | "fault"
  | "timeout"
  | "cancelled";

export interface FrameSwitchDescriptor {
  readonly kind: "enter" | "exit";
  readonly documentEpoch: number;
  readonly fromFrame: Entity;
  readonly toFrame: Entity;
  readonly fromTypeId: string;
  readonly toTypeId: string;
  readonly fromCamera: CameraState;
  readonly toCamera: CameraState;
  readonly affine: PortalAffine;
  /** Geometry and caller policy permit motion; adapter completeness is evaluated later. */
  readonly requestedMotion: boolean;
  /** Cross-program motion may proceed only when every required plane prepared. */
  readonly requiresFullT2: boolean;
  readonly requiredPlanes: readonly PresentationPlane[];
}

/** Geometry/identity assembled by core navigation before policy adds plane requirements. */
export type FrameSwitchRequest = Omit<
  FrameSwitchDescriptor,
  "requiresFullT2" | "requiredPlanes"
>;

export type PresentationMotion = "flight" | "crossfade" | "fast-fade";

export interface PresentationTransitionFrame {
  readonly epoch: number;
  readonly descriptor: FrameSwitchDescriptor;
  readonly motion: PresentationMotion;
  readonly camera: CameraState;
  readonly outgoingCamera: CameraState;
  readonly progress: number;
  readonly outgoingOpacity: number;
  readonly incomingOpacity: number;
  readonly frozen: boolean;
}

export interface PresentationRetainer {
  update(frame: PresentationTransitionFrame): void;
  /** Exact and idempotent on the adapter side. */
  release(reason: PresentationReleaseReason): void;
}

export interface PresentationTransitionAdapter {
  readonly id: string;
  readonly plane: PresentationPlane;
  /** `null` means this plane has no outgoing visual but prepared successfully. */
  prepare(descriptor: FrameSwitchDescriptor): PresentationRetainer | null;
}

export interface PreparedFrameSwitch {
  readonly complete: boolean;
  readonly allowFlight: boolean;
  commit(): void;
  /**
   * Release a preparation that will not commit. `cancelled` is reserved for a
   * rollback before navigation authority changes; callers that already
   * mutated authority must pass the actual terminal reason (normally
   * `fault`).
   */
  cancel(reason?: PresentationReleaseReason): void;
}

export interface PresentationTransitionStats {
  readonly active: boolean;
  readonly epoch: number;
  readonly motion?: PresentationMotion;
  readonly retainers: number;
  readonly adapters: number;
  readonly reducedMotion: boolean;
}

export interface PresentationTransitionCoordinator {
  register(adapter: PresentationTransitionAdapter): () => void;
  prepare(descriptor: FrameSwitchDescriptor): PreparedFrameSwitch;
  abort(reason?: PresentationReleaseReason): void;
  setReducedMotion(value: boolean): void;
  reducedMotion(): boolean;
  stats(): PresentationTransitionStats;
  dispose(): void;
}

type ActiveTransition = {
  readonly epoch: number;
  readonly descriptor: FrameSwitchDescriptor;
  readonly retainers: Map<string, PresentationRetainer>;
  motion: PresentationMotion;
  readonly startedAtMs: number;
  elapsedMs: number;
  fadeElapsedMs: number;
  fadeFrom: number;
  lastOutgoingOpacity: number;
};

type PendingTransition = {
  finish(reason: PresentationReleaseReason): void;
};

const CROSSFADE_MS = 160;
const FAST_FADE_MS = 150;
const HOLD_CEILING_MS = 2_000;
/** User-code boundaries in DOM preparation must run before GPU ownership transfer. */
const PREPARE_ORDER: Readonly<Record<PresentationPlane, number>> = Object.freeze({
  dom: 0,
  gl: 1,
  ground: 2,
});

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));
const smooth = (value: number): number => {
  const x = clamp01(value);
  return x * x * (3 - 2 * x);
};
const ramp = (value: number, from: number, to: number): number =>
  to <= from ? (value >= to ? 1 : 0) : smooth((value - from) / (to - from));

function opacityAt(
  kind: "enter" | "exit",
  progress: number,
  frozen: boolean,
): { outgoing: number; incoming: number } {
  if (frozen) {
    return {
      outgoing: 1 - ramp(progress, 0.05, 0.45),
      incoming: ramp(progress, 0.3, 0.7),
    };
  }
  return {
    outgoing:
      kind === "enter" ? 1 - ramp(progress, 0.3, 0.75) : 1 - ramp(progress, 0.85, 1),
    incoming: 1,
  };
}

export function createPresentationTransitionCoordinator(
  world: World,
  engine: Engine,
  opts: { readonly onFault?: (adapterId: string, error: unknown) => void } = {},
): PresentationTransitionCoordinator {
  const adapters = new Map<string, PresentationTransitionAdapter>();
  let active: ActiveTransition | undefined;
  let pending: PendingTransition | undefined;
  let prepareSequence = 0;
  let prefersReducedMotion = false;
  let disposed = false;

  const reportFault = (id: string, error: unknown): void => {
    try {
      opts.onFault?.(id, error);
    } catch {
      // Presentation diagnostics cannot interrupt authority or exact release.
    }
  };

  const release = (reason: PresentationReleaseReason): void => {
    const current = active;
    active = undefined;
    if (current === undefined) return;
    for (const [id, retainer] of current.retainers) {
      try {
        retainer.release(reason);
      } catch (error) {
        reportFault(id, error);
      }
    }
    current.retainers.clear();
  };

  const update = (current: ActiveTransition): void => {
    const transition = world.getResource(NavTransition);
    if (transition === undefined || transition.epoch !== current.epoch) {
      release("superseded");
      return;
    }
    const frameInfo = world.getResource(FrameInfo);
    const dt = Math.max(0, frameInfo?.dt ?? 16);
    current.elapsedMs += dt;
    const wallElapsedMs = Math.max(
      current.elapsedMs,
      frameInfo === undefined ? 0 : frameInfo.now - current.startedAtMs,
    );
    if (wallElapsedMs >= HOLD_CEILING_MS) {
      release("timeout");
      return;
    }

    const cameraCell = world.getResource(Camera);
    const camera: CameraState = cameraCell ?? current.descriptor.toCamera;
    let progress = clamp01(transition.p);
    let outgoingOpacity: number;
    let incomingOpacity: number;
    let shouldRelease = false;
    let releaseReason: PresentationReleaseReason = "settled";

    if (current.motion === "crossfade") {
      current.fadeElapsedMs += dt;
      progress = clamp01(current.fadeElapsedMs / CROSSFADE_MS);
      outgoingOpacity = 1 - smooth(progress);
      incomingOpacity = smooth(progress);
      shouldRelease = progress >= 1;
    } else if (current.motion === "fast-fade") {
      current.fadeElapsedMs += dt;
      progress = clamp01(current.fadeElapsedMs / FAST_FADE_MS);
      outgoingOpacity = current.fadeFrom * (1 - smooth(progress));
      incomingOpacity = 1;
      shouldRelease = progress >= 1;
      releaseReason = "interrupted";
    } else {
      const opacity = opacityAt(current.descriptor.kind, progress, transition.frozen);
      outgoingOpacity = opacity.outgoing;
      incomingOpacity = opacity.incoming;
      if (!transition.active) {
        if (transition.p >= 1) {
          shouldRelease = true;
        } else {
          current.motion = "fast-fade";
          current.fadeElapsedMs = 0;
          current.fadeFrom = outgoingOpacity;
        }
      }
    }
    current.lastOutgoingOpacity = outgoingOpacity;
    const frame: PresentationTransitionFrame = Object.freeze({
      epoch: current.epoch,
      descriptor: current.descriptor,
      motion: current.motion,
      camera,
      outgoingCamera: outgoingCamera(current.descriptor.affine, camera),
      progress,
      outgoingOpacity,
      incomingOpacity,
      frozen: transition.frozen,
    });
    for (const [id, retainer] of [...current.retainers]) {
      try {
        retainer.update(frame);
      } catch (error) {
        current.retainers.delete(id);
        try {
          retainer.release("fault");
        } catch (releaseError) {
          reportFault(id, releaseError);
        }
        reportFault(id, error);
      }
    }
    if (shouldRelease) release(releaseReason);
  };

  const removeReflector = engine.registerReflector({
    name: "presentation-transition",
    always: true,
    flush: () => {
      if (active !== undefined) update(active);
    },
  });

  return {
    register(adapter) {
      if (disposed) throw new Error("ice: presentation transition coordinator is disposed.");
      const planeOwner = [...adapters.values()].find((candidate) => candidate.plane === adapter.plane);
      if (adapter.id.length === 0 || adapters.has(adapter.id) || planeOwner !== undefined) {
        throw new Error(
          planeOwner !== undefined
            ? `ice: presentation transition plane "${adapter.plane}" is already owned by "${planeOwner.id}".`
            : `ice: presentation transition adapter id "${adapter.id}" is empty or already registered.`,
        );
      }
      adapters.set(adapter.id, adapter);
      let live = true;
      return () => {
        if (!live) return;
        live = false;
        if (adapters.get(adapter.id) === adapter) adapters.delete(adapter.id);
        const retained = active?.retainers.get(adapter.id);
        if (retained === undefined) return;
        active?.retainers.delete(adapter.id);
        try {
          retained.release("detached");
        } catch (error) {
          reportFault(adapter.id, error);
        }
      };
    },
    prepare(descriptor) {
      const sequence = ++prepareSequence;
      const deadPrepared = (): PreparedFrameSwitch => ({
        complete: false,
        allowFlight: false,
        commit: () => {},
        cancel: () => {},
      });
      pending?.finish("superseded");
      // Adapter release can synchronously run application callbacks. If one
      // starts a newer navigation, this invocation has already lost ownership.
      if (sequence !== prepareSequence) return deadPrepared();
      release("superseded");
      if (sequence !== prepareSequence) return deadPrepared();
      const expectedEpoch = (world.getResource(NavTransition)?.epoch ?? 0) + 1;
      const retainers = new Map<string, PresentationRetainer>();
      const successfulPlanes = new Set<PresentationPlane>();
      let finished = false;
      const pendingTransition: PendingTransition = {
        finish(reason) {
          if (finished) return;
          finished = true;
          if (pending === pendingTransition) pending = undefined;
          for (const [id, retainer] of retainers) {
            try {
              retainer.release(reason);
            } catch (error) {
              reportFault(id, error);
            }
          }
          retainers.clear();
        },
      };
      pending = pendingTransition;
      if (descriptor.requestedMotion) {
        const orderedAdapters = [...adapters].sort(
          ([idA, a], [idB, b]) =>
            PREPARE_ORDER[a.plane] - PREPARE_ORDER[b.plane] || idA.localeCompare(idB),
        );
        for (const [id, adapter] of orderedAdapters) {
          try {
            const retainer = adapter.prepare(descriptor);
            if (finished || sequence !== prepareSequence) {
              if (retainer !== null) {
                try {
                  retainer.release("superseded");
                } catch (error) {
                  reportFault(id, error);
                }
              }
              break;
            }
            successfulPlanes.add(adapter.plane);
            if (retainer !== null) retainers.set(id, retainer);
          } catch (error) {
            reportFault(id, error);
            if (finished || sequence !== prepareSequence) break;
          }
        }
      }
      const ownsPreparation = !finished && sequence === prepareSequence;
      const complete =
        ownsPreparation &&
        descriptor.requiredPlanes.every((plane) => successfulPlanes.has(plane));
      const allowFlight =
        ownsPreparation &&
        descriptor.requestedMotion &&
        !prefersReducedMotion &&
        (!descriptor.requiresFullT2 || complete);
      const cancelPrepared = (reason: PresentationReleaseReason = "cancelled"): void => {
        if (finished) return;
        pendingTransition.finish(reason);
      };
      return {
        complete,
        allowFlight,
        commit() {
          if (finished) return;
          if (!descriptor.requestedMotion || retainers.size === 0) {
            cancelPrepared();
            return;
          }
          const transition = world.getResource(NavTransition);
          const identityMatches =
            transition !== undefined &&
            transition.epoch === expectedEpoch &&
            transition.documentEpoch === descriptor.documentEpoch &&
            transition.fromFrame === descriptor.fromFrame &&
            transition.toFrame === descriptor.toFrame &&
            transition.fromTypeId === descriptor.fromTypeId &&
            transition.toTypeId === descriptor.toTypeId;
          if (!identityMatches) {
            pendingTransition.finish("superseded");
            return;
          }
          finished = true;
          if (pending === pendingTransition) pending = undefined;
          active = {
            epoch: transition.epoch,
            descriptor,
            retainers,
            motion: allowFlight ? "flight" : "crossfade",
            startedAtMs: world.getResource(FrameInfo)?.now ?? 0,
            elapsedMs: 0,
            fadeElapsedMs: 0,
            fadeFrom: 1,
            lastOutgoingOpacity: 1,
          };
          update(active);
        },
        cancel: cancelPrepared,
      };
    },
    abort(reason = "interrupted") {
      pending?.finish(reason);
      release(reason);
    },
    setReducedMotion(value) {
      prefersReducedMotion = value;
    },
    reducedMotion: () => prefersReducedMotion,
    stats: () =>
      Object.freeze({
        active: active !== undefined,
        epoch: active?.epoch ?? 0,
        ...(active === undefined ? {} : { motion: active.motion }),
        retainers: active?.retainers.size ?? 0,
        adapters: adapters.size,
        reducedMotion: prefersReducedMotion,
      }),
    dispose() {
      if (disposed) return;
      disposed = true;
      pending?.finish("detached");
      release("detached");
      adapters.clear();
      removeReflector();
    },
  };
}
