/**
 * The desk app's engine lifetime under React. `<App>` owns ONE engine for as long as it is mounted, and React's StrictMode
 * runs every effect's cleanup and then the effect again on the SAME state in development (its double-mount check).
 * Disposing the engine in that cleanup left the re-run `<Desk>` mounting against a disposed engine — "ice: presentation
 * transition coordinator is disposed." on `pnpm --filter desk dev` (the rigs drive the production build, where the check
 * never runs). So the dispose waits one task and a re-entry cancels it: a real unmount still disposes the engine, the
 * double-mount check does not.
 */
export interface Lifetime {
  /** The owner mounted (again): a pending dispose is cancelled. */
  enter(): void;
  /** The owner unmounted: dispose on the next task unless it enters again first. Idempotent. */
  leave(): void;
}

export function disposeOnLeave(dispose: () => void): Lifetime {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  return {
    enter() {
      if (timer === undefined) return;
      clearTimeout(timer);
      timer = undefined;
    },
    leave() {
      if (disposed || timer !== undefined) return;
      timer = setTimeout(() => {
        timer = undefined;
        disposed = true;
        dispose();
      }, 0);
    },
  };
}
