// The types of scenes.mjs (the desk clock's stills), for its TypeScript readers.
export const CLOCK_AT: number;
export const CLOCK_TYPE_ID: string;
export const BROKEN_CLOCK_TYPE_ID: string;
export const CLOCK_DESK: readonly { readonly type: string; readonly x: number; readonly y: number; readonly props: Readonly<Record<string, unknown>>; readonly asset: { readonly at: number } }[];
export const CLOCK_SCENES: readonly { readonly name: string; readonly scene: unknown }[];
