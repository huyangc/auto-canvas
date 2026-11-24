import { accountKey } from "../accounts/storage";
// The startup recovery peek runs on every editor load; the scope subpath
// keeps the Agent adapter off that load (#1673).
import {
  isAgentSessionScope,
  type AgentSessionScope,
} from "@icm/agent-adapter/session-scope";
import {
  AGENT_SESSION_RECOVERY_STORAGE_KEY,
  recoveryCandidates,
  type BrowserStorageLike,
} from "./session-recovery-presence";

export interface AgentSessionRecoveryRecord {
  readonly version: 1;
  readonly sessionId: string;
  readonly editorSecret: string;
  readonly projectId: string;
  readonly projectSessionId: string;
  readonly scopes: readonly AgentSessionScope[];
  readonly expiresAt: number;
}

export interface RecoveryTarget {
  readonly projectId: string;
  readonly projectSessionId: string;
  readonly now: number;
}

function parseRecord(value: unknown): AgentSessionRecoveryRecord | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (
    record.version !== 1 ||
    typeof record.sessionId !== "string" ||
    record.sessionId.length === 0 ||
    typeof record.editorSecret !== "string" ||
    record.editorSecret.length === 0 ||
    typeof record.projectId !== "string" ||
    record.projectId.length === 0 ||
    typeof record.projectSessionId !== "string" ||
    record.projectSessionId.length === 0 ||
    !Array.isArray(record.scopes) ||
    !record.scopes.every(isAgentSessionScope) ||
    typeof record.expiresAt !== "number" ||
    !Number.isFinite(record.expiresAt)
  ) {
    return null;
  }
  return {
    version: 1,
    sessionId: record.sessionId,
    editorSecret: record.editorSecret,
    projectId: record.projectId,
    projectSessionId: record.projectSessionId,
    scopes: [...record.scopes],
    expiresAt: record.expiresAt,
  };
}

function recordsFrom(raw: string | null): AgentSessionRecoveryRecord[] {
  return recoveryCandidates(raw)
    .map(parseRecord)
    .filter((record) => record !== null);
}

function storeRecords(
  storage: BrowserStorageLike,
  records: AgentSessionRecoveryRecord[],
) {
  if (records.length === 0) return clearAgentSessionRecovery(storage);
  storage.setItem(
    accountKey(AGENT_SESSION_RECOVERY_STORAGE_KEY),
    JSON.stringify(records.length === 1 ? records[0] : records),
  );
}

function matchesTarget(
  record: AgentSessionRecoveryRecord,
  target: Pick<RecoveryTarget, "projectId" | "projectSessionId">,
) {
  return (
    record.projectId === target.projectId &&
    record.projectSessionId === target.projectSessionId
  );
}

export function writeAgentSessionRecovery(
  storage: BrowserStorageLike,
  record: AgentSessionRecoveryRecord,
): void {
  const records = recordsFrom(
    storage.getItem(accountKey(AGENT_SESSION_RECOVERY_STORAGE_KEY)),
  );
  storeRecords(storage, [
    ...records.filter(
      (saved) =>
        saved.sessionId !== record.sessionId && !matchesTarget(saved, record),
    ),
    record,
  ]);
}

export function clearAgentSessionRecovery(storage: BrowserStorageLike): void {
  storage.removeItem(accountKey(AGENT_SESSION_RECOVERY_STORAGE_KEY));
}

function removeMatching(
  storage: BrowserStorageLike,
  matches: (record: AgentSessionRecoveryRecord) => boolean,
) {
  const records = recordsFrom(
    storage.getItem(accountKey(AGENT_SESSION_RECOVERY_STORAGE_KEY)),
  );
  const remaining = records.filter((record) => !matches(record));
  if (remaining.length !== records.length) storeRecords(storage, remaining);
}

export function clearAgentSessionRecoveryFor(
  storage: BrowserStorageLike,
  target: RecoveryTarget,
): void {
  removeMatching(storage, (record) => matchesTarget(record, target));
}

export function clearAgentSessionRecoveryOf(
  storage: BrowserStorageLike,
  sessionId: string,
): void {
  removeMatching(storage, (record) => record.sessionId === sessionId);
}

/** Read-only lookup for startup and for a live session following a tab switch. */
export function peekAgentSessionRecovery(
  storage: BrowserStorageLike,
  matches: (record: AgentSessionRecoveryRecord) => boolean,
): AgentSessionRecoveryRecord | null {
  try {
    return (
      recordsFrom(
        storage.getItem(accountKey(AGENT_SESSION_RECOVERY_STORAGE_KEY)),
      ).find(matches) ?? null
    );
  } catch {
    return null;
  }
}

export function readAgentSessionRecovery(
  storage: BrowserStorageLike,
  target: RecoveryTarget,
): AgentSessionRecoveryRecord | null {
  const raw = storage.getItem(accountKey(AGENT_SESSION_RECOVERY_STORAGE_KEY));
  const records = recordsFrom(raw);
  if (raw !== null && records.length === 0) clearAgentSessionRecovery(storage);
  return records.find((record) => matchesTarget(record, target)) ?? null;
}
