/**
 * Renderer-neutral accounting for allocations shared by independent GPU
 * adapters. The ledger owns numbers and exact inverses only; textures and
 * render targets stay in their renderer package.
 */

export interface GpuAllocatorRegistration {
  readonly id: string;
  /** Current live allocation, including pinned rows. */
  usedBytes(): number;
  /** Reclaim only adapter-declared eligible rows. Returns bytes actually freed. */
  reclaim(bytesNeeded: number): number;
}

export interface GpuAllocatorHandle {
  /** Maximum bytes this allocator may own without exceeding the shared total. */
  limitBytes(): number;
  unregister(): void;
}

export interface GpuReservation {
  readonly id: string;
  readonly bytes: number;
  release(): void;
}

export interface GpuAllocationStats {
  readonly budgetBytes: number;
  readonly allocatorBytes: number;
  readonly reservedBytes: number;
  readonly usedBytes: number;
  readonly reservations: number;
}

export interface GpuAllocationLedger {
  readonly budgetBytes: number;
  registerAllocator(registration: GpuAllocatorRegistration): GpuAllocatorHandle;
  /**
   * Reserve a renderer-owned bounded allocation. Eligible allocator rows are
   * reclaimed first; failure never temporarily exceeds the shared budget.
   */
  reserve(id: string, bytes: number): GpuReservation | undefined;
  stats(): GpuAllocationStats;
  dispose(): void;
}

function validBytes(label: string, bytes: number): number {
  if (!Number.isSafeInteger(bytes) || bytes < 0) {
    throw new Error(`ice: ${label} must be a non-negative safe integer.`);
  }
  return bytes;
}

export function createGpuAllocationLedger(budgetBytes: number): GpuAllocationLedger {
  const budget = validBytes("GPU allocation budget", budgetBytes);
  const allocators = new Map<string, GpuAllocatorRegistration>();
  const reservations = new Map<symbol, { id: string; bytes: number }>();
  let disposed = false;

  const allocatorBytes = (except?: string): number => {
    let total = 0;
    for (const [id, allocator] of allocators) {
      if (id === except) continue;
      const bytes = allocator.usedBytes();
      if (Number.isFinite(bytes) && bytes > 0) total += bytes;
    }
    return total;
  };
  const reservedBytes = (): number => {
    let total = 0;
    for (const reservation of reservations.values()) total += reservation.bytes;
    return total;
  };
  const totalBytes = (): number => allocatorBytes() + reservedBytes();

  return {
    budgetBytes: budget,
    registerAllocator(registration) {
      if (disposed) throw new Error("ice: GPU allocation ledger is disposed.");
      if (registration.id.length === 0 || allocators.has(registration.id)) {
        throw new Error(`ice: GPU allocator id "${registration.id}" is empty or already registered.`);
      }
      allocators.set(registration.id, registration);
      let live = true;
      return {
        limitBytes: () =>
          live && !disposed
            ? Math.max(0, budget - reservedBytes() - allocatorBytes(registration.id))
            : 0,
        unregister() {
          if (!live) return;
          live = false;
          if (allocators.get(registration.id) === registration) {
            allocators.delete(registration.id);
          }
        },
      };
    },
    reserve(id, bytes) {
      if (disposed) return undefined;
      const amount = validBytes(`GPU reservation "${id}"`, bytes);
      if (amount > budget) return undefined;
      let deficit = totalBytes() + amount - budget;
      if (deficit > 0) {
        for (const [, allocator] of [...allocators].sort(([a], [b]) => a.localeCompare(b))) {
          try {
            allocator.reclaim(deficit);
          } catch {
            // A faulty allocator forfeits its reclaim opportunity; accounting
            // below still prevents the new reservation from exceeding budget.
          }
          deficit = totalBytes() + amount - budget;
          if (deficit <= 0) break;
        }
      }
      if (totalBytes() + amount > budget) return undefined;
      const token = Symbol(id);
      reservations.set(token, { id, bytes: amount });
      let live = true;
      return {
        id,
        bytes: amount,
        release() {
          if (!live) return;
          live = false;
          reservations.delete(token);
        },
      };
    },
    stats() {
      const allocator = allocatorBytes();
      const reserved = reservedBytes();
      return Object.freeze({
        budgetBytes: budget,
        allocatorBytes: allocator,
        reservedBytes: reserved,
        usedBytes: allocator + reserved,
        reservations: reservations.size,
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      reservations.clear();
      allocators.clear();
    },
  };
}
