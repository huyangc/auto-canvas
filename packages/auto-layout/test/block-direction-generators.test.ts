import { describe, expect, it, vi } from "vitest";
import type { SchematicDocument } from "@icm/model";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { placeAmplifierBetweenBranches } from "../src/amp-gate-row.js";
import { relocationCandidates } from "../src/device-relocation-search.js";
import {
  againstFlowCounter,
  inputsOnRight,
  outputFacesLeft,
} from "../src/directed-blocks.js";
import { placement } from "../src/geometry.js";
import { emptyChoices, emptyOverrides } from "../src/layout-choices.js";
import { placeLocalLoopAmplifiers } from "../src/local-loop-amplifier.js";
import * as netRoles from "../src/net-roles.js";
import { classifyNets, type NetRoles } from "../src/net-roles.js";
import { placeDocument } from "../src/place.js";
import { orientByWireCost } from "../src/place-fallback.js";
import { isMarker } from "../src/placement-connectivity.js";
import { createMoveGenerator, randomStream } from "../src/search-moves.js";
import { reversedSignalHosts } from "../src/signal-direction.js";
import type { Placement } from "../src/types.js";
import { circuit } from "./document-fixture.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);
const instance = (d: SchematicDocument, id: string) =>
  d.instances.find((i) => i.id === id)!;
/** The same roles with R164 switched off: no block is free. */
const unguarded = (roles: NetRoles): NetRoles => ({
  ...roles,
  rightFacing: new Set(),
});
const faces = (d: SchematicDocument, id: string, p: Placement) =>
  outputFacesLeft(instance(d, id), p, resolver);

