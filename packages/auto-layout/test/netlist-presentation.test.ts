import { deriveElectricalTopologyProjection, endpointKey } from "@icm/derived";
import { executeTransaction } from "@icm/edit-engine";
import type { SchematicDocument } from "@icm/model";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { afterEach, describe, expect, it, vi } from "vitest";
import { planAutoLayout } from "../src/auto-layout.js";
import * as presentationModule from "../src/netlist-presentation.js";
import {
  netlistPresentation,
  presentationChange,
} from "../src/netlist-presentation.js";
import { equivalentTerminals } from "../src/transaction.js";
import { circuit } from "./document-fixture.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);

/** A Cell Pin drawn as a `port`, as the SPICE import gives one. */
function cellPin(document: SchematicDocument, name: string, netId: string) {
  const id = `pin-${name}`;
  document.instances.push({ id, symbolId: "port", placement: null });
  document.nets
    .find((n) => n.id === netId)!
    .terminals.push({ instanceId: id, pinName: "P" });
  document.netlist = {
    name: "Main",
    terminals: [
      ...(document.netlist?.terminals ?? []),
      {
        id: `terminal-${name}`,
        name,
        netId,
        direction: "passive",
        interfaceInstanceIds: [id],
      },
    ],
    formalParameters: [],
  };
}

/** Node 0 as a SPICE deck states it: a global declaration, no marker. */
function nodeZero(document: SchematicDocument, netId: string) {
  document.connectivityEvidence.push(
    { id: `source-${netId}`, kind: "spice-source", netId, sourceNetId: netId },
    {
      id: `claim-${netId}`,
      kind: "name-claim",
      netId,
      name: "0",
      scope: "global",
      powerDomain: "ground",
      owner: { kind: "global-declaration", sourceNetId: netId },
    },
  );
}

const amplifier = () =>
  circuit(
    { m1: "nmos", m2: "nmos", r1: "resistor", c1: "capacitor", r2: "resistor" },
    {
      gnd: ["m1.S", "m2.G", "r1.2", "c1.2"],
      out: ["m1.D", "r1.1", "c1.1", "r2.2"],
      in: ["m1.G", "m2.D", "r2.1"],
      tail: ["m2.S"],
    },
  );

const grounds = (document: SchematicDocument) =>
  document.instances.filter((i) => i.symbolId === "ground");

const replay = (document: SchematicDocument, edits: unknown[]) =>
  executeTransaction(
    document,
    {
      transactionId: "test",
      documentId: document.id,
      expectedRevision: document.revision,
      actor: { kind: "agent", id: "test" },
      dryRun: true,
      edits: edits as never,
    },
    { symbolResolver: resolver },
  );

