/**
 * localStorage-backed autosave adapter (base64) — the app owns WHERE bytes go
 * (design-005 §6.6). Envelopes are binary, base64-encoded for localStorage's
 * string values; `stashQuarantine` parks corrupt bytes under a sibling key so a
 * bad save never blocks the next boot (the M5 never-brick path). Copied from the
 * graybox demo — the storage contract is app-side and identical here.
 */
import type { AutosaveStorageRead, AutosaveStorageWrite } from "@ice/core";

export interface CardboardStorage extends AutosaveStorageRead, AutosaveStorageWrite {
  stashQuarantine(bytes: Uint8Array): void;
  clear(): void;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToBytes(text: string): Uint8Array {
  const binary = atob(text);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

export function createLocalStorageStorage(key: string): CardboardStorage {
  return {
    get(): Uint8Array | undefined {
      const text = localStorage.getItem(key);
      return text === null ? undefined : base64ToBytes(text);
    },
    put(bytes: Uint8Array): void {
      localStorage.setItem(key, bytesToBase64(bytes));
    },
    stashQuarantine(bytes: Uint8Array): void {
      localStorage.setItem(`${key}.quarantine`, bytesToBase64(bytes));
    },
    clear(): void {
      localStorage.removeItem(key);
    },
  };
}
