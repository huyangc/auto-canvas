import {
  deriveElectricalTopologyProjection,
  endpointKey,
  resolveDocumentLogicalNets,
  resolveMosBulkConnection,
} from "@icm/derived";
import { deviceDescriptor } from "@icm/devices";
import {
  documentObjectIds,
  executeTransaction,
  type SchematicEdit,
} from "@icm/edit-engine";
import {
  deriveStableId,
  type Instance,
  type SchematicDocument,
} from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import { pinExit } from "./geometry.js";
import { classifyNets, isMos } from "./net-roles.js";
import { devicePins, isMarker } from "./placement-connectivity.js";
import { compareIds } from "./recognize.js";
import type { AutoLayoutDiagnostic } from "./types.js";

/** R163: SPICE node 0, the only name a Ground marker may carry. */
const GROUND_CLAIM = { name: "0", scope: "global", powerDomain: "ground" };
const MAX_INSTANCES = 120;

type Terminal = { instanceId: string; pinName: string };

export interface NetlistPresentation {
  edits: SchematicEdit[];
  /** The Document the edits produce; the input when there are none. */
  document: SchematicDocument;
  /** Added Ground markers and Cell Pins redrawn as supply symbols. */
  grounds: number;
  supplies: number;
  diagnostics: AutoLayoutDiagnostic[];
}

const warning = (code: string, message: string): AutoLayoutDiagnostic => ({
  severity: "warning",
  code,
  rule: "R163",
  message,
});

/** R163: the Ground Nets the pre-pass draws, by Base Net id: Nets already
 * claimed as ground. A ground marker names its Net node 0, so a Net named
 * otherwise (a `VSS` Cell Pin's Net without node 0) would be renamed: under
 * a node-0 export its Cell Pin would print as `0`. */
function groundNets(document: SchematicDocument): string[] {
  return [
    ...new Set(
      document.connectivityEvidence.flatMap((e) =>
        e.kind === "name-claim" && e.powerDomain === "ground" ? [e.netId] : [],
      ),
    ),
  ].sort(compareIds);
}

/** Whether a visible pin can host a ground marker under R6a: a MOS source or
 * drain, a two-pin device's pin, or a T127 extra host whose exit does not
 * leave away from the rail at the device's pose (its default one when the
 * import left it in the tray). */
function groundHost(
  instance: Instance,
  pins: string[],
  resolver: SymbolResolver,
): string | undefined {
  const resolved = resolver.resolve(
    instance.symbolId,
    instance.symbolVariantId,
  );
  const hidden = new Set(resolved?.variant?.hiddenPinNames ?? []);
  const visible = pins.filter((p) => !hidden.has(p)).sort(compareIds);
  if (isMos(instance.symbolId))
    return visible.find((p) => p === "S") ?? visible.find((p) => p === "D");
  if (devicePins(instance, resolver).length === 2) return visible[0];
  const pose = instance.placement ?? {
    position: { x: 0, y: 0 },
    rotation: 0 as const,
    mirror: "none" as const,
  };
  return visible.find((name) => {
    const pin = resolved?.definition.pins.find((p) => p.name === name);
    return pin && pinExit(pin, pose).y !== -1;
  });
}

/**
 * R163: rail symbols for a Document that carries only its netlist. One
 * `ground` marker per device with an R6a host pin on each Ground Net that has
 * none, each with node 0's claim, on the same Base Net, so R6a/R12 seat each
 * at its own pin; a supply Cell Pin drawn as a `port` becomes a `vdd-port`.
 * The edits are kept only when the replay keeps the Document's connectivity.
 */