describe("R163 netlist presentation", () => {
  it("gives each grounded device on node 0 its own ground marker", () => {
    const source = amplifier();
    nodeZero(source, "gnd");
    const result = netlistPresentation(source, resolver);
    expect(result.grounds).toBe(3);
    expect(result.diagnostics).toEqual([]);
    const markers = grounds(result.document);
    expect(markers).toHaveLength(3);
    const projection = deriveElectricalTopologyProjection(
      result.document,
      resolver,
    );
    for (const marker of markers) {
      expect(
        projection.endpointToBaseNet.get(
          endpointKey({
            kind: "terminal",
            instanceId: marker.id,
            pinName: "0",
          }),
        ),
      ).toBe("gnd");
      expect(
        result.document.connectivityEvidence.filter(
          (e) =>
            e.kind === "name-claim" &&
            e.owner.kind === "power-marker" &&
            e.owner.objectId === marker.id,
        ),
      ).toMatchObject([
        { netId: "gnd", name: "0", scope: "global", powerDomain: "ground" },
      ]);
    }
    expect(presentationChange(source, result.document, resolver)).toBe(
      undefined,
    );
  });

  it("keeps a MOS gate on ground off the markers", () => {
    const source = amplifier();
    nodeZero(source, "gnd");
    const result = netlistPresentation(source, resolver);
    const hosts = result.edits.flatMap((e) =>
      e.kind === "connect_endpoints" && e.from.kind === "terminal"
        ? [`${e.from.instanceId}.${e.from.pinName}`]
        : [],
    );
    expect(hosts.sort()).toEqual(["c1.2", "m1.S", "r1.2"].sort());
    expect(hosts).not.toContain("m2.G");
  });

  it("draws no ground symbol on a VSS-named Cell Pin's Net without node 0", () => {
    // A ground marker would rename the Net to global node 0.
    const source = amplifier();
    cellPin(source, "VSS", "gnd");
    const result = netlistPresentation(source, resolver);
    expect(result.grounds).toBe(0);
    expect(grounds(result.document)).toEqual([]);
  });

  it("keeps a Cell Pin on node 0 a port beside the ground markers", () => {
    const source = amplifier();
    nodeZero(source, "gnd");
    cellPin(source, "VSS", "gnd");
    const result = netlistPresentation(source, resolver);
    expect(result.grounds).toBe(3);
    expect(
      result.document.instances.find((i) => i.id === "pin-VSS")?.symbolId,
    ).toBe("port");
    expect(presentationChange(source, result.document, resolver)).toBe(
      undefined,
    );
  });

  it("leaves a VSS-named Net alone when node 0 is claimed", () => {
    const source = amplifier();
    nodeZero(source, "tail");
    cellPin(source, "VSS", "gnd");
    const result = netlistPresentation(source, resolver);
    expect(
      result.edits.some(
        (e) => e.kind === "connect_endpoints" && e.newNetId === "gnd",
      ),
    ).toBe(false);
  });

  it("draws a supply Cell Pin as a supply symbol, once", () => {
    const source = amplifier();
    nodeZero(source, "gnd");
    source.nets.push({
      id: "vdd",
      terminals: [{ instanceId: "r2", pinName: "1" }],
    });
    source.nets
      .find((n) => n.id === "in")!
      .terminals.splice(
        source.nets
          .find((n) => n.id === "in")!
          .terminals.findIndex((t) => t.instanceId === "r2"),
        1,
      );
    cellPin(source, "VDD", "vdd");
    const result = netlistPresentation(source, resolver);
    expect(result.supplies).toBe(1);
    expect(
      result.edits.filter((e) => e.kind === "set_instance_symbol"),
    ).toEqual([
      {
        kind: "set_instance_symbol",
        instanceId: "pin-VDD",
        symbolId: "vdd-port",
      },
    ]);
    expect(
      result.document.instances.filter((i) => i.symbolId === "vdd-port"),
    ).toHaveLength(1);
    expect(result.document.netlist?.terminals).toEqual(
      source.netlist?.terminals,
    );
    expect(presentationChange(source, result.document, resolver)).toBe(
      undefined,
    );
    // Idempotent: the presented Document needs nothing more.
    expect(netlistPresentation(result.document, resolver).edits).toEqual([]);
  });

  it("leaves a rail that already has a ground marker untouched", () => {
    const source = amplifier();
    nodeZero(source, "gnd");
    source.instances.push({ id: "g", symbolId: "ground", placement: null });
    source.nets
      .find((n) => n.id === "gnd")!
      .terminals.push({ instanceId: "g", pinName: "0" });
    const result = netlistPresentation(source, resolver);
    expect(result.edits).toEqual([]);
    expect(result.document).toBe(source);
  });

  it("gives a lone grounded device beside a Cell Pin no marker", () => {
    const source = circuit(
      { r1: "resistor", r2: "resistor" },
      { gnd: ["r1.2"], mid: ["r1.1", "r2.2"], in: ["r2.1"] },
    );
    nodeZero(source, "gnd");
    cellPin(source, "VSS", "gnd");
    expect(netlistPresentation(source, resolver).edits).toEqual([]);
  });

  it("keeps supply Cell Pins not named VDD as ports", () => {
    const source = amplifier();
    source.nets.push(
      { id: "vddh", terminals: [] },
      { id: "vddl", terminals: [] },
    );
    cellPin(source, "VDDH", "vddh");
    cellPin(source, "VDDL", "vddl");
    const result = netlistPresentation(source, resolver);
    expect(result.supplies).toBe(0);
    expect(result.edits.some((e) => e.kind === "set_instance_symbol")).toBe(
      false,
    );
  });

  it("draws no ground symbol on a ground claim that is not node 0", () => {
    const source = amplifier();
    source.connectivityEvidence.push(
      {
        id: "source-gnd",
        kind: "spice-source",
        netId: "gnd",
        sourceNetId: "gnd",
      },
      {
        id: "claim-agnd",
        kind: "name-claim",
        netId: "gnd",
        name: "AGND",
        scope: "global",
        powerDomain: "ground",
        owner: { kind: "global-declaration", sourceNetId: "gnd" },
      },
    );
    expect(netlistPresentation(source, resolver).grounds).toBe(0);
  });

  it("skips a Document above the R3 limit with a warning", () => {
    const symbols: Record<string, string> = {};
    for (let i = 0; i < 121; i++) symbols[`r${i}`] = "resistor";
    const source = circuit(symbols, {
      gnd: Object.keys(symbols).map((id) => `${id}.2`),
    });
    nodeZero(source, "gnd");
    const result = netlistPresentation(source, resolver);
    expect(result.edits).toEqual([]);
    expect(result.diagnostics.map((d) => d.code)).toEqual([
      "AUTO_LAYOUT_NETLIST_PRESENTATION_SKIPPED",
    ]);
  });

  it("names the difference the gate finds", () => {
    const source = amplifier();
    nodeZero(source, "gnd");
    const joined = replay(source, [
      {
        kind: "connect_endpoints",
        from: { kind: "terminal", instanceId: "m2", pinName: "S" },
        to: { kind: "terminal", instanceId: "m1", pinName: "S" },
        newNetId: "gnd",
      },
    ]);
    expect(joined.ok).toBe(true);
    if (!joined.ok) return;
    expect(presentationChange(source, joined.document, resolver)).toBe(
      "Base Net partition changed",
    );
  });

  it("plans the presented Document in one transaction only with the option", () => {
    const source = amplifier();
    nodeZero(source, "gnd");
    const plain = planAutoLayout(source, resolver, {
      search: { seed: 1, evaluations: 0 },
    });
    expect(
      plain.edits.some(
        (e) => e.kind === "add_instance" && e.instance.symbolId === "ground",
      ),
    ).toBe(false);
    const presented = netlistPresentation(source, resolver);
    const plan = planAutoLayout(source, resolver, {
      search: { seed: 1, evaluations: 0 },
      presentation: "netlist",
    });
    expect(plan.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(plan.edits.slice(0, presented.edits.length)).toEqual(
      presented.edits,
    );
    const applied = replay(source, plan.edits);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(grounds(applied.document).every((i) => i.placement)).toBe(true);
    expect(
      equivalentTerminals(presented.document, applied.document, resolver),
    ).toBe(true);
  });

  it("plans as without the option when there is nothing to present", () => {
    const source = circuit(
      { r1: "resistor", r2: "resistor" },
      { a: ["r1.1"], mid: ["r1.2", "r2.1"], b: ["r2.2"] },
    );
    const options = { search: { seed: 1, evaluations: 0 } };
    expect(
      JSON.stringify(
        planAutoLayout(source, resolver, {
          ...options,
          presentation: "netlist",
        }),
      ),
    ).toBe(JSON.stringify(planAutoLayout(source, resolver, options)));
  });
});

describe("R163 gate refusals", () => {
  /** A node-0 amplifier with a VDD Cell Pin, and a copy to hand-edit. */
  const pair = () => {
    const before = amplifier();
    nodeZero(before, "gnd");
    before.nets.push({ id: "vdd", terminals: [] });
    cellPin(before, "VDD", "vdd");
    return { before, after: structuredClone(before) };
  };
  const change = (edit: (after: SchematicDocument) => void) => {
    const { before, after } = pair();
    edit(after);
    return presentationChange(before, after, resolver);
  };

  it("accepts the unchanged Document", () => {
    expect(change(() => {})).toBe(undefined);
  });

  it("refuses a changed symbol", () => {
    expect(
      change((d) => {
        d.instances.find((i) => i.id === "r1")!.symbolId = "capacitor";
      }),
    ).toBe("instance r1 changed symbol");
  });

  it("refuses a supply symbol on a Cell Pin not named VDD", () => {
    const before = amplifier();
    nodeZero(before, "gnd");
    before.nets.push({ id: "avdd", terminals: [] });
    cellPin(before, "AVDD", "avdd");
    const after = structuredClone(before);
    after.instances.find((i) => i.id === "pin-AVDD")!.symbolId = "vdd-port";
    expect(presentationChange(before, after, resolver)).toBe(
      "instance pin-AVDD changed symbol",
    );
  });

  it("refuses a supply symbol whose pins differ from the port's", () => {
    const port = resolver.resolve("port")!;
    const changed = {
      resolve: (symbolId: string, variantId?: string) => {
        const resolved = resolver.resolve(symbolId, variantId);
        return symbolId === "vdd-port" && resolved
          ? {
              ...resolved,
              definition: {
                ...resolved.definition,
                pins: [
                  ...port.definition.pins,
                  { ...port.definition.pins[0]!, name: "Q" },
                ],
              },
            }
          : resolved;
      },
    } as unknown as typeof resolver;
    const { before, after } = pair();
    after.instances.find((i) => i.id === "pin-VDD")!.symbolId = "vdd-port";
    expect(presentationChange(before, after, changed)).toBe(
      "instance pin-VDD changed pins",
    );
  });

  it("refuses a Net whose scope changes", () => {
    expect(
      change((d) => {
        const claim = d.connectivityEvidence.find((e) => e.id === "claim-gnd");
        if (claim?.kind === "name-claim") claim.scope = "local";
      }),
    ).toBe("Net gnd renamed");
  });

  it("refuses a Net whose domain changes", () => {
    expect(
      change((d) => {
        const claim = d.connectivityEvidence.find((e) => e.id === "claim-gnd");
        if (claim?.kind === "name-claim") claim.powerDomain = "vdd";
      }),
    ).toBe("Net gnd renamed");
  });

  it("refuses a Net that gains a conflict", () => {
    // Node 0 already declared under a second name: the Net has no single
    // name, so only its conflicts can show a further change.
    const { before } = pair();
    before.connectivityEvidence.push({
      id: "claim-agnd",
      kind: "name-claim",
      netId: "gnd",
      name: "AGND",
      scope: "global",
      powerDomain: "ground",
      owner: { kind: "global-declaration", sourceNetId: "gnd" },
    });
    const after = structuredClone(before);
    after.netlist!.terminals.push({
      id: "terminal-vss",
      name: "VSS",
      netId: "gnd",
      direction: "passive",
      interfaceInstanceIds: [],
    });
    expect(presentationChange(before, after, resolver)).toBe(
      "Net gnd conflicts changed",
    );
  });

  it("refuses changed MOS bulk defaults", () => {
    expect(
      change((d) => {
        d.mosBulkDefaults = { nmosNetId: "gnd" };
      }),
    ).toBe("MOS bulk defaults changed");
  });

  it("refuses changed Cell terminals", () => {
    expect(
      change((d) => {
        d.netlist!.terminals[0]!.direction = "input";
      }),
    ).toBe("Cell terminals changed");
  });

  it("refuses changed evidence", () => {
    expect(
      change((d) => {
        d.connectivityEvidence = d.connectivityEvidence.filter(
          (e) => e.id !== "source-gnd",
        );
      }),
    ).toBe("evidence source-gnd changed");
  });

  it("refuses a MOS body that resolves differently", () => {
    expect(
      change((d) => {
        d.noConnects.push({
          id: "nc",
          endpoint: { kind: "terminal", instanceId: "m1", pinName: "B" },
        });
      }),
    ).toBe("MOS body m1 resolves differently");
  });

  it("refuses an added instance that is not a node-0 ground marker", () => {
    expect(
      change((d) => {
        d.instances.push({ id: "x", symbolId: "resistor", placement: null });
      }),
    ).toBe("added instance x is not a ground marker of node 0");
  });

  it("refuses evidence the presentation does not add", () => {
    expect(
      change((d) => {
        d.connectivityEvidence.push({
          id: "hint",
          kind: "net-name-hint",
          netId: "out",
          sourceName: "out",
          origin: "spice-import",
        });
      }),
    ).toBe("unexpected evidence added");
  });
});

describe("R163 planning fallbacks", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });
  const options = {
    search: { seed: 1, evaluations: 0 },
    presentation: "netlist" as const,
  };
  const plainPlan = (source: SchematicDocument) =>
    planAutoLayout(source, resolver, { search: { seed: 1, evaluations: 0 } });
  const dropped = (plan: ReturnType<typeof planAutoLayout>) =>
    plan.diagnostics.filter(
      (d) => d.code === "AUTO_LAYOUT_NETLIST_PRESENTATION_DROPPED",
    );

  it("plans without the symbols when the presented Document is refused", () => {
    const source = amplifier();
    nodeZero(source, "gnd");
    const presented = netlistPresentation(source, resolver);
    const large = structuredClone(presented.document);
    for (let i = 0; i < 121; i++)
      large.instances.push({
        id: `x${i}`,
        symbolId: "resistor",
        placement: null,
      });
    vi.spyOn(presentationModule, "netlistPresentation").mockReturnValue({
      ...presented,
      document: large,
    });
    const plan = planAutoLayout(source, resolver, options);
    expect(dropped(plan)).toHaveLength(1);
    expect(plan.edits).toEqual(plainPlan(source).edits);
  });

  it("plans without the symbols when the presented Document plans no edits", () => {
    const source = amplifier();
    nodeZero(source, "gnd");
    const presented = netlistPresentation(source, resolver);
    vi.spyOn(presentationModule, "netlistPresentation").mockReturnValue({
      ...presented,
      document: circuit({}, {}),
    });
    const plan = planAutoLayout(source, resolver, options);
    expect(dropped(plan)).toHaveLength(1);
    expect(plan.edits).toEqual(plainPlan(source).edits);
  });

  it("plans without the symbols past the transaction edit limit", () => {
    const source = amplifier();
    nodeZero(source, "gnd");
    const presented = netlistPresentation(source, resolver);
    vi.spyOn(presentationModule, "netlistPresentation").mockReturnValue({
      ...presented,
      edits: Array.from({ length: 1024 }, () => presented.edits[0]!),
    });
    const plan = planAutoLayout(source, resolver, options);
    expect(dropped(plan).map((d) => d.message)).toEqual([
      "R163: rail symbols dropped: transaction edit limit",
    ]);
    expect(plan.edits).toEqual(plainPlan(source).edits);
  });
});
