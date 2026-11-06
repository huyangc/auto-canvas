import { expect, it } from "vitest";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { classifyNets } from "../src/net-roles.js";
import { recognizeStructures } from "../src/recognize.js";
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
it("assigns differential pairs before shared-gate matched candidates", () => {
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
  ).toEqual([["a", "b"]]);
});
