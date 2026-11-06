import { operationDefinitions } from "./operations.js";
import type { ContractTool } from "./tool-contracts.js";
import { FOCUSED_TOOLS } from "./focused-tools.js";
import { declarationSchema } from "./declaration-schema.js";
import { inlineSchema } from "./inline-schema.js";
import { compactSchema } from "./compact-schema.js";

export function listToolDefinitions(): ContractTool[] {
  return operationDefinitions().map((definition) => {
    const schema = definition.inputSchema;
    if (FOCUSED_TOOLS.some((tool) => tool.name === definition.name))
      return {
        ...definition,
        inputSchema: declarationSchema(schema, definition.name),
      };
    if (definition.name === "connect")
      return { ...definition, inputSchema: inlineSchema(schema) };
    const compact = compactSchema(schema);
    const advertised =
      JSON.stringify(compact).length < JSON.stringify(schema).length
        ? compact
        : schema;
    if (definition.name === "advanced_transact") {
      const properties = advertised.properties as Record<string, unknown>;
      properties.dryRun = (
        inlineSchema(schema).properties as Record<string, unknown>
      ).dryRun;
    }
    return {
      ...definition,
      inputSchema: advertised,
    };
  });
}
