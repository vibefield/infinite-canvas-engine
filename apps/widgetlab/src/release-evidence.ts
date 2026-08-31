import {
  Camera,
  PrefabId,
  defineQuery,
  type CanvasEngine,
  type Entity,
} from "@ice/core";
import type { CanvasHost } from "@ice/dom";
import type {
  GroundHostStats,
  GroundRendererProfile,
  GroundRendererStatus,
} from "@ice/ground";
import type { GLBridge, GlFrameStats } from "@ice/r3f";

export interface ReleaseEvidenceConfig {
  readonly enabled: boolean;
  readonly groundVariant: "legacy" | "typed";
  readonly requestedBackend: "auto" | "webgl2";
}

export interface EvidenceGroundLayer {
  readonly reflector: {
    available(): boolean;
    redraws(): number;
    rendererStatus(): GroundRendererStatus;
    rendererProfile(): GroundRendererProfile;
  };
  readonly programs?: {
    stats(): GroundHostStats;
  };
}

interface Distribution {
  readonly count: number;
  readonly min: number;
  readonly mean: number;
  readonly p50: number;
  readonly p95: number;
  readonly max: number;
}

interface EvidenceMetadata {
  readonly recordedAt: string;
  readonly groundVariant: ReleaseEvidenceConfig["groundVariant"];
  readonly requestedBackend: ReleaseEvidenceConfig["requestedBackend"];
  readonly actualBackend: GroundRendererStatus["backend"] | "missing";
  readonly userAgent: string;
  readonly viewport: { readonly width: number; readonly height: number; readonly dpr: number };
  readonly hardwareConcurrency?: number;
}

interface EvidenceSnapshot {
  readonly metadata: EvidenceMetadata;
  readonly navDepth: number;
  readonly transition: ReturnType<CanvasEngine["transitions"]["stats"]>;
  readonly gpu: ReturnType<CanvasEngine["gpu"]["stats"]>;
  readonly ground?: {
    readonly available: boolean;
    readonly redraws: number;
    readonly renderer: GroundRendererStatus;
    readonly profile: {
      readonly enabled: boolean;
      readonly timestampSupported?: boolean;
      readonly samples: number;
      readonly gpuSamples: number;
    };
    readonly programs?: GroundHostStats;
  };
  readonly mountEntries: number;
  readonly frozenMounts: number;
  readonly domHosts: number;
  readonly departingDomPlanes: number;
  readonly glIslands: number;
  readonly departingGlGroups: number;
  readonly gl?: GlFrameStats;
  readonly usedJsHeapBytes?: number;
}

interface PhaseEvidence {
  readonly frames: number;
  readonly groundRedrawDelta: number;
  readonly engineMicros: Distribution;
  readonly reflectMicros: Distribution;
  readonly groundMicros: Distribution;
  readonly groundRenderCpuMs: Distribution;
  readonly groundGpuMs: Distribution;
  readonly groundDrawCalls: Distribution;
  readonly rafIntervalMs: Distribution;
  /** Intervals above 1.5× this phase's median display interval. */
  readonly missedFrameRatio: number;
  readonly glCpuMs: Distribution;
  readonly glGpuMs: Distribution;
  readonly raw: {
    readonly engineMicros: readonly number[];
    readonly reflectMicros: readonly number[];
    readonly groundMicros: readonly number[];
    readonly groundRenderCpuMs: readonly number[];
    readonly groundGpuMs: readonly number[];
    readonly groundDrawCalls: readonly number[];
    readonly rafIntervalMs: readonly number[];
    readonly glCpuMs: readonly number[];
    readonly glGpuMs: readonly number[];
  };
}

export interface PerformanceEvidence {
  readonly kind: "performance";
  readonly schema: 1;
  readonly metadata: EvidenceMetadata;
  readonly warmupFrames: number;
  readonly idle: PhaseEvidence;
  readonly cameraMotion: PhaseEvidence;
  readonly final: EvidenceSnapshot;
}

export interface RapidNavigationEvidence {
  readonly kind: "rapid-navigation";
  readonly schema: 1;
  readonly cycles: number;
  readonly warmupCycles: number;
  readonly before: EvidenceSnapshot;
  readonly after: EvidenceSnapshot;
  readonly deltas: {
    readonly sourceObservers: number;
    readonly mountEntries: number;
    readonly domHosts: number;
    readonly glIslands: number;
    readonly allocatorBytes: number;
    readonly glFboBytes: number;
    readonly usedJsHeapBytes?: number;
  };
  readonly pass: boolean;
  readonly failures: readonly string[];
}

