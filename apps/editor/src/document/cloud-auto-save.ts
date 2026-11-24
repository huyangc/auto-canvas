// Cloud auto-save: the browser preference, the holds a failed write leaves,
// what keeps an automatic save from starting now, and what the statusbar chip
// says. The scheduling itself lives in the file lifecycle, which owns the save
// coordinator; everything here is pure or a small external store, so it stays
// safe to import during server rendering.
import { useSyncExternalStore } from "react";

import type {
  CloudProjectBinding,
  CloudProjectSaveOutcome,
} from "../features/editor-shell/cloud-projects";
import type { InteractionState } from "../interaction/interaction-state";
import type { PersistenceState } from "./use-project-file-lifecycle";

/** Global, not account-scoped: one browser's choice, which e2e can seed. */
export const CLOUD_AUTO_SAVE_STORAGE_KEY = "icm.cloud-auto-save.v1";
/** How long editing must pause before a bound Project saves itself. */
export const CLOUD_AUTO_SAVE_DELAY_MS = 3000;
/** How often a due save asks again while something holds it back. */
export const CLOUD_AUTO_SAVE_POLL_MS = 500;

type PreferenceStorage = Pick<Storage, "getItem" | "setItem">;

function browserStorage(): PreferenceStorage | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function readStoredEnabled(): boolean {
  try {
    return browserStorage()?.getItem(CLOUD_AUTO_SAVE_STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
}

// The session's value wins over storage: a browser that refuses the write
// still turns auto-save off (or on) until the page leaves.
let enabledValue: boolean | null = null;
const preferenceListeners = new Set<() => void>();

function readEnabled(): boolean {
  if (enabledValue === null) enabledValue = readStoredEnabled();
  return enabledValue;
}

function notifyPreference(): void {
  for (const listener of preferenceListeners) listener();
}

function onStorage(event: StorageEvent): void {
  if (event.key !== null && event.key !== CLOUD_AUTO_SAVE_STORAGE_KEY) return;
  const next = event.key === null ? true : event.newValue !== "off";
  if (next === readEnabled()) return;
  enabledValue = next;
  notifyPreference();
}

function subscribePreference(listener: () => void): () => void {
  if (preferenceListeners.size === 0 && typeof window !== "undefined")
    window.addEventListener("storage", onStorage);
  preferenceListeners.add(listener);
  return () => {
    preferenceListeners.delete(listener);
    if (preferenceListeners.size === 0 && typeof window !== "undefined")
      window.removeEventListener("storage", onStorage);
  };
}

function setEnabled(next: boolean): void {
  enabledValue = next;
  try {
    browserStorage()?.setItem(CLOUD_AUTO_SAVE_STORAGE_KEY, next ? "on" : "off");
  } catch {
    // The choice still holds for this session.
  }
  notifyPreference();
}

/** Whether bound Cloud Projects save themselves; on unless turned off. */
export function useCloudAutoSavePreference(): {
  enabled: boolean;
  setEnabled(next: boolean): void;
} {
  const enabled = useSyncExternalStore(
    subscribePreference,
    readEnabled,
    () => true,
  );
  return { enabled, setEnabled };
}

// Counts the browser's `online` events: an offline hold applies only within
// the epoch its failed attempt started in.
let onlineCount = 0;
let onlineListening = false;
const onlineListeners = new Set<() => void>();

function installOnlineListener(): void {
  if (onlineListening || typeof window === "undefined") return;
  onlineListening = true;
  window.addEventListener("online", () => {
    onlineCount += 1;
    for (const listener of onlineListeners) listener();
  });
}

/** The current online epoch; installs its listener on first use. */
export function onlineEpoch(): number {
  installOnlineListener();
  return onlineCount;
}

function subscribeOnline(listener: () => void): () => void {
  installOnlineListener();
  onlineListeners.add(listener);
  return () => {
    onlineListeners.delete(listener);
  };
}

/** The online epoch as render state: a render follows each `online` event. */
export function useOnlineEpoch(): number {
  return useSyncExternalStore(subscribeOnline, onlineEpoch, () => 0);
}

export type CloudAutoSaveHoldKind =
  | "conflict"
  | "offline"
  | "signed-out"
  | "too-large"
  | "limit"
  | "not-found"
  | "rejected";

/**
 * What a failed write left on one Cloud revision: auto-save stops for that
 * binding and revision until a save succeeds. An `offline` hold also ends at
 * the next `online` event after its attempt started.
 */
export interface CloudAutoSaveHold {
  kind: CloudAutoSaveHoldKind;
  bindingId: string;
  revision: number;
  onlineEpoch?: number;
}

function holdsBinding(
  hold: CloudAutoSaveHold,
  binding: CloudProjectBinding | null,
): boolean {
  return (
    binding !== null &&
    hold.bindingId === binding.id &&
    hold.revision === binding.revision
  );
}

/**
 * The hold after a write attempt with `binding` ended in `outcome` (`threw`:
 * the store call itself failed). A success clears it; a conflict already held
 * on that revision is never replaced by a weaker failure.
 */
export function holdAfterFailure(
  existing: CloudAutoSaveHold | null,
  binding: CloudProjectBinding,
  outcome: CloudProjectSaveOutcome | "threw",
  epochAtStart: number,
): CloudAutoSaveHold | null {
  if (outcome !== "threw" && outcome.status === "saved") return null;
  if (existing?.kind === "conflict" && holdsBinding(existing, binding))
    return existing;
  const kind: CloudAutoSaveHoldKind =
    outcome === "threw"
      ? "rejected"
      : outcome.status === "unreachable"
        ? "offline"
        : outcome.status;
  return {
    kind,
    bindingId: binding.id,
    revision: binding.revision,
    ...(kind === "offline" ? { onlineEpoch: epochAtStart } : {}),
  };
}

/** The hold if it still applies to this binding and online epoch, else null. */
export function applicableHold(
  hold: CloudAutoSaveHold | null | undefined,
  binding: CloudProjectBinding | null,
  epoch: number,
): CloudAutoSaveHold | null {
  if (!hold || !holdsBinding(hold, binding)) return null;
  if (hold.kind === "offline" && hold.onlineEpoch !== epoch) return null;
  return hold;
}

/**
 * Whether the canvas is in the middle of something an automatic save must
 * wait for: a wire, drawing or rail being drawn, a copy being placed, a move,
 * or a Cell symbol gesture. A tool that is only selected holds nothing.
 */
export function interactionHoldsAutoSave(
  state: InteractionState<unknown>,
): boolean {
  switch (state.kind) {
    case "wire":
      return (
        state.source !== null ||
        state.steps.length > 0 ||
        state.labelEditing !== undefined
      );
    case "drawing":
      return state.source !== null || state.waypoints.length > 0;
    case "placing-vdd-rail":
      return state.start !== null;
    case "copy-placement":
    case "moving-selection":
      return true;
    case "cell-symbol-layout":
      return state.gesture !== null;
    case "idle":
    case "no-connect":
    case "placing-component":
      return false;
  }
}

export type CloudSaveTone =
  "saving" | "saved" | "unsaved" | "off" | "offline" | "paused" | "failed";

export interface CloudSaveIndicator {
  label: string;
  title: string;
  tone: CloudSaveTone;
}

function pausedTitle(kind: CloudAutoSaveHoldKind): string {
  if (kind === "signed-out")
    return "Sign in again, then press Ctrl+S to save to Cloud";
  if (kind === "too-large")
    return "The Project is too large for Cloud Projects; download a backup";
  if (kind === "not-found")
    return "This Cloud Project no longer exists; export a backup";
  return "The last Cloud save failed; Ctrl+S retries";
}

/** The statusbar chip for the active bound Project; null shows none. */
export function cloudSaveIndicator(input: {
  visible: boolean;
  enabled: boolean;
  binding: CloudProjectBinding | null;
  persistenceState: PersistenceState;
  saving: boolean;
  armed: boolean;
  hold: CloudAutoSaveHold | null;
  pendingDraft: boolean;
}): CloudSaveIndicator | null {
  if (!input.visible || !input.binding) return null;
  if (input.saving)
    return { label: "Saving…", title: "Saving to Cloud", tone: "saving" };
  const { hold } = input;
  if (hold?.kind === "conflict")
    return {
      label: "Auto-save paused",
      title:
        "Changed elsewhere. Your edits stay here: export a backup, close this tab and reopen the Project from Cloud Projects",
      tone: "paused",
    };
  if (hold?.kind === "offline")
    return {
      label: "Cloud offline",
      title: "Saves when the browser is back online; Ctrl+S retries now",
      tone: "offline",
    };
  if (hold)
    return {
      label: "Auto-save paused",
      title: pausedTitle(hold.kind),
      tone: "paused",
    };
  if (input.pendingDraft)
    return {
      label: "Unsaved",
      title: "Saves after the current edit is applied",
      tone: "unsaved",
    };
  if (input.persistenceState === "clean")
    return {
      label: "Saved",
      title: input.enabled
        ? "All changes saved to Cloud"
        : "Saved to Cloud · auto-save is off",
      tone: "saved",
    };
  if (input.persistenceState === "failed")
    return {
      label: "Save failed",
      title: "Press Ctrl+S to retry",
      tone: "failed",
    };
  if (!input.enabled)
    return {
      label: "Auto-save off",
      title: "Press Ctrl+S to save to Cloud",
      tone: "off",
    };
  if (input.armed)
    return {
      label: "Unsaved",
      title: "Saves to Cloud a few seconds after editing pauses",
      tone: "unsaved",
    };
  return {
    label: "Unsaved",
    title: "Restored changes: edit or press Ctrl+S to save to Cloud",
    tone: "unsaved",
  };
}
