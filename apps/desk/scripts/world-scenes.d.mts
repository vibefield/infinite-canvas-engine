// The types of world-scenes.mjs, for its test (test/world-scenes.test.ts).

/** The reason a still cannot be drawn from the world (its moment is the oracle desk's clock), or undefined when it can. */
export function notFromTheWorld(sc: { readonly name: string; readonly scene: unknown }): string | undefined;
