import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { executeTransaction } from "@icm/edit-engine";
import type { SchematicDocument } from "@icm/model";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { defaultLayoutSearch, planAutoLayout } from "../src/auto-layout.js";
import {
  againstFlowCounter,
  outputFacesLeft,
  rightedInPlace,
  rightFacingBlocks,
} from "../src/directed-blocks.js";
import { pinPoints } from "../src/geometry.js";
import { classifyNets } from "../src/net-roles.js";
import { portSeatCandidates } from "../src/place-markers.js";
import { isMarker } from "../src/placement-connectivity.js";
import { recognizeStructures } from "../src/recognize.js";
import { createMoveGenerator, randomStream } from "../src/search-moves.js";
import { placeStages } from "../src/stages.js";
import { visibleInstanceBounds } from "@icm/derived";
import { circuit } from "./document-fixture.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);

/** Ports named `out*` are outputs; every port owns its Net's terminal. */
function withPorts(d: SchematicDocument): SchematicDocument {
  d.netlist = {
    name: "test",
    formalParameters: [],
    terminals: d.instances
      .filter((i) => i.symbolId === "port")
      .map((i) => ({
        id: `terminal-${i.id}`,
        name: i.id,
        netId: d.nets.find((n) =>
          n.terminals.some((t) => t.instanceId === i.id),
        )!.id,
        direction: i.id.startsWith("out") ? "output" : "input",
        interfaceInstanceIds: [i.id],
      })),
  };
  return d;
}

// A second-order low-pass section: the op-amp's output feeds back through C2
// and R2. On main the search mirrors the op-amp to face its network.
const lowPass = (output = false) =>
  withPorts(
    circuit(
      {
        R1: "resistor",
        R2: "resistor",
        R3: "resistor",
        C1: "capacitor",
        C2: "capacitor",
        X1: "opamp",
        G1: "ground",
        G2: "ground",
        in: "port",
        ...(output ? { out: "port" } : {}),
      },
      {
        vin: ["R1.2", "in.P"],
        n1: ["C1.1", "R1.1", "R2.2", "R3.2"],
        n5: ["C2.2", "R3.1", "X1.IN-"],
        n8: ["C2.1", "R2.1", "X1.OUT", ...(output ? ["out.P"] : [])],
        ref: ["G2.0", "X1.IN+"],
        gnd: ["C1.2", "G1.0"],
      },
    ),
  );

// Cross-coupled inverters: a directed block cycle.
const latch = () =>
  withPorts(
    circuit(
      { A: "inverter", B: "inverter", outq: "port", outqb: "port" },
      { q: ["A.Y", "B.A", "outq.P"], qb: ["B.Y", "A.A", "outqb.P"] },
    ),
  );

const inverting = () =>
  withPorts(
    circuit(
      {
        R1: "resistor",
        R2: "resistor",
        X1: "opamp",
        G1: "ground",
        in: "port",
        out: "port",
      },
      {
        vin: ["in.P", "R1.1"],
        m: ["R1.2", "R2.1", "X1.IN-"],
        vout: ["R2.2", "X1.OUT", "out.P"],
        ref: ["G1.0", "X1.IN+"],
      },
    ),
  );

function plan(d: SchematicDocument) {
  const result = planAutoLayout(d, resolver, {
    search: { seed: 1, evaluations: defaultLayoutSearch(d, {}).evaluations },
  });
  const t = executeTransaction(
    d,
    {
      transactionId: "t",
      documentId: d.id,
      expectedRevision: d.revision,
      actor: { kind: "agent", id: "test" },
      edits: result.edits,
    },
    { symbolResolver: resolver },
  );
  expect(t.ok).toBe(true);
  return t.ok ? t.document : d;
}

const instance = (d: SchematicDocument, id: string) =>
  d.instances.find((i) => i.id === id)!;
const centreX = (d: SchematicDocument, id: string) => {
  const b = visibleInstanceBounds(d, resolver).find((b) => b.id === id)!.bounds;
  return b.x + b.width / 2;
};
const portX = (d: SchematicDocument, id: string) =>
  pinPoints(d, resolver).find((p) => p.instanceId === id)!.point.x;

