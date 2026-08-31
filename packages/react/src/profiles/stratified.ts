/**
 * The STRATIFIED presentation profile (design-004's six-plane model, unchanged).
 *
 * This is not a legacy path. It is the answer for every host that cannot assume
 * HTML-in-Canvas — which today is every browser that is not Chromium with an
 * origin-trial flag — and design-012 §3 keeps it buildable until HiC ships
 * stable. It is also the PIXEL ORACLE the composited profile is graded against
 * until S8.
 *
 * It contributes nothing to the roster because it IS the roster
 * `<InfiniteCanvas>` has always registered: planeTransform → ground →
 * domWidgets → chrome → cursors. Its check never refuses; a stratified build
 * runs anywhere the engine runs, including headless with no ground at all.
 *
 * MUST NOT import the composited profile (dependency-cruiser enforces it): the
 * two are alternatives, and an import edge between them would put both in every
 * app's bundle and quietly turn a build-time selection into dead weight.
 */
import type { PresentationProfile } from "./contract";

export const stratifiedProfile: PresentationProfile = {
  name: "stratified",
  check: () => null,
  reflectorsAfterGround: () => [],
};
