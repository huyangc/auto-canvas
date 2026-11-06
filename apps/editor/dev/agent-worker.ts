import {
  routeAgentSessionRequest,
  type AgentSessionRouterEnv,
} from "../../server/src/agent-relay/agent-session";

export { AgentSessionDO } from "../../server/src/agent-relay/agent-session";

// Local development uses the production Agent router and Durable Object, with
// no cloud account, production bindings, or built editor assets required.
export default {
  async fetch(request: Request, env: AgentSessionRouterEnv): Promise<Response> {
    return (
      (await routeAgentSessionRequest(request, env)) ??
      new Response("Not found", { status: 404 })
    );
  },
};
