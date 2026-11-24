import { describe, expect, it } from "vitest";

import {
  clearAgentSessionRecovery,
  clearAgentSessionRecoveryFor,
  clearAgentSessionRecoveryOf,
  peekAgentSessionRecovery,
  readAgentSessionRecovery,
  writeAgentSessionRecovery,
} from "./session-recovery";
import {
  AGENT_SESSION_RECOVERY_STORAGE_KEY,
  hasAgentSessionRecovery,
  type BrowserStorageLike,
} from "./session-recovery-presence";

class MemoryStorage implements BrowserStorageLike {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

const target = {
  projectId: "project-main",
  projectSessionId: "project-main:1",
  now: 1_000,
};

function record() {
  return {
    version: 1 as const,
    sessionId: "session-1",
    editorSecret: "editor-secret",
    projectId: target.projectId,
    projectSessionId: target.projectSessionId,
    scopes: [
      "circuit.snapshot",
      "editor.semantic-control",
      "project.download",
      "project.import",
      "visual.download",
    ] as const,
    expiresAt: 2_000,
  };
}

describe("Agent same-browser session recovery", () => {
  it("retires a proof by the session that wrote it, whichever tab is shown", () => {
    const storage = new MemoryStorage();
    writeAgentSessionRecovery(storage, record());
    // Another session's id leaves this proof in place.
    clearAgentSessionRecoveryOf(storage, "another-session");
    expect(peekAgentSessionRecovery(storage)).toEqual(record());
    clearAgentSessionRecoveryOf(storage, record().sessionId);
    expect(peekAgentSessionRecovery(storage)).toBeNull();
  });

  it("round-trips only the bounded browser reconnect proof", () => {
    const storage = new MemoryStorage();
    writeAgentSessionRecovery(storage, record());

    expect(readAgentSessionRecovery(storage, target)).toEqual(record());
    expect(hasAgentSessionRecovery(storage)).toBe(true);
    expect(storage.getItem(AGENT_SESSION_RECOVERY_STORAGE_KEY)).not.toContain(
      "agentToken",
    );
    expect(storage.getItem(AGENT_SESSION_RECOVERY_STORAGE_KEY)).not.toContain(
      "claimCode",
    );
  });

  it("checks Gallery recovery presence without accepting malformed storage", () => {
    const storage = new MemoryStorage();
    expect(hasAgentSessionRecovery(storage)).toBe(false);
    storage.setItem(AGENT_SESSION_RECOVERY_STORAGE_KEY, "not-json");
    expect(hasAgentSessionRecovery(storage)).toBe(false);
    storage.setItem(
      AGENT_SESSION_RECOVERY_STORAGE_KEY,
      JSON.stringify({ ...record(), sessionId: "" }),
    );
    expect(hasAgentSessionRecovery(storage)).toBe(false);
  });

  it("deletes malformed records and reconnects only the working copy it was written for", () => {
    const storage = new MemoryStorage();
    storage.setItem(AGENT_SESSION_RECOVERY_STORAGE_KEY, "not-json");
    expect(readAgentSessionRecovery(storage, target)).toBeNull();
    expect(storage.getItem(AGENT_SESSION_RECOVERY_STORAGE_KEY)).toBeNull();

    writeAgentSessionRecovery(storage, { ...record(), expiresAt: target.now });
    expect(readAgentSessionRecovery(storage, target)).toEqual({
      ...record(),
      expiresAt: target.now,
    });

    // A proof from another working copy (another tab, a replaced Project)
    // is not evidence for this one.
    writeAgentSessionRecovery(storage, record());
    expect(
      readAgentSessionRecovery(storage, {
        ...target,
        projectSessionId: "different-project:1",
      }),
    ).toBeNull();
    expect(
      readAgentSessionRecovery(storage, { ...target, projectId: "other" }),
    ).toBeNull();
    expect(readAgentSessionRecovery(storage, target)).toEqual(record());
  });

  it("clears recovery only when a terminal lifecycle action requests it", () => {
    const storage = new MemoryStorage();
    writeAgentSessionRecovery(storage, record());
    clearAgentSessionRecovery(storage);
    expect(storage.getItem(AGENT_SESSION_RECOVERY_STORAGE_KEY)).toBeNull();
  });

  it("retires only the proof of the working copy that retires it", () => {
    const storage = new MemoryStorage();
    writeAgentSessionRecovery(storage, record());
    // Another tab ending its session leaves this proof where its own tab can
    // still resume it.
    clearAgentSessionRecoveryFor(storage, {
      ...target,
      projectSessionId: "another-tab",
    });
    expect(readAgentSessionRecovery(storage, target)).toEqual(record());
    clearAgentSessionRecoveryFor(storage, target);
    expect(storage.getItem(AGENT_SESSION_RECOVERY_STORAGE_KEY)).toBeNull();
  });
});
