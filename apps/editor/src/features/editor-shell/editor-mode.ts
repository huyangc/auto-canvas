// The editor's two modes. Auto (the default) shows the canvas with import and
// Auto Layout; Draw adds the drawing toolbar and the device library. The mode
// is UI only: it never changes a Document and is not part of a Project.
import { useState } from "react";

import type { EditorShortcutIntent } from "../../interaction/editor-shortcuts";

export type EditorMode = "auto" | "draw";

export const EDITOR_MODE_STORAGE_KEY = "icm.editor-mode.v1";
export const MODE_COACH_STORAGE_KEY = "icm.editor-mode-coach.v1";

type ModeStorage = Pick<Storage, "getItem" | "setItem">;

function browserStorage(): ModeStorage | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

/** The mode chosen last with the switch; anything but `draw` reads as Auto. */
export function readStoredEditorMode(
  storage: ModeStorage | undefined,
): EditorMode {
  try {
    return storage?.getItem(EDITOR_MODE_STORAGE_KEY) === "draw"
      ? "draw"
      : "auto";
  } catch {
    return "auto";
  }
}

function writeStoredEditorMode(
  storage: ModeStorage | undefined,
  mode: EditorMode,
): void {
  try {
    storage?.setItem(EDITOR_MODE_STORAGE_KEY, mode);
  } catch {
    // The mode still switches for this session without storage.
  }
}

/** Whether this browser has already dismissed the first-open coach mark. */
function readCoachSeen(storage: ModeStorage | undefined): boolean {
  try {
    return storage?.getItem(MODE_COACH_STORAGE_KEY) === "seen";
  } catch {
    // Without storage the bubble would return on every open; leave it out.
    return true;
  }
}

function writeCoachSeen(storage: ModeStorage | undefined): void {
  try {
    storage?.setItem(MODE_COACH_STORAGE_KEY, "seen");
  } catch {
    // Dismissed for this session only.
  }
}

export interface SetEditorModeOptions {
  /**
   * Store the mode for the next open. Only an explicit choice (the switch,
   * or the empty card's Draw it yourself) persists; a drawing shortcut that
   * brings up Draw lasts for this session.
   */
  persist: boolean;
}

/** The mode, its switch, and the one-time coach mark that points at it. */
export function useEditorMode({
  initialMode,
  storage = browserStorage(),
}: {
  /** Wins over storage (server rendering and tests). */
  initialMode?: EditorMode | undefined;
  storage?: ModeStorage | undefined;
} = {}) {
  const [mode, setModeState] = useState<EditorMode>(
    () => initialMode ?? readStoredEditorMode(storage),
  );
  // Client only: without a window there is no storage and no bubble.
  const [coachPending, setCoachPending] = useState(
    () => storage !== undefined && !readCoachSeen(storage),
  );
  const dismissCoach = (): void => {
    setCoachPending(false);
    writeCoachSeen(storage);
  };
  const setMode = (next: EditorMode, options: SetEditorModeOptions): void => {
    setModeState(next);
    if (options.persist) writeStoredEditorMode(storage, next);
    dismissCoach();
  };
  return {
    mode,
    setMode,
    // The bubble says "switch to Draw"; it means nothing once Draw is on.
    coachVisible: coachPending && mode === "auto",
    dismissCoach,
  };
}

/**
 * A shortcut that needs the drawing tools, with the tool's name for the
 * status line; null for every key that works in Auto as it is.
 */
export function isDrawingIntent(
  intent: EditorShortcutIntent,
): { tool: string } | null {
  if (intent.kind === "toggle-panel")
    return intent.panel === "library" ? { tool: "Library" } : null;
  if (intent.kind === "edit-net-label") return { tool: "Net label" };
  if (intent.kind !== "run-command") return null;
  const { command } = intent;
  if (command.id === "tool.activate")
    return command.tool === "wire" ? { tool: "Wire" } : null;
  const tools: Partial<Record<typeof command.id, string>> = {
    "drafting.add-text": "Text",
    "insert.open": "Insert",
    "insert.cell-pin": "Cell pin",
  };
  const tool = tools[command.id];
  return tool === undefined ? null : { tool };
}

/** Whether a modal dialog is open. `root` is injectable, absent without a DOM. */
export function modalDialogOpen(
  root: Pick<Document, "querySelector"> | undefined = typeof document ===
  "undefined"
    ? undefined
    : document,
): boolean {
  return Boolean(root?.querySelector('dialog[open], [aria-modal="true"]'));
}

/**
 * A drawing key never switches the page behind a modal dialog, from inside
 * an overlay or from the empty card: the router does not skip those scopes,
 * so the switch must. Overlays count by the key's target, so an open
 * non-modal one does not block keys pressed on the canvas.
 */
export function drawingSwitchBlocked(
  target: EventTarget | null,
  root: Pick<Document, "querySelector"> | undefined = typeof document ===
  "undefined"
    ? undefined
    : document,
): boolean {
  // Overlays that hold focus without being modal: a dialog or menu (the
  // Agent file approval, the selection filter, the formula popover, context
  // menus), an open header menu, the tab strip's open Shelf picker, and the
  // canvas text editor's toolbar.
  if (
    target instanceof Element &&
    target.closest(
      '[data-testid="auto-empty-state"], [role="dialog"], [role="menu"], .command-menu[open], .project-tabs-shelf[open], [data-canvas-text-editor-part]',
    )
  )
    return true;
  return modalDialogOpen(root);
}
