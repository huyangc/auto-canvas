import { prepareDocumentFormulaArtifacts } from "@icm/derived";
import type { CircuitProject } from "@icm/model";
import { renderDocumentSvg } from "@icm/render-svg";
import { builtInSymbols, createProjectSymbolResolver } from "@icm/symbols";

export async function renderPreview(project: CircuitProject): Promise<string> {
  try {
    const document = project.documents.find(
      (entry) => entry.id === project.topDocumentId,
    )!;
    const prepared = await prepareDocumentFormulaArtifacts(document);
    try {
      return renderDocumentSvg(
        document,
        createProjectSymbolResolver(project, builtInSymbols),
      );
    } finally {
      prepared.release();
    }
  } catch {
    // A drawing that cannot be rendered still saves; the shelf has a placeholder.
    return "";
  }
}