export interface DeviceLossEvidence {
  readonly kind: "device-loss";
  readonly schema: 1;
  readonly triggered: boolean;
  readonly pass: boolean;
  readonly message: string;
  readonly after: EvidenceSnapshot;
}

export interface ReleaseEvidenceHarness {
  readonly config: ReleaseEvidenceConfig;
  snapshot(): EvidenceSnapshot;
  measurePerformance(opts?: { readonly frames?: number; readonly warmupFrames?: number }): Promise<PerformanceEvidence>;
  runRapidNavigation(opts?: { readonly cycles?: number; readonly warmupCycles?: number }): Promise<RapidNavigationEvidence>;
  /** Destructive for this mount: GroundHost intentionally stays unavailable after loss. */
  triggerWebglContextLoss(): Promise<DeviceLossEvidence>;
  /** Wait while a human/device tool induces a WebGPU or WebGL context loss. */
  awaitDeviceLoss(timeoutMs?: number): Promise<DeviceLossEvidence>;
  recordGlFrame(stats: GlFrameStats): void;
  save(value: PerformanceEvidence | RapidNavigationEvidence | DeviceLossEvidence): string;
  stored(): readonly unknown[];
  dispose(): void;
}

const containerQ = defineQuery([PrefabId]);
const STORAGE_PREFIX = "ice:t2-release-evidence:";

export function readReleaseEvidenceConfig(): ReleaseEvidenceConfig {
  if (typeof window === "undefined") {
    return { enabled: false, groundVariant: "typed", requestedBackend: "auto" };
  }
  const params = new URLSearchParams(window.location.search);
  return Object.freeze({
    enabled: params.get("evidence") === "1",
    groundVariant: params.get("ground") === "legacy" ? "legacy" : "typed",
    requestedBackend: params.get("groundBackend") === "webgl2" ? "webgl2" : "auto",
  });
}

function distribution(values: readonly number[]): Distribution {
  if (values.length === 0) return { count: 0, min: 0, mean: 0, p50: 0, p95: 0, max: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const at = (fraction: number): number =>
    sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))] ?? 0;
  return Object.freeze({
    count: sorted.length,
    min: sorted[0] ?? 0,
    mean: sorted.reduce((sum, value) => sum + value, 0) / sorted.length,
    p50: at(0.5),
    p95: at(0.95),
    max: sorted.at(-1) ?? 0,
  });
}

