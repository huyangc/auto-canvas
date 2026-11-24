import { accountKey } from "../accounts/storage";
// The startup recovery peek runs on every editor load; the scope subpath
// keeps the Agent adapter off that load (#1673).
import {
  isAgentSessionScope,
  type AgentSessionScope,
} from "@icm/agent-adapter/session-scope";
import {
  AGENT_SESSION_RECOVERY_STORAGE_KEY,
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

export function writeAgentSessionRecovery(
  storage: BrowserStorageLike,
  record: AgentSessionRecoveryRecord,
): void {
  storage.setItem(
    accountKey(AGENT_SESSION_RECOVERY_STORAGE_KEY),
    JSON.stringify(record),
  );
}

export function clearAgentSessionRecovery(storage: BrowserStorageLike): void {
  storage.removeItem(accountKey(AGENT_SESSION_RECOVERY_STORAGE_KEY));
}

/**
 * Removes the stored proof when it belongs to `target`'s working copy. One
 * storage slot serves every tab, so a proof another tab wrote is that tab's
 * to resume or retire: ending this session must not take it away.
 */
export function clearAgentSessionRecoveryFor(
  storage: BrowserStorageLike,
  target: RecoveryTarget,
): void {
  if (readAgentSessionRecovery(storage, target) !== null)
    clearAgentSessionRecovery(storage);
}

/**
 * Retires the proof of one relay session, whichever tab is displayed now: a
 * disconnect ends the session that wrote it, so its credentials must not come
 * back after a tab switch. Another session's proof is left in place.
 */
export function clearAgentSessionRecoveryOf(
  storage: BrowserStorageLike,
  sessionId: string,
): void {
  const record = peekAgentSessionRecovery(storage);
  if (record !== null && record.sessionId === sessionId)
    clearAgentSessionRecovery(storage);
}

/** Local recovery evidence, not an observation of relay availability. */
export function peekAgentSessionRecovery(
  storage: BrowserStorageLike,
): AgentSessionRecoveryRecord | null {
  try {
    return parseRecord(
      JSON.parse(
        storage.getItem(accountKey(AGENT_SESSION_RECOVERY_STORAGE_KEY)) ??
          "null",
      ),
    );
  } catch {
    return null;
  }
}

/**
 * Reads the same-tab reconnect proof for `target`. A proof written for another
 * Project or another working copy (another tab, a replaced Project) is not
 * evidence for this one: it reconnects nothing and is left in place.
 * Malformed records are removed before they can reach the relay.
 */
export function readAgentSessionRecovery(
  storage: BrowserStorageLike,
  target: RecoveryTarget,
): AgentSessionRecoveryRecord | null {
  const raw = storage.getItem(accountKey(AGENT_SESSION_RECOVERY_STORAGE_KEY));
  if (raw === null) return null;
  let candidate: unknown;
  try {
    candidate = JSON.parse(raw) as unknown;
  } catch {
    clearAgentSessionRecovery(storage);
    return null;
  }
  const record = parseRecord(candidate);
  if (record === null) {
    clearAgentSessionRecovery(storage);
    return null;
  }
  if (
    record.projectId !== target.projectId ||
    record.projectSessionId !== target.projectSessionId
  )
    return null;
  return record;
}
