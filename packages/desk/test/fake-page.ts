// A structural PAGE for `deskLayer`'s mount in Node (design-015 D7): a container that keeps its children, an element that
// takes a style, and a view whose reduced-motion query counts its listeners — enough for a mount to run up to its GPU boot
// (whose swap chain then fails on the fake canvas, as it should with no WebGPU here).
/** An object that takes any property and answers any method it lacks with a no-op (a DOM node's long tail: setAttribute, addEventListener, focus…). */
function permissive<T extends object>(base: T): T {
  return new Proxy(base, {
    get: (t, k) => (k in t ? (t as Record<PropertyKey, unknown>)[k] : typeof k === "string" ? () => undefined : undefined),
    set: (t, k, v) => { (t as Record<PropertyKey, unknown>)[k] = v; return true; },
  });
}

export function fakePage() {
  const children: unknown[] = [];
  const listeners = new Set<unknown>();
  const element = (tag: string) => {
    const el: object = permissive({ tagName: tag.toUpperCase(), style: permissive({}), dataset: {}, width: 0, height: 0, hidden: false, remove: () => { const i = children.indexOf(el); if (i >= 0) children.splice(i, 1); } });
    return el;
  };
  const query = { matches: false, addEventListener: (_: string, l: unknown) => listeners.add(l), removeEventListener: (_: string, l: unknown) => listeners.delete(l) };
  const ownerDocument = permissive({ createElement: element, defaultView: permissive({ matchMedia: () => query }) });
  const container = permissive({ ownerDocument, prepend: (el: unknown) => children.unshift(el), appendChild: (el: unknown) => children.push(el) });
  return { container, children, listeners };
}
