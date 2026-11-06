import type {
  EditDiagnostic,
  EditErrorCode,
  RejectedTransaction,
} from "./transaction-result.js";

/** Per-edit rejection seam supplied by the ordered transaction coordinator. */
export type RejectEdit = (
  code: EditErrorCode,
  message: string,
  diagnostics?: readonly EditDiagnostic[],
  objectIds?: readonly string[],
) => RejectedTransaction;

/** Internal mutation result shared by every typed edit dispatcher. */
export interface AppliedEditMutation {
  readonly ok: true;
  readonly connectivityChanged?: boolean;
  readonly geometryChanged?: boolean;
}

export interface RejectedEditMutation {
  readonly ok: false;
  readonly rejection: RejectedTransaction;
}

export type EditMutationOutcome = AppliedEditMutation | RejectedEditMutation;

export function rejectedEditMutation(
  reject: RejectEdit,
  ...args: Parameters<RejectEdit>
): RejectedEditMutation {
  return { ok: false, rejection: reject(...args) };
}
