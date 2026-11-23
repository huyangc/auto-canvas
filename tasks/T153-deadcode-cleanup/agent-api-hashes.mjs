#!/usr/bin/env node
// T153: print the SHA-256 of the three serialized Agent API artifact values the
// generator would write (scripts/agent-api-artifacts.mjs), without writing them.
// Build the adapter first: pnpm --filter @icm/agent-adapter... build
import { createHash } from "node:crypto";

import {
  agentCircuitRequestJsonSchema,
  agentCircuitResponseJsonSchema,
  agentCircuitOpenApi,
} from "../../packages/agent-adapter/dist/index.js";

for (const [name, value] of [
  ["agent-circuit-request.schema.json", agentCircuitRequestJsonSchema()],
  ["agent-circuit-response.schema.json", agentCircuitResponseJsonSchema()],
  ["agent-circuit.openapi.json", agentCircuitOpenApi],
]) {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  console.log(`${createHash("sha256").update(text).digest("hex")}  ${name}`);
}
