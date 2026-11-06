import {
  AGENT_API_VERSION,
  AgentSimulationResourceRequestSchema,
} from "@icm/agent-adapter";
import { expect, it } from "vitest";
import { liveAgentEditor } from "./live-agent-editor.test-support";

it("does not advertise simulation and rejects every inherited operation without editing", async () => {
  const editor = liveAgentEditor();
  const before = JSON.stringify(editor.controller.project);
  await editor.client.connect("session-1.code");
  const { capabilities } = await editor.client.capabilities();
  expect(capabilities.resources?.simulation).toBeUndefined();
  expect(capabilities.resources?.file?.operations).not.toContain(
    "simulation-input",
  );
  for (const schema of AgentSimulationResourceRequestSchema.options) {
    const operation = schema.shape.operation.value;
    const response = await editor.simulationHost.handle({
      apiVersion: AGENT_API_VERSION,
      requestId: operation,
      operation,
    } as Parameters<typeof editor.simulationHost.handle>[0]);
    expect(response).toMatchObject({
      requestId: operation,
      operation,
      ok: false,
      error: { code: "SIMULATION_UNAVAILABLE", recovery: "fix-input" },
    });
  }
  const fileResponse = await editor.fileHost.handle({
    apiVersion: AGENT_API_VERSION,
    requestId: "files",
    operation: "simulation-input",
    input: { action: "transfer-capabilities" },
  });
  expect(fileResponse).toMatchObject({
    ok: false,
    error: { code: "SIMULATION_UNAVAILABLE" },
  });
  const plotResponse = await editor.fileHost.handle({
    apiVersion: AGENT_API_VERSION,
    requestId: "plot",
    operation: "download",
    artifact: "simulation-plot",
  });
  expect(plotResponse).toMatchObject({
    ok: false,
    error: { code: "SIMULATION_UNAVAILABLE" },
  });
  expect(JSON.stringify(editor.controller.project)).toBe(before);
});
