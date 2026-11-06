import { expect, it } from "vitest";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { classifyNets } from "../src/net-roles.js";
import { circuit } from "./document-fixture.js";

it("classifies all roles using claims, Cell Pins and grounded voltage sources", () => {
  const document = circuit(
    {
      a: "nmos",
      b: "nmos",
      c: "nmos",
      v: "voltage-source",
      bias: "voltage-source",
      g: "ground",
      p: "port",
    },
    {
      input: ["a.G", "v.+"],
      output: ["a.D", "p.P"],
      ground: ["g.0", "v.-", "bias.-"],
      supply: ["bias.+"],
      internal: ["b.G"],
      claimed: ["c.S"],
    },
  );
  document.netlist = {
    name: "test",
    formalParameters: [],
    terminals: [
      {
        id: "out",
        name: "result",
        netId: "output",
        direction: "passive",
        interfaceInstanceIds: ["p"],
      },
    ],
  };
  document.connectivityEvidence.push({
    id: "claim",
    kind: "name-claim",
    netId: "claimed",
    name: "rail",
    scope: "global",
    powerDomain: "vdd",
    owner: { kind: "global-declaration", sourceNetId: "claimed" },
  });
  expect(
    Object.fromEntries(
      classifyNets(document, new InMemorySymbolResolver(builtInSymbols)).byNet,
    ),
  ).toEqual({
    input: "input",
    output: "output",
    ground: "ground",
    supply: "supply",
    internal: "internal",
    claimed: "supply",
  });
});

it("uses supply, ground and output names on Cell Pins", () => {
  const document = circuit(
    { a: "port", b: "port", c: "port" },
    { a: ["a.P"], b: ["b.P"], c: ["c.P"] },
  );
  document.netlist = {
    name: "test",
    formalParameters: [],
    terminals: ["AVDD", "VSS", "Vout"].map((name, i) => ({
      id: name,
      name,
      netId: ["a", "b", "c"][i]!,
      direction: "passive",
      interfaceInstanceIds: [["a", "b", "c"][i]!],
    })),
  };
  expect([
    ...classifyNets(
      document,
      new InMemorySymbolResolver(builtInSymbols),
    ).byNet.values(),
  ]).toEqual(["supply", "ground", "output"]);
});
