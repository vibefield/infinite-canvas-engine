/**
 * Folder-mini preview styles (2026-07-17, James: minis should be "exact the
 * same [shape] with rounded corner" and "take the original card's color
 * gradient into account"): ONE map from widget type to the CSS background its
 * card actually renders, sourced from the widgets' own exported constants
 * wherever the card has one (the GL BACKPLATE gradients, the weather sky,
 * the node tints) so a re-themed card re-themes its mini for free.
 *
 * The folder's own surface color lives HERE (CardContainer imports it) to
 * keep the module graph one-way — preview.ts must never import CardContainer.
 */
import { CARD_BG } from "./CardShell";
import { gradientCss } from "./GlCardChrome";
import { BACKPLATE as GOLD_KNOT } from "./GoldKnotCard";
import { BACKPLATE as MATTE_SPHERE } from "./MatteSphereCard";
import { NODE_BG } from "./nodes";
import { BACKPLATE as ORBIT_CUBE } from "./OrbitCubeCard";
import { BACKPLATE as SHAPES } from "./ShapesCard";
import { BACKPLATE as TORUS_KNOT } from "./TorusKnotCard";
import { WEATHER_GRADIENT } from "./WeatherCard";

/** The folder card's own surface (the design-006 mock's --panel). */
export const FOLDER_BG = "#1D1D2B";

/** Chromeless floating GL widgets (crystal, cube): a glassy fill — no card. */
const GL_FLOATING_BG = "rgba(165, 175, 225, 0.18)";

const CARD_PREVIEW: Record<string, string> = {
  "gold-knot-card": gradientCss(GOLD_KNOT),
  "torus-knot-card": gradientCss(TORUS_KNOT),
  "orbit-cube-card": gradientCss(ORBIT_CUBE),
  "matte-sphere-card": gradientCss(MATTE_SPHERE),
  "shapes-card": gradientCss(SHAPES),
  "weather-card": WEATHER_GRADIENT,
  // Photos art is hue-randomized SVG per instance; a representative sunset.
  "photos-card": "linear-gradient(135deg, #FF9E5E 0%, #E0526E 55%, #33204A 100%)",
  "crystal-widget": GL_FLOATING_BG,
  "floating-cube-widget": GL_FLOATING_BG,
  "card-container": FOLDER_BG,
  // The comment's translucent indigo tint (its real body) — minis and tray
  // tiles read as "a comment", not a blank card.
  "comment-card": "linear-gradient(135deg, rgba(99, 102, 241, 0.45), rgba(99, 102, 241, 0.18))",
  ...NODE_BG,
};

/** Background for a mini: the card's real look, else the shell default. */
export function previewBackground(
  type: string | undefined,
  surface: "dom" | "gl" | undefined,
): string {
  if (type !== undefined) {
    const hit = CARD_PREVIEW[type];
    if (hit !== undefined) return hit;
  }
  return surface === "gl" ? GL_FLOATING_BG : CARD_BG;
}
