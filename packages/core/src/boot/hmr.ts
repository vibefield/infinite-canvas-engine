/**
 * HMR-safe schema/prefab boot kit (M0 deliverable; the strata+Vite reference pattern).
 *
 * strata's define* registry is process-global: a re-executed schema module throws
 * "already defined". Apps register ALL schema/prefabs through defineSchemaOnce from
 * one module, and call hmrInvalidateOnSchemaChange(import.meta.hot) so any edit to
 * that module forces a full reload instead of a broken hot-swap.
 */
export function defineSchemaOnce<T>(key: string, build: () => T): T {
  const g = globalThis as { __iceSchemas?: Map<string, unknown> };
  g.__iceSchemas ??= new Map<string, unknown>();
  const map = g.__iceSchemas;
  if (!map.has(key)) map.set(key, build());
  return map.get(key) as T;
}

export function hmrInvalidateOnSchemaChange(hot: { invalidate(): void } | undefined): void {
  hot?.invalidate();
}
