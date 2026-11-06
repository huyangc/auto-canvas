import { expect, it } from "vitest";
import {
  AgentFileResourceRequestSchema,
  AgentSessionMessageSchema,
  AgentSessionScopeSchema,
} from "@icm/agent-adapter";

it("rejects retired simulation file requests, scope and socket envelopes", () => {
  const base = { apiVersion: "3.0", requestId: "retired" };
  for (const request of [
    { ...base, operation: "simulation-input", input: { action: "list" } },
    { ...base, operation: "download", artifact: "simulation-plot" },
  ]) {
    expect(AgentFileResourceRequestSchema.safeParse(request).success).toBe(
      false,
    );
  }
  expect(AgentSessionScopeSchema.safeParse("simulation.run").success).toBe(
    false,
  );
  for (const kind of ["simulation-request", "simulation-response"]) {
    expect(
      AgentSessionMessageSchema.safeParse({
        protocolVersion: "1.0",
        sessionId: "session",
        messageId: "message",
        requestId: "retired",
        sentAt: "2026-11-06T00:00:00Z",
        kind,
        payload: {},
      }).success,
    ).toBe(false);
  }
});
