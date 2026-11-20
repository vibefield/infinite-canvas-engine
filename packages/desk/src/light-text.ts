// THE PAGE'S LIGHT TEXT (petition I56) — which text of the mat's light the generated module hands out, and whether
// any program has composed it yet. Module state: ONE per realm (a worker, an iframe, a second renderer each has its
// own and chooses for itself). shaders.ts is its only reader and writer in the product; this module is not on the
// package's entries, so the reset below is reachable from tests alone.

/** The two texts of the mat's light (shaders.ts `setLightText` says what each is). */
export type LightText = "cone" | "soft";

export const lightTextState: { text: LightText; composed: boolean } = { text: "cone", composed: false };

/** TESTS ONLY: the page as it loads — the cone's text, nothing composed — so one file's choice never reaches another's. */
export function resetLightText(): void {
  lightTextState.text = "cone";
  lightTextState.composed = false;
}
