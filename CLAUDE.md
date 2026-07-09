# infinite-canvas-engine

Third (and intended-final) attempt at a universal infinite-canvas framework — Figma/Apple-Freeform-grade UX, `defineWidget` primitive (React or R3F widgets usable as node-editor nodes), built on **strata-ecs** (`../strata-ecs`, `@vibecook/strata-ecs`): archetype ECS + reactivity + opt-in Loro-CRDT durable (transactions, gesture-atomic undo) and presence layers.

Prior attempts (read-only reference): `../infinite-canvas` (v1, on reactive-ecs\@0.3.0 — good subsystems, entangled interaction runtime) and its `apps/playground/src/prototype/` (v2, pointer-as-entity — proven decomposition, faked relations). The full audit of what survived examination is in `draft/examined-inventory.md`.

## Repo layout & branch policy

- `docs/` — committed project docs (implementation plan, future ADRs). Normal commits on `main`.
- `draft/` — design docs + architecture diagram. **Tracked ONLY on the `local-dev` branch; NEVER pushed; never committed on `main`** (it's in `.gitignore`; the files stay present-but-untracked in the working tree).
- Design series (in `draft/`): `examined-inventory.md` (the Laws + keep/discard verdicts) → `design-001-data-model.md` (prefab sovereignty, gesture write protocol) → `design-002-frame-contract.md` (sync→tick→publish→notify→reflect; sub-phases; reflectors; package layering) → `design-003-interaction-stack.md` (L0–L4) → `design-004-widget-runtime.md` (planes, islands/compositor, router, nested canvas) → `design-005-userland-api.md` (defineWidget/defineTool, facade, doc kit). Every doc was adversarially reviewed; decisions cite evidence — **do not re-litigate a locked decision without new evidence; amend the doc if you do.**

### Draft workflow (snapshotting draft changes)

```sh
git checkout local-dev && git add -f draft && git commit -m "local: draft snapshot" \
  && git checkout main && git checkout local-dev -- draft/ && git restore --staged draft/
```

(The final two commands restore `draft/` into the worktree untracked after the branch switch removes it.) A `.git/hooks/pre-push` hook blocks pushing `local-dev`; do not remove it. Never merge `local-dev` into `main`.

## Non-negotiable engine laws (digest — full list in draft/examined-inventory.md §3)

- All interaction state lives in the world (no closure FSMs/singletons); one input path (adapters only enqueue).
- Sovereignty at prefab level: durable/runtime/ephemeral = spawn path (`tx`/`world`/`eph`); components and tags stay pure; durable cells written live only under a gesture claim, committed as ONE transaction per gesture at `JustEnded`.
- Absolute writes only; structure from systems via `ctx.*` only; phases/sub-phases are the sole ordering contract; `notify()` once per frame; reflectors are post-notify and never write ECS.
- Churny state = tags/value writes, never per-frame component swaps; interaction-rate tags/relations written change-only (global tag/rel version counter in strata).
- Pure math stays in `kernel` (no ECS/DOM/React imports); coordinate conversions + Y-flip in exactly one module; the spatial index is the only hit path.
- `access.write` declared on every value-writing system from day one (reflectors arm strata enforcement permanently).

## Working here

- pnpm monorepo (Node 24+): packages `kernel`/`core`/`dom`/`react`/`r3f`/`devtools` (`@ice/*` — scope rename possible pre-publish). Import walls are dependency-cruiser-enforced and CI-fatal: kernel imports nothing (single named exception: `rbush`); core = strata-ecs + kernel only; chain dom → react → r3f; devtools → core; nobody imports devtools.
- Commands: `pnpm run ci` (typecheck + lint + test + depcruise — the merge gate) · `pnpm run build` · per-package `pnpm --filter @ice/kernel test`.
- strata-ecs pinned at `0.3.0` (pre-1.0): API-verify against `../strata-ecs/src` when in doubt (the design docs cite file:line for every load-bearing claim); upgrades re-run the full trace suite. 0.3.0 shipped both engine petitions (`{ undoable: false }` transactions; per-tag/relation observer precision) — record in `docs/strata-petitions.md`.
- Milestones + exit criteria: `docs/implementation-plan.md` (next: M1 kernel math ports).
- Verify design claims against the docs before "fixing" behavior that looks odd — several counterintuitive choices (e.g., ports on-demand, stratified z, OS cursor default) are deliberate, reviewed decisions.
