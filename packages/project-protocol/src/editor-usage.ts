// Client-reported editor operations. Project API operations are recorded by the server.
export const editorUsageActions = [
  "editor.open",
  "mode.draw",
  "mode.auto",
  "netlist.import",
  "netlist.edit",
] as const;
export type RecordEditorUsage = (
  action: (typeof editorUsageActions)[number],
  result: "ok" | "failed",
) => void;