export function netlistPresentation(
  document: SchematicDocument,
  resolver: SymbolResolver,
): NetlistPresentation {
  const none = (diagnostics: AutoLayoutDiagnostic[] = []) => ({
    edits: [],
    document,
    grounds: 0,
    supplies: 0,
    diagnostics,
  });
  if (document.instances.length > MAX_INSTANCES)
    return none([
      warning(
        "AUTO_LAYOUT_NETLIST_PRESENTATION_SKIPPED",
        `R163: rail symbols skipped above the R3 limit of ${MAX_INSTANCES} instances`,
      ),
    ]);
  const projection = deriveElectricalTopologyProjection(document, resolver);
  const netOf = (t: Terminal) =>
    projection.endpointToBaseNet.get(endpointKey({ kind: "terminal", ...t }));
  const occupied = new Set(documentObjectIds(document));
  const fresh = (kind: string, ...parts: string[]) => {
    for (let salt = 0; ; salt++) {
      const id = deriveStableId(
        `auto-layout-netlist-${kind}`,
        ...parts,
        String(salt),
      );
      if (!occupied.has(id)) {
        occupied.add(id);
        return id;
      }
    }
  };
  const interfaces = new Set(
    (document.netlist?.terminals ?? []).flatMap((t) => t.interfaceInstanceIds),
  );
  const diagnostics: AutoLayoutDiagnostic[] = [];
  const edits: SchematicEdit[] = [];
  const grounds = groundNets(document);
  let groundCount = 0;
  const pinsOn = (instance: Instance, net: string) =>
    devicePins(instance, resolver)
      .map((p) => p.name)
      .filter((pinName) => netOf({ instanceId: instance.id, pinName }) === net);
  for (const net of grounds) {
    const instances = document.instances.filter(
      (i) => pinsOn(i, net).length > 0,
    );
    if (instances.some((i) => i.symbolId === "ground")) continue;
    const hosts = [...instances]
      .sort((a, b) => compareIds(a.id, b.id))
      .flatMap((instance) => {
        if (
          isMarker(instance) ||
          interfaces.has(instance.id) ||
          deviceDescriptor(instance.symbolId)?.deviceClass === "net-marker"
        )
          return [];
        const host = groundHost(instance, pinsOn(instance, net), resolver);
        return host ? [{ instance, host }] : [];
      });
    // A Cell Pin on the Net is wired to one marker host anyway (R12/R43):
    // a lone device would get a marker beside that wire and remove none.
    if (hosts.length === 1 && instances.some((i) => interfaces.has(i.id)))
      continue;
    for (const { instance, host } of hosts) {
      const id = fresh("ground", net, instance.id);
      edits.push(
        {
          kind: "add_instance",
          instance: { id, symbolId: "ground", placement: null },
        },
        {
          kind: "connect_endpoints",
          from: { kind: "terminal", instanceId: instance.id, pinName: host },
          to: { kind: "terminal", instanceId: id, pinName: "0" },
          newNetId: net,
        },
        {
          kind: "upsert_connectivity_evidence",
          evidence: {
            id: fresh("claim", id),
            kind: "name-claim",
            netId: net,
            ...GROUND_CLAIM,
            owner: { kind: "power-marker", objectId: id },
          } as Extract<
            SchematicDocument["connectivityEvidence"][number],
            { kind: "name-claim" }
          >,
        },
      );
      groundCount++;
    }
  }
  // A supply symbol gives its Net the supply domain. The design export
  // already ranks a Cell Pin named VDD as the supply; any other name (AVDD,
  // vdd!), or several candidates, would move in the exported Cell pins, so
  // they keep their ports.
  const roles = classifyNets(document, resolver);
  const supplyPins = (document.netlist?.terminals ?? []).flatMap((terminal) => {
    const [instanceId] = terminal.interfaceInstanceIds;
    const instance = document.instances.find((i) => i.id === instanceId);
    return terminal.interfaceInstanceIds.length === 1 &&
      instance?.symbolId === "port" &&
      roles.byNet.get(terminal.netId) === "supply" &&
      terminal.name.toUpperCase() === "VDD" &&
      !document.connectivityEvidence.some(
        (e) => e.kind === "name-claim" && e.netId === terminal.netId,
      ) &&
      !document.instances.some(
        (i) =>
          i.symbolId === "vdd-port" &&
          netOf({ instanceId: i.id, pinName: "P" }) === terminal.netId,
      )
      ? [instance.id]
      : [];
  });
  if (supplyPins.length > 1)
    diagnostics.push(
      warning(
        "AUTO_LAYOUT_NETLIST_SUPPLY_AMBIGUOUS",
        `R163: ${supplyPins.length} supply Cell Pins keep their ports`,
      ),
    );
  const [supplyPin] = supplyPins;
  const supplies = supplyPins.length === 1 && supplyPin ? 1 : 0;
  if (supplies && supplyPin)
    edits.push({
      kind: "set_instance_symbol",
      instanceId: supplyPin,
      symbolId: "vdd-port",
    });
  if (!edits.length) return none(diagnostics);
  if (document.instances.length + groundCount > MAX_INSTANCES)
    return none([
      ...diagnostics,
      warning(
        "AUTO_LAYOUT_NETLIST_PRESENTATION_SKIPPED",
        `R163: ${groundCount} ground symbols would exceed the R3 limit of ${MAX_INSTANCES} instances`,
      ),
    ]);
  const replay = executeTransaction(
    document,
    {
      transactionId: "auto-layout-netlist-presentation",
      documentId: document.id,
      expectedRevision: document.revision,
      actor: { kind: "agent", id: "auto-layout" },
      dryRun: true,
      edits,
    },
    { symbolResolver: resolver },
  );
  const failure = replay.ok
    ? presentationChange(document, replay.document, resolver)
    : `transaction rejected (${replay.diagnostics.map((d) => d.code).join(", ")})`;
  if (failure || !replay.ok)
    return none([
      ...diagnostics,
      warning(
        "AUTO_LAYOUT_NETLIST_PRESENTATION_DROPPED",
        `R163: rail symbols dropped: ${failure}`,
      ),
    ]);
  return {
    edits,
    document: replay.document,
    grounds: groundCount,
    supplies,
    diagnostics,
  };
}

