import { createEmptyDocument } from "@icm/model";
import type { SchematicDocument } from "@icm/model";

export function circuit(
  symbols: Record<string, string>,
  nets: Record<string, string[]>,
): SchematicDocument {
  const document = createEmptyDocument("test", "Test");
  document.instances = Object.entries(symbols).map(([id, symbolId]) => ({
    id,
    symbolId,
    placement: null,
  }));
  document.nets = Object.entries(nets).map(([id, terminals]) => ({
    id,
    terminals: terminals.map((terminal) => {
      const [instanceId, pinName] = terminal.split(".");
      return { instanceId: instanceId!, pinName: pinName! };
    }),
  }));
  return document;
}
