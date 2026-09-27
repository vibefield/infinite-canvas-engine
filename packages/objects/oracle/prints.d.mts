// The types of prints.mjs, for its TypeScript hosts — apps/desk's parity page and the world's scenes (D3t-c).

/** A committed print's metadata: its level, a tile's texels, the tiles held (in the bytes' order) and the ones nothing prints in. */
export interface PrintMeta {
  readonly level: number;
  readonly tex: number;
  readonly tiles: readonly string[];
  readonly empty: readonly string[];
}

/** A sheet's committed tiles as the tile driver pins them (calendar/printing.ts `PinnedSheet`). */
export interface CommittedSheet {
  readonly level: number;
  readonly tiles: ReadonlyMap<string, Uint8Array<ArrayBuffer>>;
  readonly empty: ReadonlySet<string>;
}

/** The committed prints the oracle's scenes name. */
export const PRINT_FIXTURES: readonly string[];
export const PRINT_ZONE: string;
/** A sheet pinned with nothing on it: the paper and its ruled grid. */
export const BLANK_SHEET: CommittedSheet;
/** A committed print from its meta and its INFLATED bytes. */
export function printSheetOf(meta: PrintMeta, bytes: Uint8Array<ArrayBuffer>): CommittedSheet;
