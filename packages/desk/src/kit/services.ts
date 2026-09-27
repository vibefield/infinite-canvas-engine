// THE SERVICES (design-016 §5 · K-L2, K8a): what a desk LENDS its kinds, as an OPEN registry by name. Until K8a `KindHost`
// carried a fixed list — the text raster, the picture decoder, the byte store, and `print`, which WAS the desk calendar's raster
// (lent to the calendar alone) — so a plugin kind could neither lend a service of its own nor use one another kind lent. Now a
// service is an ENTRY under a typed KEY: the host lends its own (the text raster, the decoder, the byte store — `deskLayer`'s
// options), an object's DOM half lends what only a browser can make (`defineObject({ host: { lend } })` — the calendar's print
// raster), and every kind's world half `use`s any of them by key (`KindHost.use`).
//
// A key is a VALUE carrying its type (D-K8a.1): `serviceKey<T>(name)` — never a declaration-merged interface, which would have
// to be augmented through the module a plugin imports (`@ice/desk` here, `@vibecook/ice/desk` published) and breaks when the
// d.ts is bundled. Keys match by NAME, not identity: a kind may declare a key for a service another package lends without
// importing that package (K-L1 — a kind names another only by a registry name), and two copies of one module agree. A name is
// lent once per desk: a second lender is a mount error, never a silent winner.

/** A service's KEY (K8a): its name — the registry's identity — and, as a phantom, the type of what is lent under it. */
export interface ServiceKey<T> {
  readonly name: string;
  /** Never set: carries `T` so `use(key)` answers the lent thing's own type. */
  readonly __service?: T;
}

/** A key for a service of type `T` under `name` — namespace a plugin's own (`"clock.face"`); the desk's are bare words. */
export const serviceKey = <T>(name: string): ServiceKey<T> => ({ name });

/** One service as it is LENT: its key and the thing. Made by `service(key, value)`, which checks the pair's type. */
export interface Lent<T = unknown> {
  readonly key: ServiceKey<T>;
  readonly value: T;
}

/** An entry to lend: `service(PRINT_RASTER, printRaster({ text }))`. */
export const service = <T>(key: ServiceKey<T>, value: T): Lent<T> => ({ key, value });

/** Where a service is found: `use(key)` answers what is lent under the key's name, or undefined — none on this desk. */
export interface Services {
  use<T>(key: ServiceKey<T>): T | undefined;
}

/** A registry of what has been lent so far (the desk layer's): `lend` adds entries — a name lent twice throws, naming both lenders. */
export interface ServiceRegistry extends Services {
  lend(entries: readonly Lent[], by: string): void;
  /** The names lent, in lending order (a rig's and a test's witness). */
  names(): readonly string[];
}

export function createServices(entries: readonly Lent[] = [], by = "the host"): ServiceRegistry {
  const lent = new Map<string, { readonly value: unknown; readonly by: string }>();
  const registry: ServiceRegistry = {
    use: <T>(key: ServiceKey<T>): T | undefined => lent.get(key.name)?.value as T | undefined,
    lend(more, lender) {
      for (const { key, value } of more) {
        const had = lent.get(key.name);
        if (had !== undefined) throw new Error(`desk: the service "${key.name}" is lent twice — by ${had.by} and by ${lender} (a name is lent once per desk)`);
        if (value !== undefined) lent.set(key.name, { value, by: lender });
      }
    },
    names: () => [...lent.keys()],
  };
  registry.lend(entries, by);
  return registry;
}