/**
 * R163 gate: what the presentation edits may change, and nothing else. Every
 * original terminal keeps its Base Net and Logical Net partition, Cell
 * terminals and name claims stay, MOS bodies resolve as before, the only
 * symbol change is `port` to `vdd-port` on a Cell Pin, and every added
 * instance is a ground marker with node 0's claim on its own Base Net.
 * Returns the first difference, or undefined.
 */
export function presentationChange(
  before: SchematicDocument,
  after: SchematicDocument,
  resolver: SymbolResolver,
): string | undefined {
  const a = deriveElectricalTopologyProjection(before, resolver);
  const b = deriveElectricalTopologyProjection(after, resolver);
  const la = resolveDocumentLogicalNets(before);
  const lb = resolveDocumentLogicalNets(after);
  const interfaces = new Set(
    (before.netlist?.terminals ?? []).flatMap((t) => t.interfaceInstanceIds),
  );
  const keys: string[] = [];
  for (const instance of before.instances) {
    const kept = after.instances.find((i) => i.id === instance.id);
    if (!kept) return `instance ${instance.id} removed`;
    if (
      kept.symbolVariantId !== instance.symbolVariantId ||
      (kept.symbolId !== instance.symbolId &&
        !(
          instance.symbolId === "port" &&
          kept.symbolId === "vdd-port" &&
          interfaces.has(instance.id)
        ))
    )
      return `instance ${instance.id} changed symbol`;
    const pins = (i: Instance) =>
      (resolver.resolve(i.symbolId, i.symbolVariantId)?.definition.pins ?? [])
        .map((p) => p.name)
        .sort(compareIds);
    if (JSON.stringify(pins(instance)) !== JSON.stringify(pins(kept)))
      return `instance ${instance.id} changed pins`;
    for (const pinName of pins(instance))
      keys.push(
        endpointKey({ kind: "terminal", instanceId: instance.id, pinName }),
      );
  }
  const partition = (group: (key: string) => string) => {
    const groups = new Map<string, string[]>();
    for (const key of keys) {
      const id = group(key);
      groups.set(id, [...(groups.get(id) ?? []), key]);
    }
    return JSON.stringify([...groups.values()].map((g) => g.sort()).sort());
  };
  const base = (p: typeof a) => (key: string) =>
    p.endpointToBaseNet.get(key) ?? key;
  if (partition(base(a)) !== partition(base(b)))
    return "Base Net partition changed";
  const logical =
    (p: typeof a, l: typeof la) =>
    (key: string): string => {
      const net = p.endpointToBaseNet.get(key);
      return (net && l.byBaseNetId.get(net)?.id) ?? net ?? key;
    };
  if (partition(logical(a, la)) !== partition(logical(b, lb)))
    return "Logical Net partition changed";
  const supplied = new Set(
    after.instances.flatMap((i) =>
      i.symbolId === "vdd-port" &&
      before.instances.find((j) => j.id === i.id)?.symbolId === "port"
        ? [
            b.endpointToBaseNet.get(
              endpointKey({ kind: "terminal", instanceId: i.id, pinName: "P" }),
            ),
          ]
        : [],
    ),
  );
  for (const net of before.nets) {
    const was = la.byBaseNetId.get(net.id);
    const is = lb.byBaseNetId.get(net.id);
    if (
      was?.name !== is?.name ||
      was?.scope !== is?.scope ||
      (was?.powerDomain !== is?.powerDomain &&
        !(
          supplied.has(net.id) &&
          was?.powerDomain === "none" &&
          is?.powerDomain === "vdd"
        ))
    )
      return `Net ${net.id} renamed`;
  }
  if (
    canonical(before.netlist?.terminals ?? []) !==
    canonical(after.netlist?.terminals ?? [])
  )
    return "Cell terminals changed";
  for (const claim of before.connectivityEvidence)
    if (
      !after.connectivityEvidence.some((e) => canonical(e) === canonical(claim))
    )
      return `evidence ${claim.id} changed`;
  for (const instance of before.instances) {
    if (!isMos(instance.symbolId)) continue;
    const was = resolveMosBulkConnection(before, instance.id, la);
    const is = resolveMosBulkConnection(after, instance.id, lb);
    if (was?.status !== is?.status || was?.net?.id !== is?.net?.id)
      return `MOS body ${instance.id} resolves differently`;
  }
  const originals = new Set(before.instances.map((i) => i.id));
  for (const added of after.instances.filter((i) => !originals.has(i.id))) {
    const net = b.endpointToBaseNet.get(
      endpointKey({ kind: "terminal", instanceId: added.id, pinName: "0" }),
    );
    const claims = after.connectivityEvidence.filter(
      (e) =>
        e.kind === "name-claim" &&
        e.owner.kind === "power-marker" &&
        e.owner.objectId === added.id,
    );
    const [claim] = claims;
    if (
      added.symbolId !== "ground" ||
      added.symbolVariantId !== undefined ||
      !net ||
      !before.nets.some((n) => n.id === net) ||
      claims.length !== 1 ||
      claim?.kind !== "name-claim" ||
      claim.netId !== net ||
      claim.name !== GROUND_CLAIM.name ||
      claim.scope !== GROUND_CLAIM.scope ||
      claim.powerDomain !== GROUND_CLAIM.powerDomain
    )
      return `added instance ${added.id} is not a ground marker of node 0`;
  }
  const added = after.connectivityEvidence.filter(
    (e) => !before.connectivityEvidence.some((old) => old.id === e.id),
  );
  if (
    added.some(
      (e) =>
        e.kind !== "name-claim" ||
        e.owner.kind !== "power-marker" ||
        originals.has(e.owner.objectId),
    )
  )
    return "unexpected evidence added";
  return undefined;
}

/** JSON with sorted object keys, so equal facts compare equal. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v as Record<string, unknown>).sort(([a], [b]) =>
            compareIds(a, b),
          ),
        )
      : v,
  );
}
