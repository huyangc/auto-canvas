import {
  endpointKey,
  resolveDocumentLogicalNets,
  resolveEndpointConnection,
} from "@icm/derived";
import {
  executeProjectTransaction,
  proposeWireCommit,
  type ProjectStructureEdit,
  type SchematicEdit,
  type WireSource,
} from "@icm/edit-engine";
import {
  deriveStableId,
  routeEndpoints,
  type CircuitProject,
  type SchematicDocument,
  type RouteEndpoint,
} from "@icm/model";
import { builtInSymbols, createProjectSymbolResolver } from "@icm/symbols";

export interface NodeChange {
  documentId: string;
  instanceId: string;
  pinName: string;
  targetId: string;
}

export function planNodeEdits(
  project: CircuitProject,
  changes: NodeChange[],
  fieldEdits: ProjectStructureEdit[],
): ProjectStructureEdit[] {
  const resolver = createProjectSymbolResolver(project, builtInSymbols);
  const editedCells = new Set(changes.map((c) => c.documentId));
  const edits = fieldEdits.filter(
    (e) => e.kind !== "transact_document" || !editedCells.has(e.documentId),
  );
  for (const document of project.documents) {
    const local = changes.filter((c) => c.documentId === document.id);
    if (!local.length) continue;
    const pins = local.map((c) => ({
      kind: "terminal" as const,
      instanceId: c.instanceId,
      pinName: c.pinName,
    }));
    const changed = new Set(pins.map(endpointKey));
    const detach: SchematicEdit[] = [];
    for (const route of document.routes) {
      if (!routeEndpoints(route).some((e) => changed.has(endpointKey(e))))
        continue;
      if (route.members)
        throw Error("Edit bus member connections on the canvas.");
      detach.push({ kind: "remove_route_geometry", routeId: route.id });
    }
    const attach: SchematicEdit[] = [];
    const nets = resolveDocumentLogicalNets(document);
    for (const { instanceId, pinName, targetId: target } of local) {
      const pin = { kind: "terminal" as const, instanceId, pinName };
      const connection = resolveEndpointConnection(document, resolver, pin);
      if (!connection)
        throw Error("This pin has no drawable connection point.");
      if (
        !document.nets.some((n) =>
          n.terminals.some(
            (t) =>
              t.instanceId === pin.instanceId &&
              t.pinName === pin.pinName &&
              !t.memberId,
          ),
        )
      )
        throw Error("This pin has no scalar net connection.");
      detach.push({ kind: "disconnect_endpoint", endpoint: pin });
      let nearest: WireSource | undefined;
      let distance = Infinity;
      for (const net of document.nets) {
        if (nets.byBaseNetId.get(net.id)?.id !== target) continue;
        const endpoints: RouteEndpoint[] = [
          ...net.terminals.map((t) => ({ kind: "terminal" as const, ...t })),
          ...document.junctions
            .filter((j) => j.netId === net.id && !j.members && !j.contactAnchor)
            .map((j) => ({ kind: "junction" as const, junctionId: j.id })),
        ];
        for (const endpoint of endpoints) {
          if (endpoint.memberId || changed.has(endpointKey(endpoint))) continue;
          const other = resolveEndpointConnection(document, resolver, endpoint);
          if (!other) continue;
          const delta =
            Math.abs(other.contactPoint.x - connection.contactPoint.x) +
            Math.abs(other.contactPoint.y - connection.contactPoint.y);
          if (delta >= distance) continue;
          distance = delta;
          nearest = {
            endpoint,
            connection: other,
            netId: net.id,
            preludeEdits: [],
          };
        }
      }
      if (!nearest)
        throw Error("The destination net needs a drawable connection point.");
      const routeId = deriveStableId(
        "route",
        document.id,
        String(document.revision),
        endpointKey(pin),
        target,
      );
      attach.push(
        ...proposeWireCommit(
          { endpoint: pin, connection, netId: null, preludeEdits: [] },
          nearest,
          [],
          { routeId, newNetId: target },
        ).edits,
      );
    }
    for (const field of fieldEdits) {
      if (
        field.kind === "transact_document" &&
        field.documentId === document.id
      )
        attach.push(...field.edits);
    }
    // Publish both phases in one project transaction. A disconnected pin
    // must leave its previous physical component before it joins another.
    edits.push(
      {
        kind: "transact_document",
        documentId: document.id,
        expectedRevision: document.revision,
        edits: detach,
      },
      {
        kind: "transact_document",
        documentId: document.id,
        expectedRevision: document.revision + 1,
        edits: attach,
      },
    );
  }
  // Geometry can identify touching pins during a transaction. Verify the
  // resulting membership before handing the edits to the undoable command.
  const staged = executeProjectTransaction(project, {
    projectId: project.id,
    expectedStructureRevision: project.structureRevision,
    transactionId: "preview-netlist-connections",
    actor: { kind: "human", id: "netlist-editor" },
    edits,
  });
  if (!staged.ok) throw Error(staged.error.message);
  for (const document of project.documents) {
    if (!editedCells.has(document.id)) continue;
    const expected = pinNets(document);
    for (const change of changes.filter((c) => c.documentId === document.id))
      expected.set(
        endpointKey({
          kind: "terminal",
          instanceId: change.instanceId,
          pinName: change.pinName,
        }),
        change.targetId,
      );
    const updated = staged.project.documents.find((d) => d.id === document.id);
    if (!updated) throw Error("The edited Cell no longer exists.");
    const actual = pinNets(updated);
    if (
      actual.size !== expected.size ||
      [...expected].some(([pin, id]) => actual.get(pin) !== id)
    )
      throw Error(
        "The wire would change another connection. Adjust the wire on the canvas.",
      );
  }
  return edits;
}

function pinNets(document: SchematicDocument) {
  const logical = resolveDocumentLogicalNets(document);
  const result = new Map<string, string>();
  for (const net of document.nets) {
    const group = logical.byBaseNetId.get(net.id);
    if (!group) throw Error("A connection does not have a logical net.");
    for (const pin of net.terminals)
      result.set(endpointKey({ kind: "terminal", ...pin }), group.id);
  }
  return result;
}
