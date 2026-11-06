import type { SourceSpan } from "@icm/model";

export type SpiceDiagnosticSeverity = "info" | "warning" | "error";
export type SpiceDiagnosticStage = "source" | "syntax" | "bind" | "import";

export interface SpiceRelatedLocation {
  message: string;
  sourceRef: SourceSpan;
}

export interface SpiceDiagnostic {
  code: string;
  severity: SpiceDiagnosticSeverity;
  stage: SpiceDiagnosticStage;
  message: string;
  sourceRef?: SourceSpan;
  related?: SpiceRelatedLocation[];
}

export function diagnostic(
  code: string,
  severity: SpiceDiagnosticSeverity,
  stage: SpiceDiagnosticStage,
  message: string,
  sourceRef?: SourceSpan,
  related?: SpiceRelatedLocation[],
): SpiceDiagnostic {
  return {
    code,
    severity,
    stage,
    message,
    ...(sourceRef ? { sourceRef } : {}),
    ...(related && related.length > 0 ? { related } : {}),
  };
}
