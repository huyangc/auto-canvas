// Client-reported editor operations. Project API operations are recorded by the server.
export const editorUsageActions = [
  "editor.open",
  "mode.draw",
  "mode.auto",
  "netlist.import",
  "netlist.edit",
  "layout.auto",
  "export.svg",
  "export.raster",
  "export.netlist",
  "export.project",
] as const;
export type RecordEditorUsage = (
  action: (typeof editorUsageActions)[number],
  result: "ok" | "failed",
) => void;
