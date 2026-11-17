import { deriveElectricalTopologyProjection, endpointKey } from "@icm/derived";
import { executeTransaction } from "@icm/edit-engine";
import type { SchematicDocument } from "@icm/model";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { describe, expect, it } from "vitest";
import { planAutoLayout } from "../src/auto-layout.js";
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

  it("drops the edits when the replay would join two Nets", () => {
    const source = amplifier();
    nodeZero(source, "tail");
    // A second ground Net under another global name: node 0's claim would
    // join it to `tail`.
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
    const result = netlistPresentation(source, resolver);
    expect(result.edits).toEqual([]);
    expect(result.document).toBe(source);
    expect(result.diagnostics.map((d) => d.code)).toEqual([
      "AUTO_LAYOUT_NETLIST_PRESENTATION_DROPPED",
    ]);
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