// Each R164 generator guard, checked on its own. Where the fixture makes the
// unguarded generator face the block left, that is asserted too.
describe("R164 generator guards", () => {
  it("R159 amplifier seats skip poses facing the amplifier left", () => {
    const d = circuit(
      {
        left: "pmos",
        right: "pmos",
        amp: "opamp",
        r1: "resistor",
        r2: "resistor",
      },
      {
        supply: ["left.S", "right.S"],
        gate: ["left.G", "right.G", "amp.OUT"],
        sense1: ["left.D", "amp.IN+", "r1.1"],
        sense2: ["right.D", "amp.IN-", "r2.1"],
        ground: ["r1.2", "r2.2"],
      },
    );
    const run = (roles: NetRoles) => {
      // A stacked pair: the only gate-row seat faces the output left.
      const targets = new Map([
        ["left", placement(200, 100)],
        ["right", placement(200, 300)],
        ["amp", placement(600, 100)],
        ["r1", placement(700, 320)],
        ["r2", placement(800, 320)],
      ]);
      placeAmplifierBetweenBranches(d, resolver, roles, targets, new Set(), d);
      return targets.get("amp")!;
    };
    const roles = classifyNets(d, resolver);
    expect(faces(d, "amp", run(roles))).toBe(false);
    expect(faces(d, "amp", run(unguarded(roles)))).toBe(true);
  });

  it("R156 local-loop seats skip poses facing the amplifier left", () => {
    const d = circuit(
      { m: "nmos", bottom: "nmos", a: "opamp", r: "resistor" },
      {
        vdd: ["r.1"],
        out: ["r.2", "m.D"],
        sense: ["m.S", "bottom.D", "a.IN-"],
        gnd: ["bottom.S"],
        input: ["bottom.G", "a.IN+"],
        control: ["a.OUT", "m.G"],
      },
    );
    const run = (roles: NetRoles) => {
      // A transistor whose gate faces right needs a left-facing driver.
      const targets = new Map([
        ["m", placement(200, 200, "horizontal")],
        ["bottom", placement(200, 300, "horizontal")],
        ["a", placement(440, 200)],
        ["r", placement(210, 100)],
      ]);
      placeLocalLoopAmplifiers(d, resolver, roles, targets, new Set());
      return targets.get("a")!;
    };
    const roles = classifyNets(d, resolver);
    expect(faces(d, "a", run(roles))).toBe(false);
    expect(faces(d, "a", run(unguarded(roles)))).toBe(true);
  });

  it("R21 offers a free two-pin block only right-facing options", () => {
    const d = circuit(
      { X1: "inverter", R1: "resistor", R2: "resistor" },
      { a: ["R1.2", "X1.A"], b: ["X1.Y", "R2.1"], c: ["R1.1"], e: ["R2.2"] },
    );
    const options = (roles: NetRoles) => {
      const targets = new Map([
        ["R1", placement(0, 0)],
        ["X1", placement(200, 0, "none", 180)],
        ["R2", placement(400, 0)],
      ]);
      const choices = emptyChoices();
      orientByWireCost(
        d,
        resolver,
        roles,
        targets,
        [],
        new Set(),
        emptyOverrides(),
        choices,
      );
      return choices.orientations.get("X1")!;
    };
    const roles = classifyNets(d, resolver);
    expect(options(roles).some((p) => faces(d, "X1", p))).toBe(false);
    expect(options(unguarded(roles)).some((p) => faces(d, "X1", p))).toBe(true);
  });

  it("R147 relocation offers no left-facing pose of a free block", () => {
    // The input part sits right of the op-amp and the feedback part left of
    // it, so a pin-facing relocation would turn the op-amp around.
    const d = circuit(
      { R1: "resistor", X1: "opamp", G1: "ground", R2: "resistor" },
      {
        a: ["R1.2", "X1.IN-"],
        b: ["X1.OUT", "R2.2"],
        g: ["X1.IN+", "G1.0"],
        c: ["R1.1"],
        e: ["R2.1"],
      },
    );
    const at: Record<string, Placement> = {
      R1: placement(500, 0, "none", 90),
      X1: placement(200, 0),
      G1: placement(200, 300),
      R2: placement(-200, 0),
    };
    d.instances = d.instances.map((i) => ({ ...i, placement: at[i.id]! }));
    const leftPoses = () =>
      relocationCandidates(d, resolver, ["X1"]).filter((c) =>
        faces(d, "X1", c.get("X1")!),
      ).length;
    expect(relocationCandidates(d, resolver, ["X1"]).length).toBeGreaterThan(0);
    expect(leftPoses()).toBe(0);
    const classify = netRoles.classifyNets;
    const spy = vi
      .spyOn(netRoles, "classifyNets")
      .mockImplementation((document, symbols) =>
        unguarded(classify(document, symbols)),
      );
    try {
      expect(leftPoses()).toBeGreaterThan(0);
    } finally {
      spy.mockRestore();
    }
  });

  it("layered two-pin rows never face a free inverter left", () => {
    // Inverters drive transistor gates; their own inputs are open, so the
    // signal distance runs from the transistors back into the chain.
    const d = circuit(
      {
        M1: "nmos",
        M2: "nmos",
        X1: "inverter",
        X2: "inverter",
        X3: "inverter",
        G: "ground",
      },
      {
        d: ["M1.D", "M2.S"],
        g: ["M1.S", "M1.B", "M2.B", "G.0"],
        o: ["M2.D"],
        a: ["X1.Y", "M2.G"],
        b: ["X2.Y", "M1.G"],
        c: ["X3.Y", "X1.A"],
      },
    );
    const run = (roles: NetRoles) =>
      placeDocument(d, resolver, roles, [], {}, undefined, undefined, "layered")
        .placements;
    const roles = classifyNets(d, resolver);
    const guarded = run(roles);
    for (const id of ["X1", "X2", "X3"])
      expect(faces(d, id, guarded.get(id)!)).toBe(false);
    const free = run(unguarded(roles));
    expect(["X1", "X2", "X3"].some((id) => faces(d, id, free.get(id)!))).toBe(
      true,
    );
  });

  it("search never draws more blocks against the flow", () => {
    const d = circuit(
      {
        R1: "resistor",
        R3: "resistor",
        C2: "capacitor",
        X1: "opamp",
        G1: "ground",
      },
      {
        vin: ["R1.1"],
        n1: ["R1.2", "R3.2"],
        n5: ["C2.2", "R3.1", "X1.IN-"],
        n8: ["C2.1", "X1.OUT"],
        ref: ["G1.0", "X1.IN+"],
      },
    );
    const at: Record<string, Placement> = {
      R1: placement(0, 0),
      R3: placement(120, 0),
      C2: placement(240, -100),
      X1: placement(360, 0),
      G1: placement(300, 200),
    };
    d.instances = d.instances.map((i) => ({ ...i, placement: at[i.id]! }));
    const roles = classifyNets(d, resolver);
    const count = againstFlowCounter(
      d.instances.filter((i) => !isMarker(i)),
      resolver,
      roles,
      roles.rightFacing!,
    );
    const state = {
      placements: new Map(Object.entries(at)),
      sides: new Map(),
      strategy: "stages" as const,
    };
    expect(count(state.placements)).toBe(0);
    const propose = createMoveGenerator(
      d,
      resolver,
      new Set(),
      randomStream(5),
    );
    let proposals = 0;
    for (let i = 0; i < 400; i++) {
      const next = propose(state);
      if (!next) continue;
      proposals++;
      expect(count(next.placements)).toBe(0);
    }
    expect(proposals).toBeGreaterThan(0);
  });

  it("finds an input port seated right of what it drives", () => {
    const d = circuit(
      { X1: "opamp", R1: "resistor", G1: "ground", in: "port" },
      {
        vin: ["in.P", "X1.IN+"],
        m: ["X1.IN-", "X1.OUT", "R1.1"],
        g: ["R1.2", "G1.0"],
      },
    );
    d.netlist = {
      name: "test",
      formalParameters: [],
      terminals: [
        {
          id: "t-in",
          name: "in",
          netId: "vin",
          direction: "input",
          interfaceInstanceIds: ["in"],
        },
      ],
    };
    const roles = classifyNets(d, resolver);
    const devices = d.instances.filter((i) => !isMarker(i));
    const at = (x1: number, r1: number) =>
      new Map([
        ["X1", placement(x1, 0)],
        ["R1", placement(r1, 0)],
        ["G1", placement(r1, 200)],
      ]);
    expect(inputsOnRight(d, devices, resolver, roles, at(0, 300)).size).toBe(0);
    expect([...inputsOnRight(d, devices, resolver, roles, at(300, 0))]).toEqual(
      ["vin"],
    );
  });

  it("infers a side from blocks only without transistors", () => {
    const network = {
      vin: ["R1.1"],
      n1: ["R1.2", "R3.2"],
      n5: ["C2.2", "R3.1", "X1.IN-"],
      n8: ["C2.1", "X1.OUT"],
      ref: ["G1.0", "X1.IN+"],
    };
    const symbols = {
      R1: "resistor",
      R3: "resistor",
      C2: "capacitor",
      X1: "opamp",
      G1: "ground",
    };
    // The op-amp sits left of the network that drives it.
    const at = new Map<string, Placement>([
      ["X1", placement(0, 0)],
      ["C2", placement(120, -100)],
      ["R3", placement(240, 0)],
      ["R1", placement(360, 0)],
      ["G1", placement(0, 200)],
      ["M1", placement(600, 200)],
    ]);
    const reversed = (d: SchematicDocument) =>
      reversedSignalHosts(
        d,
        d.instances.filter((i) => !isMarker(i)),
        resolver,
        classifyNets(d, resolver),
        at,
      );
    expect(reversed(circuit(symbols, network))).toBe(true);
    const fenced = circuit(
      { ...symbols, M1: "nmos" },
      { ...network, m: ["M1.D", "M1.G", "M1.S", "M1.B"] },
    );
    expect(reversed(fenced)).toBe(false);
  });
});
