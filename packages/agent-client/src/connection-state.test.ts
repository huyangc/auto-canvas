import { describe, expect, it } from "vitest";
import { connectionTransition, ConnectionTracker } from "./connection-state.js";

describe("connection state machine", () => {
  it("starts unpaired and reaches online through a claim", () => {
    const tracker = new ConnectionTracker(() => 0);
    expect(tracker.snapshot.state).toBe("unpaired");
    tracker.apply("claim-started");
    tracker.apply("request-succeeded");
    expect(tracker.snapshot.state).toBe("online");
    expect(tracker.snapshot.lastErrorCode).toBeNull();
  });

  it("tracks editor detachment and recovery without unpairing", () => {
    const tracker = new ConnectionTracker(() => 0);
    tracker.apply("claim-started");
    tracker.apply("request-succeeded");
    tracker.apply("editor-detached", "EDITOR_OFFLINE");
    expect(tracker.snapshot.state).toBe("editor-offline");
    expect(tracker.snapshot.lastErrorCode).toBe("EDITOR_OFFLINE");
    tracker.apply("request-succeeded");
    expect(tracker.snapshot.state).toBe("online");
  });

  it("revokes terminally and only reset returns to unpaired", () => {
    const tracker = new ConnectionTracker(() => 0);
    tracker.apply("claim-started");
    tracker.apply("request-succeeded");
    tracker.apply("credential-revoked", "SESSION_REVOKED");
    expect(tracker.snapshot.state).toBe("revoked");
    // A stale success cannot resurrect a revoked pairing.
    tracker.apply("request-succeeded");
    expect(tracker.snapshot.state).toBe("revoked");
    tracker.apply("reset");
    expect(tracker.snapshot.state).toBe("unpaired");
  });

  it("ignores events that do not apply to the current state", () => {
    expect(connectionTransition("unpaired", "request-succeeded")).toBe(
      "unpaired",
    );
    expect(connectionTransition("online", "claim-started")).toBe("online");
    expect(connectionTransition("revoked", "transport-interrupted")).toBe(
      "revoked",
    );
  });
});
