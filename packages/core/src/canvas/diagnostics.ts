/** Deterministic, non-mutating diagnostics for remote/legacy frame violations. */
import { defineQuery, type Entity, type World } from "@vibecook/strata-ecs";
import type { DurableStore } from "@vibecook/strata-ecs/durable";
import { BoardRoot, ChildOf } from "../catalog/scene";
import type { DocVersionReport } from "../doc/version-gate";
import { PrefabId } from "../schema/prefab";
import type { EngineCatalog } from "./engine-catalog";

const durableQ = defineQuery([PrefabId]);

export type CanvasDiagnosticCode =
  | "content-without-requirement"
  | "unknown-widget"
  | "malformed-parent"
  | "child-of-cycle"
  | "depth-limit"
  | "incompatible-placement";

export interface CanvasDiagnostic {
  readonly code: CanvasDiagnosticCode;
  readonly key: string;
  readonly entity: Entity;
  readonly frame?: Entity;
  readonly canvasTypeId?: string;
  readonly message: string;
  /** This condition removes document-wide authority rather than locking one row. */
  readonly removesWriteAuthority: boolean;
}

export interface CanvasDiagnosticSnapshot {
  readonly diagnostics: readonly CanvasDiagnostic[];
  readonly authorityIssue?: string;
}

function entityKey(store: DurableStore, entity: Entity): string {
  return String(store.keyOf(entity) ?? `runtime:${entity}`);
}

export function collectCanvasDiagnostics(opts: {
  readonly world: World;
  readonly store: DurableStore;
  readonly catalog: EngineCatalog;
  readonly report: DocVersionReport;
  readonly maxDepth?: number;
}): CanvasDiagnosticSnapshot {
  const { world, store, catalog, report } = opts;
  const maxDepth = opts.maxDepth ?? 64;
  const root = world.getResource(BoardRoot)?.root;
  const diagnostics: CanvasDiagnostic[] = [];
  const push = (
    entity: Entity,
    code: CanvasDiagnosticCode,
    message: string,
    extra: Pick<CanvasDiagnostic, "frame" | "canvasTypeId"> = {},
  ): void => {
    diagnostics.push({
      code,
      key: entityKey(store, entity),
      entity,
      message,
      removesWriteAuthority: code === "content-without-requirement",
      ...extra,
    });
  };

  world.query(durableQ).each((batch) => {
    for (const row of batch) {
      const entity = batch.entity(row);
      const typeId = world.read(entity, PrefabId).id;
      if (typeof typeId !== "string") continue;
      const widget = catalog.widget(typeId);
      if (widget === undefined) {
        push(entity, "unknown-widget", `WidgetType "${typeId}" is not compiled by this engine.`);
        if (report.docPacks[typeId] === undefined) {
          push(
            entity,
            "content-without-requirement",
            `Content for unknown WidgetType "${typeId}" arrived before a pack requirement.`,
          );
        }
        continue;
      }

      for (const [pack, version] of Object.entries(
        catalog.requirementsForWidget(typeId) ?? {},
      )) {
        if (report.docPacks[pack] !== version) {
          push(
            entity,
            "content-without-requirement",
            `Widget "${typeId}" requires ${pack}@${version}, but the document does not.`,
          );
        }
      }

      const parent = world.getRelation(entity, ChildOf);
      if (parent === undefined) {
        push(entity, "malformed-parent", `Widget "${typeId}" has no direct CanvasFrame owner.`);
        continue;
      }

      const frame = parent;
      let canvasTypeId: string | undefined;
      if (parent === root) {
        canvasTypeId = report.rootCanvas?.id;
      } else {
        const parentType = world.get(parent, PrefabId)?.id;
        const container =
          typeof parentType === "string" ? catalog.widget(parentType)?.container : undefined;
        if (container === undefined) {
          push(
            entity,
            "malformed-parent",
            `Widget "${typeId}" is directly owned by a non-container entity.`,
            { frame },
          );
          continue;
        }
        canvasTypeId = container.canvasTypeId;
      }

      const seen = new Set<Entity>([entity]);
      let cursor: Entity | undefined = parent;
      let depth = 0;
      while (cursor !== undefined && cursor !== root) {
        if (seen.has(cursor)) {
          push(entity, "child-of-cycle", `Widget "${typeId}" belongs to a ChildOf cycle.`, {
            frame,
            ...(canvasTypeId === undefined ? {} : { canvasTypeId }),
          });
          break;
        }
        seen.add(cursor);
        cursor = world.getRelation(cursor, ChildOf);
        depth += 1;
        if (depth + (widget.container === undefined ? 0 : 1) > maxDepth) {
          push(entity, "depth-limit", `Widget "${typeId}" exceeds frame depth ${maxDepth}.`, {
            frame,
            ...(canvasTypeId === undefined ? {} : { canvasTypeId }),
          });
          break;
        }
      }
      if (cursor === undefined) {
        push(entity, "malformed-parent", `Widget "${typeId}" ancestry does not reach BoardRoot.`, {
          frame,
          ...(canvasTypeId === undefined ? {} : { canvasTypeId }),
        });
      }

      if (
        canvasTypeId !== undefined &&
        catalog.canvasType(canvasTypeId) !== undefined &&
        !catalog.placementFor(canvasTypeId).has(typeId)
      ) {
        push(
          entity,
          "incompatible-placement",
          `CanvasType "${canvasTypeId}" does not allow WidgetType "${typeId}".`,
          { frame, canvasTypeId },
        );
      }
    }
  });

  diagnostics.sort(
    (a, b) => a.key.localeCompare(b.key) || a.code.localeCompare(b.code) || a.message.localeCompare(b.message),
  );
  const authority = diagnostics.find((diagnostic) => diagnostic.removesWriteAuthority);
  return Object.freeze({
    diagnostics: Object.freeze(diagnostics),
    ...(authority === undefined ? {} : { authorityIssue: authority.message }),
  });
}
