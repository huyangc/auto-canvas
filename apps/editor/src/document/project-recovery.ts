// Legacy localStorage recovery slot.
//
// The editor previously wrote full serialized Projects to localStorage under
// `icm.recovery.v1`. Browser recovery now lives in IndexedDB under the
// bounded v2 contract (`browser-recovery-contract.ts`,
// `browser-recovery-store.ts`); this module keeps only the legacy key and
// storage shape that the one-time migration reads. Nothing may write this
// slot anymore.

export const PROJECT_RECOVERY_KEY = "icm.recovery.v1";

export interface ProjectRecoveryStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