function nextFrame(): Promise<number> {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

function heapBytes(): number | undefined {
  const memory = (performance as Performance & {
    readonly memory?: { readonly usedJSHeapSize?: number };
  }).memory;
  const bytes = memory?.usedJSHeapSize;
  return typeof bytes === "number" && Number.isFinite(bytes) ? bytes : undefined;
}

export function installReleaseEvidence(opts: {
  readonly engine: CanvasEngine;
  readonly host: CanvasHost;
  readonly config: ReleaseEvidenceConfig;
  readonly getGround: () => EvidenceGroundLayer | null;
  readonly getBridge: () => GLBridge | null;
}): ReleaseEvidenceHarness {
  const { engine, host, config } = opts;
  const glFrames: GlFrameStats[] = [];
  engine.engine.enableTelemetry();

  const metadata = (): EvidenceMetadata => {
    const ground = opts.getGround();
    const renderer = ground?.reflector.rendererStatus();
    return Object.freeze({
      recordedAt: new Date().toISOString(),
      groundVariant: config.groundVariant,
      requestedBackend: config.requestedBackend,
      actualBackend: renderer?.backend ?? "missing",
      userAgent: navigator.userAgent,
      viewport: Object.freeze({
        width: window.innerWidth,
        height: window.innerHeight,
        dpr: window.devicePixelRatio,
      }),
      ...(navigator.hardwareConcurrency > 0
        ? { hardwareConcurrency: navigator.hardwareConcurrency }
        : {}),
    });
  };

  const snapshot = (): EvidenceSnapshot => {
    const ground = opts.getGround();
    const bridge = opts.getBridge();
    const mounts = engine.runtime.store.getSnapshot();
    const gl = glFrames.at(-1);
    const heap = heapBytes();
    return Object.freeze({
      metadata: metadata(),
      navDepth: engine.nav.depth(),
      transition: engine.transitions.stats(),
      gpu: engine.gpu.stats(),
      ...(ground === null
        ? {}
        : {
            ground: Object.freeze({
              available: ground.reflector.available(),
              redraws: ground.reflector.redraws(),
              renderer: ground.reflector.rendererStatus(),
              profile: (() => {
                const profile = ground.reflector.rendererProfile();
                return Object.freeze({
                  enabled: profile.enabled,
                  ...(profile.timestampSupported !== undefined
                    ? { timestampSupported: profile.timestampSupported }
                    : {}),
                  samples: profile.samples.length,
                  gpuSamples: profile.samples.filter((sample) => sample.gpuMs !== undefined).length,
                });
              })(),
              ...(ground.programs !== undefined ? { programs: ground.programs.stats() } : {}),
            }),
          }),
      mountEntries: mounts.length,
      frozenMounts: mounts.filter((entry) => entry.frozen === true).length,
      domHosts: host.container.querySelectorAll("[data-ice-entity]").length,
      departingDomPlanes: host.container.querySelectorAll("[data-ice-departing-dom]").length,
      glIslands: bridge === null ? 0 : [...bridge.islands()].length,
      departingGlGroups: gl?.retainedQuads ?? 0,
      ...(gl !== undefined ? { gl } : {}),
      ...(heap !== undefined ? { usedJsHeapBytes: heap } : {}),
    });
  };

  const samplePhase = async (frames: number, moveCamera: boolean): Promise<PhaseEvidence> => {
    const engineMicros: number[] = [];
    const reflectMicros: number[] = [];
    const groundMicros: number[] = [];
    const rafIntervalMs: number[] = [];
    const glStart = glFrames.length;
    const profileStart = opts.getGround()?.reflector.rendererProfile().samples.at(-1)?.sequence ?? 0;
    const startRedraws = opts.getGround()?.reflector.redraws() ?? 0;
    const original = engine.world.getResource(Camera);
    let priorRaf: number | undefined;
    for (let i = 0; i < frames; i += 1) {
      if (moveCamera && original !== undefined) {
        engine.ops.panTo(original.x + (i % 2 === 0 ? 0.5 : -0.5), original.y);
      }
      const raf = await nextFrame();
      if (priorRaf !== undefined) rafIntervalMs.push(raf - priorRaf);
      priorRaf = raf;
      const telemetry = engine.engine.lastFrame();
      if (telemetry !== undefined) {
        engineMicros.push(telemetry.totalMicros);
        reflectMicros.push(telemetry.reflectMicros);
        groundMicros.push(
          (telemetry.reflectorMicros.get("ground") ?? 0) +
            (telemetry.reflectorMicros.get("ground-host") ?? 0),
        );
      }
    }
    const endRedraws = opts.getGround()?.reflector.redraws() ?? startRedraws;
    // Timestamp query resolution is asynchronous. Give the already-submitted
    // queries one task window before taking the immutable sample snapshot.
    await new Promise((resolve) => window.setTimeout(resolve, 25));
    const groundFrames = (opts.getGround()?.reflector.rendererProfile().samples ?? [])
      .filter((sample) => sample.sequence > profileStart);
    if (moveCamera && original !== undefined) {
      engine.ops.panTo(original.x, original.y);
      await nextFrame();
    }
    const phaseGl = glFrames.slice(glStart);
    const glCpuMs = phaseGl.map((value) => value.cpuMs);
    const glGpuMs = phaseGl.map((value) => value.gpuMs).filter((value) => value > 0);
    const groundRenderCpuMs = groundFrames.map((value) => value.cpuMs);
    const groundGpuMs = groundFrames
      .map((value) => value.gpuMs)
      .filter((value): value is number => value !== undefined && value >= 0);
    const groundDrawCalls = groundFrames.map((value) => value.drawCalls);
    const rafSummary = distribution(rafIntervalMs);
    const missedFrameRatio = rafIntervalMs.length === 0 || rafSummary.p50 <= 0
      ? 0
      : rafIntervalMs.filter((value) => value > rafSummary.p50 * 1.5).length / rafIntervalMs.length;
    return Object.freeze({
      frames,
      groundRedrawDelta: endRedraws - startRedraws,
      engineMicros: distribution(engineMicros),
      reflectMicros: distribution(reflectMicros),
      groundMicros: distribution(groundMicros),
      groundRenderCpuMs: distribution(groundRenderCpuMs),
      groundGpuMs: distribution(groundGpuMs),
      groundDrawCalls: distribution(groundDrawCalls),
      rafIntervalMs: rafSummary,
      missedFrameRatio,
      glCpuMs: distribution(glCpuMs),
      glGpuMs: distribution(glGpuMs),
      raw: Object.freeze({
        engineMicros: Object.freeze(engineMicros),
        reflectMicros: Object.freeze(reflectMicros),
        groundMicros: Object.freeze(groundMicros),
        groundRenderCpuMs: Object.freeze(groundRenderCpuMs),
        groundGpuMs: Object.freeze(groundGpuMs),
        groundDrawCalls: Object.freeze(groundDrawCalls),
        rafIntervalMs: Object.freeze(rafIntervalMs),
        glCpuMs: Object.freeze(glCpuMs),
        glGpuMs: Object.freeze(glGpuMs),
      }),
    });
  };

  const findContainer = (): Entity => {
    let result: Entity | undefined;
    engine.world.query(containerQ).each((batch) => {
      for (const row of batch) {
        const entity = batch.entity(row);
        if (engine.world.read(entity, PrefabId).id !== "card-container") continue;
        if (result === undefined || entity < result) result = entity;
      }
    });
    if (result === undefined) throw new Error("ice evidence: no card-container exists in the demo document.");
    return result;
  };

  const returnToRoot = async (): Promise<void> => {
    if (engine.nav.depth() > 0) engine.ops.exitTo(0, { transition: "none" });
    engine.transitions.abort("interrupted");
    await nextFrame();
    await nextFrame();
  };

  let disposed = false;
  const harness: ReleaseEvidenceHarness = {
    config,
    snapshot,
    async measurePerformance(measureOpts = {}) {
      const frames = Math.min(1_800, Math.max(10, Math.floor(measureOpts.frames ?? 180)));
      const warmupFrames = Math.max(0, Math.floor(measureOpts.warmupFrames ?? 30));
      await returnToRoot();
      if (warmupFrames > 0) {
        await samplePhase(warmupFrames, false);
        await samplePhase(warmupFrames, true);
      }
      const idle = await samplePhase(frames, false);
      const cameraMotion = await samplePhase(frames, true);
      return Object.freeze({
        kind: "performance" as const,
        schema: 1 as const,
        metadata: metadata(),
        warmupFrames,
        idle,
        cameraMotion,
        final: snapshot(),
      });
    },
    async runRapidNavigation(runOpts = {}) {
      const cycles = Math.max(2, Math.floor(runOpts.cycles ?? 100));
      const warmupCycles = Math.max(0, Math.floor(runOpts.warmupCycles ?? 10));
      await returnToRoot();
      const container = findContainer();
      const runCycles = async (count: number, interrupt: boolean): Promise<void> => {
        for (let i = 0; i < count; i += 1) {
          if (engine.nav.depth() === 0) engine.ops.enterContainer(container);
          else engine.ops.exitContainer();
          if (interrupt && i % 5 === 4) engine.transitions.abort("interrupted");
          await nextFrame();
        }
        await returnToRoot();
      };
      await runCycles(warmupCycles, true);
      const before = snapshot();
      await runCycles(cycles, true);
      const after = snapshot();
      const beforeObservers = before.ground?.programs?.sourceObservers ?? 0;
      const afterObservers = after.ground?.programs?.sourceObservers ?? 0;
      const beforeFbo = before.gl?.fboBytes ?? 0;
      const afterFbo = after.gl?.fboBytes ?? 0;
      const beforeHeap = before.usedJsHeapBytes;
      const afterHeap = after.usedJsHeapBytes;
      const deltas = Object.freeze({
        sourceObservers: afterObservers - beforeObservers,
        mountEntries: after.mountEntries - before.mountEntries,
        domHosts: after.domHosts - before.domHosts,
        glIslands: after.glIslands - before.glIslands,
        allocatorBytes: after.gpu.allocatorBytes - before.gpu.allocatorBytes,
        glFboBytes: afterFbo - beforeFbo,
        ...(beforeHeap !== undefined && afterHeap !== undefined
          ? { usedJsHeapBytes: afterHeap - beforeHeap }
          : {}),
      });
      const failures: string[] = [];
      if (after.transition.active || after.transition.retainers !== 0) failures.push("transition retainers remain");
      if (after.gpu.reservations !== 0 || after.gpu.reservedBytes !== 0) failures.push("GPU snapshot reservation remains");
      if (after.frozenMounts !== 0) failures.push("mount holds remain frozen");
      if (after.departingDomPlanes !== 0) failures.push("departing DOM plane remains");
      if (after.departingGlGroups !== 0) failures.push("departing GL group remains");
      if (deltas.sourceObservers !== 0) failures.push("ground source-observer count changed after warmup");
      if (deltas.mountEntries !== 0) failures.push("mount-entry count changed after warmup");
      if (deltas.domHosts !== 0) failures.push("DOM-host count changed after warmup");
      if (deltas.glIslands !== 0) failures.push("GL-island count changed after warmup");
      if (deltas.allocatorBytes !== 0) failures.push("GPU allocator bytes changed after warmup");
      if (deltas.glFboBytes !== 0) failures.push("GL FBO bytes changed after warmup");
      return Object.freeze({
        kind: "rapid-navigation" as const,
        schema: 1 as const,
        cycles,
        warmupCycles,
        before,
        after,
        deltas,
        pass: failures.length === 0,
        failures: Object.freeze(failures),
      });
    },
    async triggerWebglContextLoss() {
      const ground = opts.getGround();
      if (ground?.reflector.rendererStatus().backend !== "webgl2") {
        return Object.freeze({
          kind: "device-loss" as const,
          schema: 1 as const,
          triggered: false,
          pass: false,
          message: "Open with ?evidence=1&groundBackend=webgl2 before invoking this destructive probe.",
          after: snapshot(),
        });
      }
      const canvas = Array.from(host.container.children).find(
        (child): child is HTMLCanvasElement => child instanceof HTMLCanvasElement,
      );
      const gl = canvas?.getContext("webgl2");
      const extension = gl?.getExtension("WEBGL_lose_context");
      if (extension === null || extension === undefined) {
        return Object.freeze({
          kind: "device-loss" as const,
          schema: 1 as const,
          triggered: false,
          pass: false,
          message: "WEBGL_lose_context is unavailable on the ground canvas.",
          after: snapshot(),
        });
      }
      extension.loseContext();
      return harness.awaitDeviceLoss(5_000);
    },
    async awaitDeviceLoss(timeoutMs = 30_000) {
      const deadline = performance.now() + Math.max(0, timeoutMs);
      while (performance.now() <= deadline) {
        const status = opts.getGround()?.reflector.rendererStatus();
        if (status?.failure?.kind === "device-lost") {
          const after = snapshot();
          return Object.freeze({
            kind: "device-loss" as const,
            schema: 1 as const,
            triggered: true,
            pass: after.ground?.available === false && status.failed && !status.ready,
            message: `${status.failure.api ?? status.backend} loss reached the whole-ground unavailable posture.`,
            after,
          });
        }
        await new Promise((resolve) => window.setTimeout(resolve, 50));
      }
      return Object.freeze({
        kind: "device-loss" as const,
        schema: 1 as const,
        triggered: false,
        pass: false,
        message: `No device/context loss was observed within ${timeoutMs} ms.`,
        after: snapshot(),
      });
    },
    recordGlFrame(stats) {
      glFrames.push(stats);
      if (glFrames.length > 2_000) glFrames.splice(0, glFrames.length - 2_000);
    },
    save(value) {
      const key = `${STORAGE_PREFIX}${Date.now()}:${value.kind}:${config.groundVariant}`;
      localStorage.setItem(key, JSON.stringify(value));
      return key;
    },
    stored() {
      const values: unknown[] = [];
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (key === null || !key.startsWith(STORAGE_PREFIX)) continue;
        const raw = localStorage.getItem(key);
        if (raw === null) continue;
        try {
          values.push(JSON.parse(raw));
        } catch {
          // Ignore manually corrupted evidence rows; the key remains inspectable.
        }
      }
      return Object.freeze(values);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      const evidenceWindow = window as Window & { __iceReleaseEvidence?: ReleaseEvidenceHarness };
      if (evidenceWindow.__iceReleaseEvidence === harness) {
        Reflect.deleteProperty(evidenceWindow, "__iceReleaseEvidence");
      }
      glFrames.length = 0;
    },
  };

  const evidenceWindow = window as Window & { __iceReleaseEvidence?: ReleaseEvidenceHarness };
  evidenceWindow.__iceReleaseEvidence?.dispose();
  evidenceWindow.__iceReleaseEvidence = harness;
  return harness;
}
