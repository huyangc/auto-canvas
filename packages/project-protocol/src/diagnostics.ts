import type { CircuitProject } from "@icm/model";

export type ProjectDiagnosticCode =
  | "INVALID_JSON"
  | "INVALID_PROJECT"
  | "UNSUPPORTED_SCHEMA_VERSION"
  | "UNKNOWN_DEVICE"
  | "INVALID_DEVICE_PIN"
  | "UNRESOLVED_REFERENCE";

export interface ProjectDiagnostic {
  readonly code: ProjectDiagnosticCode;
  readonly message: string;
  readonly path: ReadonlyArray<string | number>;
}

export interface ProjectParseResult {
  readonly project: CircuitProject;
  readonly sourceSchemaVersion: number;
  readonly migrated: boolean;
}

export type ProjectLoadResult =
  | ({ readonly ok: true } & ProjectParseResult)
  | { readonly ok: false; readonly diagnostics: readonly ProjectDiagnostic[] };

export class ProjectFormatError extends Error {
  readonly diagnostics: readonly ProjectDiagnostic[];

  constructor(diagnostics: readonly ProjectDiagnostic[]) {
    super(diagnostics.map((diagnostic) => diagnostic.message).join("; "));
    this.name = "ProjectFormatError";
    this.diagnostics = diagnostics;
  }
}
