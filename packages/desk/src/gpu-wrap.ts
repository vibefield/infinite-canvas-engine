// What the GPU instruments share (design-016 §4, K2): how a method is wrapped so that removing the wrapper leaves NOTHING
// behind, and how a resource's label names its kind.

/**
 * Replace `obj[key]` with `value`; the undo puts back exactly what was there — the own property it had, or no own property at all
 * (the prototype's method shows through again, so "the wrappers are gone" is literal). Wrapped over since, the undo leaves
 * ours beneath theirs: the caller's wrapper must then pass through.
 */
export function swapMethod<T extends object, K extends keyof T>(obj: T, key: K, value: T[K]): () => void {
  const own = Object.getOwnPropertyDescriptor(obj, key);
  obj[key] = value;
  return () => {
    if (obj[key] !== value) return;
    if (own !== undefined) Object.defineProperty(obj, key, own);
    else Reflect.deleteProperty(obj, key);
  };
}

/** A resource's label prefix — its kind: `paper/notes` → `paper`; no label → `?`. */
export const prefixOf = (label: string | undefined): string => {
  if (label === undefined || label.length === 0) return "?";
  const slash = label.indexOf("/");
  return slash < 0 ? label : label.slice(0, slash);
};
