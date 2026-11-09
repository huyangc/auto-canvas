import { expect, it } from "vitest";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { classifyNets } from "../src/net-roles.js";
import { persistedTemplates, recognizeStructures } from "../src/recognize.js";
import { circuit } from "./document-fixture.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);
it("recognizes a differential pair and its tail by connectivity", () => {
  const d = circuit(
    { a: "nmos", b: "nmos", t: "current-source" },
    {
      s: ["a.S", "b.S", "t.+"],
      ga: ["a.G"],
      gb: ["b.G"],
      da: ["a.D"],
      db: ["b.D"],
    },
  );
  expect(recognizeStructures(d, classifyNets(d, resolver))).toEqual([
    {
      id: "auto-differential-pair-a",
      kind: "differential-pair",
      members: ["a", "b"],
      tailInstanceId: "t",
    },
  ]);
  d.layoutGroups.push({
    id: "user",
    kind: "differential-pair",
    objectIds: ["a", "b"],
    locked: false,
  });
  expect(recognizeStructures(d, classifyNets(d, resolver))).toEqual([]);
});
it("prefers a mirror over matched-pair and records the diode side", () => {
  const d = circuit(
    { a: "pmos", b: "pmos" },
    { s: ["a.S", "b.S"], g: ["a.G", "b.G", "b.D"], d: ["a.D"] },
  );
  expect(recognizeStructures(d, classifyNets(d, resolver))).toEqual([
    {
      id: "auto-current-mirror-a",
      kind: "current-mirror",
      members: ["a", "b"],
      diodeInstanceId: "b",
    },
  ]);
});
it("recognizes equal-role diode loads sharing drains but different sources", () => {
  const d = circuit(
    { a: "nmos", b: "nmos" },
    { d: ["a.D", "a.G", "b.D", "b.G"], sa: ["a.S"], sb: ["b.S"] },
  );
  expect(recognizeStructures(d, classifyNets(d, resolver))[0]?.kind).toBe(
    "matched-pair",
  );
});
it("does not call shared drains or an open gate a differential pair", () => {
  const d = circuit(
    { a: "nmos", b: "nmos" },
    { s: ["a.S", "b.S"], d: ["a.D", "b.D"], g: ["a.G"] },
  );
  expect(recognizeStructures(d, classifyNets(d, resolver))).toEqual([]);
});
it("leaves an ambiguous shared-source bank to the shared-gate matched rule", () => {
  const d = circuit(
    { a: "nmos", b: "nmos", c: "nmos" },
    {
      s: ["a.S", "b.S", "c.S"],
      ga: ["a.G", "c.G"],
      gb: ["b.G"],
      da: ["a.D"],
      db: ["b.D"],
      dc: ["c.D"],
    },
  );
  expect(
    recognizeStructures(d, classifyNets(d, resolver)).map((g) => g.members),
  ).toEqual([["a", "c"]]);
});

it("R68 rejects a one-way channel-to-gate driver pair", () => {
  const d = circuit(
    { a: "nmos", b: "nmos" },
    { s: ["a.S", "b.S"], ga: ["a.G", "b.D"], gb: ["b.G"], da: ["a.D"] },
  );
  expect(recognizeStructures(d, classifyNets(d, resolver))).toEqual([]);
});

it.each(["D", "S"])(
  "R68 recognizes a mutual %s-to-gate cross pair",
  (channel) => {
    const other = channel === "D" ? "S" : "D";
    const d = circuit(
      { a: "nmos", b: "nmos" },
      {
        x: [`a.${channel}`, "b.G"],
        y: [`b.${channel}`, "a.G"],
        common: [`a.${other}`, `b.${other}`],
      },
    );
    expect(recognizeStructures(d, classifyNets(d, resolver))).toEqual([
      { id: "auto-matched-pair-a", kind: "matched-pair", members: ["a", "b"] },
    ]);
  },
);

it("rebuilds a persisted mirror with its chosen output representative", () => {
  const d = circuit(
    { a: "nmos", b: "nmos", c: "nmos", d: "nmos", g: "ground" },
    {
      ref: ["a.D", "a.G", "b.G", "c.G", "d.G"],
      db: ["b.D"],
      dc: ["c.D"],
      dd: ["d.D"],
      ground: ["a.S", "b.S", "c.S", "d.S", "g.0"],
    },
  );
  d.layoutGroups = [
    {
      id: "kept",
      kind: "current-mirror",
      objectIds: ["a", "c", "d"],
      locked: false,
    },
  ];
  const roles = classifyNets(d, resolver);
  expect(recognizeStructures(d, roles)).toEqual([]);
  expect(persistedTemplates(d, roles)).toEqual([
    {
      id: "auto-current-mirror-a",
      kind: "current-mirror",
      members: ["a", "c"],
      diodeInstanceId: "a",
      extraMemberIds: ["d"],
    },
  ]);
});

it("keeps persisted mirror load sides aligned with an inferred pair", () => {
  const d = circuit(
    { a: "nmos", b: "nmos", r: "pmos", o: "pmos" },
    {
      source: ["a.S", "b.S"],
      ga: ["a.G"],
      gb: ["b.G"],
      left: ["a.D", "r.D", "r.G", "o.G"],
      right: ["b.D", "o.D"],
      supply: ["r.S", "o.S"],
    },
  );
  d.layoutGroups = [
    {
      id: "load",
      kind: "current-mirror",
      objectIds: ["o", "r"],
      locked: false,
    },
  ];
  const roles = classifyNets(d, resolver);
  expect(persistedTemplates(d, roles)[0]!.members).toEqual(["r", "o"]);
});
