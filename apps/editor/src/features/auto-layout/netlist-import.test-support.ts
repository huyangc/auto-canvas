// A hand-written netlist imported as the editor imports it, for unit tests.
// Kept apart from the fixtures so browser specs do not load the editor's
// controller.
import type { CircuitProject } from "@icm/model";

import { EditorDocumentController } from "../../document/document-controller";
import { materializeRazaviProjectBulkConnections } from "../../presentation/razavi-presentation";
import { withImportedInstanceDisplays } from "../instance-display/imported-instance-displays";
import { importSchematic } from "../netlist-export/import-schematic";

/**
 * The Project the editor installs after File → Import → SPICE: the import
 * step's three calls (editor-file-commands.ts), the entry transform
 * (replaceActiveProject) and the controller's own parse.
 */
export async function importNetlistProject(
  text: string,
  path = "netlist.sp",
): Promise<CircuitProject> {
  const inputs = [{ path, bytes: new TextEncoder().encode(text) }];
  const result = await importSchematic(inputs, path, "native");
  const errors = result.diagnostics.filter((d) => d.severity === "error");
  if (!result.project || !result.successful || errors.length > 0)
    throw new Error(`Import failed: ${JSON.stringify(errors)}`);
  const installed = materializeRazaviProjectBulkConnections(
    withImportedInstanceDisplays(result.project),
  ).project;
  return new EditorDocumentController(installed).project;
}
