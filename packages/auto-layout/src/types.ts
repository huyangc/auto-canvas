import type { Instance } from "@icm/model";
import type { SchematicEdit } from "@icm/edit-engine";

export type Placement = NonNullable<Instance["placement"]>;
export type LayoutStrategy = "template" | "layered" | "stages";
export type NetRole = "supply" | "ground" | "input" | "output" | "internal";
/** Experimental block semantics, independent of the partition's source. */
export type BlockRole =
  | "bias"
  | "input"
  | "gain"
  | "output"
  | "load"
  | "cmfb"
  | "compensation"
  | "switch"
  | "logic"
  | "other";
export interface LayoutPartition {
  blocks: { id: string; title?: string; role?: BlockRole; members: string[] }[];
  /** Block ids in signal order, left to right; optional. */
  flow?: string[];
  /** Relative block centres in any common unit; enables the oracle floorplan. */
  arrangement?: Record<string, { x: number; y: number }>;
}
export interface AutoLayoutOptions {
  /** Experimental, internal; partitioned placement runs in quick mode only. */
  partition?: LayoutPartition;
  fixedInstanceIds?: ReadonlySet<string>;
  search?: {
    seed: number;
    evaluations: number;
    deadline?: number;
    signal?: AbortSignal;
    onProgress?: (p: {
      evaluations: number;
      best: number;
      current: number;
    }) => void;
  };
}
export interface AutoLayoutDiagnostic {
  severity: "error" | "warning";
  code: string;
  rule: string;
  message: string;
}
export interface RecognizedGroup {
  id: string;
  kind: "differential-pair" | "current-mirror" | "matched-pair";
  members: [string, string];
  facing?: "inward" | "outward";
  extraMemberIds?: string[];
  diodeInstanceId?: string;
  tailInstanceId?: string;
}
export interface SymmetryComponent {
  pairs: [string, string][];
  axis: string[];
  conflicted: string[];
}
export interface AutoLayoutResult {
  edits: SchematicEdit[];
  groups: RecognizedGroup[];
  diagnostics: AutoLayoutDiagnostic[];
}

export interface StructureMember {
  role:
    | "reference"
    | "output"
    | "input"
    | "tail"
    | "member"
    | "input-reference-side"
    | "input-output-side"
    | "load-reference"
    | "load-output";
  instanceIds: string[];
}
export interface Structure {
  kind:
    | "current-mirror"
    | "differential-pair"
    | "cross-coupled-pair"
    | "matched-pair"
    | "differential-pair-mirror-load"
    | "common-gate-pair";
  members: StructureMember[];
}
export interface Ambiguity {
  kind:
    | "mirror-reference"
    | "differential-pair"
    | "cross-coupled-pair"
    | "common-gate-pair"
    | "tail";
  netId?: string;
  instanceIds: string[];
}
