/**
 * A tiny rAF driver with a setInterval fallback — the panels poll the live world
 * off React's render cycle (v2 used bare requestAnimationFrame). The fallback keeps
 * the code alive under happy-dom / any env without rAF (the smoke test), per the
 * task's StrictMode + headless guard.
 */
export function startFrameLoop(cb: () => void): () => void {
  if (typeof requestAnimationFrame === "function") {
    let raf = requestAnimationFrame(function tick() {
      cb();
      raf = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(raf);
  }
  const id = setInterval(cb, 32);
  return () => clearInterval(id);
}
