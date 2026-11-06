import { describe, expect, it } from "vitest";
import {
  isReadOnlyCircuitRequest,
  isReadOnlyProjectRequest,
} from "./request-replay.js";
import type { AgentCircuitRequest } from "./schema.js";

import type { AgentProjectResourceRequest } from "./project-resource.js";

describe("request replay classification", () => {
  it("reexecutes only circuit reads after result eviction", () => {
    expect(
      isReadOnlyCircuitRequest({
        operation: "snapshot",
      } as AgentCircuitRequest),
    ).toBe(true);
    expect(
      isReadOnlyCircuitRequest({
        operation: "transact",
      } as AgentCircuitRequest),
    ).toBe(false);
  });
  it("rereads the open candidate and dry runs while retaining mutation replay protection", () => {
    for (const request of [
      { action: "authoring-read" },
      { action: "authoring-apply", dryRun: true },
    ])
      expect(
        isReadOnlyProjectRequest({
          operation: "components",
          request,
        } as AgentProjectResourceRequest),
      ).toBe(true);
    for (const request of [
      { action: "authoring-update" },
      { action: "authoring-save" },
      { action: "authoring-apply", dryRun: false },
    ])
      expect(
        isReadOnlyProjectRequest({
          operation: "components",
          request,
        } as AgentProjectResourceRequest),
      ).toBe(false);
  });

  it("keeps Project mutation durable", () => {
    expect(
      isReadOnlyProjectRequest({
        operation: "workspace",
        request: { action: "list" },
      } as AgentProjectResourceRequest),
    ).toBe(true);
    expect(
      isReadOnlyProjectRequest({
        operation: "workspace",
        request: { action: "copy" },
      } as AgentProjectResourceRequest),
    ).toBe(false);
  });
});
