"use client";

/**
 * auto-canvas's entry in silicon-notebook: one `workspace.side_panel` button,
 * 打开电路画布, in an opened notebook's Sources panel. Its click takes the
 * signed-in user to `/canvas`, where the canvas editor opens as that same
 * user (it reads the notebook's own session from this origin). No notebook
 * or source context is passed on.
 *
 * The backend half is `silicon_notebook_auto_canvas.bundle.BUNDLE`: its
 * manifest's `id` and `version`, and its UI declaration's `id`, `slot` and
 * `capability`, match `ui-plugin.json` character for character, or the
 * browser's (plugin_id, version, contribution_id) lookup finds nothing and
 * the entry does not render. `scripts/notebook-launcher.test.mjs` in
 * auto-canvas compares them.
 *
 * Imports: `lucide-react` only (silicon-notebook's plugin allow-list). The
 * look is the system's own entry button class; nothing here fetches, starts
 * a timer or opens a window.
 */
import { CircuitBoard } from "lucide-react";

export function AutoCanvasEntry() {
  return (
    <button
      type="button"
      className="button secondary workspace-extension-entry"
      aria-label="打开电路画布"
      title="在当前页面打开电路画布"
      onClick={() => window.location.assign("/canvas")}
    >
      <CircuitBoard size={15} aria-hidden="true" />
      <span>打开电路画布</span>
    </button>
  );
}