describe("R164 directed blocks", () => {
  it("finds blocks and block cycles from pin roles", () => {
    const d = lowPass();
    expect([
      ...rightFacingBlocks(d.instances, resolver, classifyNets(d, resolver)),
    ]).toEqual(["X1"]);
    expect(
      rightFacingBlocks(
        d.instances,
        resolver,
        classifyNets(d, resolver),
        new Set(["X1"]),
      ).size,
    ).toBe(0);
    const l = latch();
    expect(classifyNets(l, resolver).rightFacing!.size).toBe(0);
    // A document without directed blocks has nothing to guard.
    const passive = circuit(
      { R1: "resistor", C1: "capacitor" },
      { a: ["R1.1", "C1.1"], b: ["R1.2", "C1.2"] },
    );
    expect(classifyNets(passive, resolver).rightFacing!.size).toBe(0);
  });

  it("keeps an op-amp with feedback facing right through search", () => {
    const d = lowPass();
    const result = plan(d);
    const x1 = instance(result, "X1");
    expect(outputFacesLeft(x1, x1.placement!, resolver)).toBe(false);
    // No search move faces it left; top-bottom reflection stays available.
    for (const strategy of ["stages", "layered"] as const) {
      const propose = createMoveGenerator(
        result,
        resolver,
        new Set(),
        randomStream(3),
      );
      const state = {
        placements: new Map(result.instances.map((i) => [i.id, i.placement!])),
        sides: new Map(),
        strategy,
      };
      let reflected = 0;
      for (let i = 0; i < 400; i++) {
        const next = propose(state);
        const p = next?.placements.get("X1");
        if (!p) continue;
        expect(outputFacesLeft(x1, p, resolver)).toBe(false);
        if (p.mirror !== x1.placement!.mirror) reflected++;
      }
      expect(reflected).toBeGreaterThan(0);
    }
  });

  it("may still face a latch inverter left", () => {
    const result = plan(latch());
    expect(
      ["A", "B"].some((id) => {
        const i = instance(result, id);
        return outputFacesLeft(i, i.placement!, resolver);
      }),
    ).toBe(true);
  });

  it("re-rights a mirrored stage's block and runs the row with it", () => {
    const d = lowPass(true);
    const roles = classifyNets(d, resolver);
    const { placements } = placeStages(
      d,
      d.instances.filter((i) => !isMarker(i)),
      resolver,
      roles,
      recognizeStructures({ ...d, layoutGroups: [] }, roles),
    );
    const x1 = placements.get("X1")!;
    expect(outputFacesLeft(instance(d, "X1"), x1, resolver)).toBe(false);
    // The input network (R3 drives IN-) sits left of the op-amp.
    expect(placements.get("R3")!.position.x).toBeLessThan(x1.position.x);
  });

  it("turns a mirrored block back in place", () => {
    const d = lowPass();
    const x1 = instance(d, "X1");
    const mirrored = {
      position: { x: 200, y: 100 },
      rotation: 0,
      mirror: "horizontal",
    } as const;
    const righted = rightedInPlace(x1, mirrored, resolver, d.presentation.grid);
    expect(outputFacesLeft(x1, righted, resolver)).toBe(false);
    const centre = (p: typeof righted) =>
      centreX({ ...d, instances: [{ ...x1, placement: p }] }, "X1");
    expect(Math.abs(centre(righted) - centre(mirrored))).toBeLessThanOrEqual(
      d.presentation.grid / 2,
    );
    const right = { ...mirrored, mirror: "none" } as const;
    expect(rightedInPlace(x1, right, resolver, d.presentation.grid)).toBe(
      right,
    );
  });

  it("reverses a portless row that runs against its block", () => {
    const d = lowPass();
    d.instances = d.instances.filter((i) => i.id !== "in");
    d.nets = d.nets.map((n) => ({
      ...n,
      terminals: n.terminals.filter((t) => t.instanceId !== "in"),
    }));
    d.netlist = { name: "test", formalParameters: [], terminals: [] };
    const result = plan(d);
    const x1 = instance(result, "X1");
    expect(outputFacesLeft(x1, x1.placement!, resolver)).toBe(false);
    const count = againstFlowCounter(
      result.instances,
      resolver,
      classifyNets(result, resolver),
      new Set(["X1"]),
    );
    expect(
      count(new Map(result.instances.map((i) => [i.id, i.placement!]))),
    ).toBe(0);
  });

  it("seats an output port right of its driver and keeps it there", () => {
    for (const d of [inverting(), lowPass(true)]) {
      const result = plan(d);
      expect(portX(result, "out")).toBeGreaterThan(centreX(result, "X1"));
      const candidates = portSeatCandidates(result, resolver, "out", true);
      expect(candidates.length).toBeGreaterThan(0);
      for (const seat of candidates) {
        const moved = {
          ...result,
          instances: result.instances.map((i) =>
            i.id === "out" ? { ...i, placement: seat } : i,
          ),
        };
        expect(portX(moved, "out")).toBeGreaterThan(centreX(result, "X1"));
      }
    }
  });

  it("plans a document without directed blocks exactly as main", () => {
    const d = withPorts(
      circuit(
        {
          M1: "nmos",
          RD: "resistor",
          RS: "resistor",
          V: "vdd-port",
          G: "ground",
          in: "port",
          out: "port",
        },
        {
          vin: ["M1.G", "in.P"],
          vout: ["M1.D", "RD.1", "out.P"],
          vdd: ["RD.2", "V.P"],
          s: ["M1.S", "RS.1"],
          gnd: ["RS.2", "M1.B", "G.0"],
        },
      ),
    );
    const result = planAutoLayout(d, resolver, {
      search: { seed: 1, evaluations: defaultLayoutSearch(d, {}).evaluations },
    });
    // Recorded with main at fb61255.
    expect(
      createHash("sha256").update(JSON.stringify(result)).digest("hex"),
    ).toBe("7164107c668b8085f278d2897d3e13ad00877aaca98e51b0c3a767d402cf9043");
  });

  it("does not reverse a chain whose input is a grounded source", () => {
    // Two source-driven inputs, an amplifier and an output port; no input
    // port. The input sources outrank the block for R57 and the draft mirror.
    const d = withPorts(
      circuit(
        {
          X1: "voltage-amplifier",
          out: "port",
          V1: "voltage-source",
          V2: "voltage-source",
          C1: "capacitor",
          C2: "capacitor",
          C3: "capacitor",
          C4: "capacitor",
          G1: "ground",
          G2: "ground",
          G3: "ground",
          G4: "ground",
        },
        {
          vout: ["C3.1", "C4.1", "out.P", "X1.OUT"],
          t: ["V1.+", "X1.IN"],
          vin: ["C2.2", "V2.+"],
          g1: ["G1.0", "V2.-"],
          g2: ["C1.2", "G2.0"],
          g3: ["G3.0", "V1.-"],
          x: ["C1.1", "C2.1", "C3.2"],
          g4: ["C4.2", "G4.0"],
        },
      ),
    );
    const result = plan(d);
    const x1 = instance(result, "X1");
    expect(outputFacesLeft(x1, x1.placement!, resolver)).toBe(false);
    expect(centreX(result, "V2")).toBeLessThan(centreX(result, "X1"));
    expect(portX(result, "out")).toBeGreaterThan(centreX(result, "X1"));
  });
});
