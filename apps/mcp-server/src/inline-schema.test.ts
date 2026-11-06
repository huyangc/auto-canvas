import { beforeAll, describe, expect, it } from "vitest";
import { inlineSchema } from "./inline-schema.js";
import { listToolDefinitions, toolInputSchema } from "./tools.js";

// The first tool listing builds every tool's contract: about a second
// alone, and past the 5 s a test gets beside the full suite on a CI runner.
// Each worker builds them once, here, outside any one test's time.
beforeAll(() => void listToolDefinitions(), 30_000);

describe("host-facing inline schemas", () => {
  it("does not rewrite authored default values as schemas", () => {
    const schema = { type: "object", default: { $ref: "authored-value" } };
    expect(inlineSchema(schema)).toEqual(schema);
  });
  it("exposes simple inspect fields directly in discovery and the on-demand contract", () => {
    const advertised = listToolDefinitions().find(
      (tool) => tool.name === "inspect",
    )!.inputSchema;
    for (const schema of [advertised, toolInputSchema("inspect")!]) {
      expect(schema.properties).toMatchObject({
        refresh: { type: "boolean", description: expect.any(String) },
        detail: { type: "string", enum: ["compact", "parts", "full"] },
      });
      expect(JSON.stringify(schema)).not.toContain('"allOf"');
    }
  });

  it("exposes retained operations and basic fields without reference resolution", () => {
    const tools = listToolDefinitions();
    for (const name of ["netlist_code", "export_file", "connect"]) {
      const schema = tools.find((tool) => tool.name === name)!.inputSchema;
      expect(JSON.stringify(schema)).not.toContain('"$ref"');
      expect(JSON.stringify(schema)).not.toContain('"$defs"');
    }
    const schema = tools.find(
      (tool) => tool.name === "export_file",
    )!.inputSchema;
    expect(schema.properties).toMatchObject({
      outputPath: { type: "string" },
      artifact: { type: "string", enum: ["project", "svg", "png", "pdf"] },
    });
    expect(
      tools.find((tool) => tool.name === "advanced_transact")!.inputSchema
        .properties,
    ).toMatchObject({ dryRun: { type: "boolean" } });
  });
});
