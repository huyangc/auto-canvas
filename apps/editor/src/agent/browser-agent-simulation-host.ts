import {
  AGENT_API_VERSION,
  type AgentSimulationResourceRequest,
  type AgentSimulationResourceResponse,
} from "@icm/agent-adapter";

/** The inherited Agent API remains on the wire until T007 retires it. */
export class BrowserAgentSimulationHost {
  async handle(
    request: AgentSimulationResourceRequest,
  ): Promise<AgentSimulationResourceResponse> {
    return {
      apiVersion: AGENT_API_VERSION,
      requestId: request.requestId,
      operation: request.operation,
      ok: false,
      error: {
        code: "SIMULATION_UNAVAILABLE",
        message:
          "Simulation is unavailable in auto-canvas. Export a netlist to simulate externally.",
        stage: "input",
        recovery: "fix-input",
      },
    };
  }
}
