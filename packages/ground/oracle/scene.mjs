// The one scene generator every comparison shares: deterministic cards around a
// fixed world point, identical for the raw prototype, the lab and the oracle.
export function makeCards(n, seed = 1) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = i * 2.399963 + seed;
    const rad = 560 * Math.sqrt((i + 1) / Math.max(n, 1));
    out.push({
      x: 600 + Math.cos(a) * rad, y: 400 + Math.sin(a) * rad,
      w: 150 + ((i * 37) % 130), h: 90 + ((i * 53) % 90), r: 12 + ((i * 7) % 12),
      strength: 0.6 + ((i * 13) % 9) / 10, hue: (i * 0.381966) % 1,
    });
  }
  return out;
}
export const VIEW = { cssW: 1200, cssH: 800, dpr: 2 };
