import type { Instance } from "@icm/model";
import type { SchematicEdit } from "@icm/edit-engine";

export type Placement = NonNullable<Instance["placement"]>;
export type NetRole = "supply" | "ground" | "input" | "output" | "internal";
export interface AutoLayoutOptions {
  fixedInstanceIds?: ReadonlySet<string>;
}
export interface AutoLayoutDiagnostic {
  code: string;
  rule: string;
  message: string;
}
export interface RecognizedGroup {
  id: string;
  kind: "differential-pair" | "current-mirror" | "matched-pair";
  members: [string, string];
  diodeInstanceId?: string;
  tailInstanceId?: string;
}
export interface AutoLayoutResult {
  edits: SchematicEdit[];
  groups: RecognizedGroup[];
  diagnostics: AutoLayoutDiagnostic[];
}
