import { createRoutePath } from "@icm/model";
import { expect, it } from "vitest";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import {
  describeCircuit,
  llmResultToPartition,
  type LlmPartitionResult,
} from "../src/partition-prompt.js";
import { partitionMetrics } from "../src/partition-metrics.js";
import { placement } from "../src/geometry.js";
import { circuit } from "./document-fixture.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);
const sample = () =>
  circuit(
    { alice: "resistor", bob: "resistor" },
    {
      "net-power-generated": ["alice.1"],
      "net-cell-pin-generated": ["alice.2", "bob.1"],
      "net-random": ["bob.2"],
    },
  );
const answer = (): LlmPartitionResult => ({
  blocks: [
    {
      id: "first",
      title: "Input",
      role: "input",
      units: ["U1"],
      reason: "receives signal",
    },
    {
      id: "second",
      title: "Output",
      role: "output",
      units: ["U2"],
      reason: "drives output",
    },
  ],
  uncertain: [],
});
it("ignores all placement, routes, annotations, drafting and layout-group content", () => {
  const d = sample();
  const before = JSON.stringify(describeCircuit(d, resolver));
  for (const i of d.instances) {
    i.placement = placement(987654, -543210, "horizontal", 90);
    i.reference = "DO_NOT_SEND_REFERENCE";
  }
  d.routes.push(
    createRoutePath({
      id: "DO_NOT_SEND_ROUTE",
      netId: d.nets[1]!.id,
      start: { kind: "terminal", instanceId: "alice", pinName: "2" },
      end: { kind: "terminal", instanceId: "bob", pinName: "1" },
      bends: [
        { x: 987654, y: -543210 },
        { x: 987654, y: 123456 },
      ],
      modes: ["manual", "manual", "manual"],
    }),
  );
  d.annotations.push({
    id: "text",
    kind: "instance-label",
    content: { runs: [{ kind: "text", value: "DO_NOT_SEND_Bias_Network" }] },
    anchor: { kind: "free", position: { x: 987654, y: -543210 } },
    alignment: "start",
    rotation: 0,
    locked: false,
  });
  d.drafting = {
    objects: [
      {
        id: "draft-text",
        kind: "text",
        locked: false,
        zIndex: 0,
        anchor: { kind: "free", position: { x: 987654, y: -543210 } },
        content: {
          runs: [{ kind: "text", value: "DO_NOT_SEND_Bias_Network" }],
        },
        alignment: "middle",
        rotation: 0,
      },
      {
        id: "box",
        kind: "rectangle",
        locked: false,
        zIndex: 0,
        anchor: { kind: "free", position: { x: 987654, y: -543210 } },
        center: { x: 987654, y: -543210 },
        width: 987654,
        height: 123456,
        rotation: 0,
        lineStyle: "solid",
      },
    ],
  };
  d.layoutGroups.push({
    id: "DO_NOT_SEND_GROUP",
    kind: "custom",
    objectIds: ["alice", "bob"],
    locked: true,
  });
  const payload = JSON.stringify(describeCircuit(d, resolver));
  expect(payload).toBe(before);
  expect(payload).not.toMatch(
    /987654|543210|DO_NOT_SEND|position|rotation|routes|drafting|net-power|net-cell/,
  );
});
it("canonicalizes Net tokens independently of source ids and all input ordering", () => {
  const d = sample();
  const before = describeCircuit(d, resolver);
  d.instances.reverse();
  d.nets.reverse();
  d.nets.forEach((net, index) => {
    net.id = `new-id-${index}`;
    net.terminals.reverse();
  });
  expect(JSON.stringify(describeCircuit(d, resolver))).toBe(
    JSON.stringify(before),
  );
});
it("includes only terminal/label names and anonymizes every device reference", () => {
  const d = sample();
  d.netlist = {
    name: "PRIVATE_CELL",
    formalParameters: [],
    terminals: [
      {
        id: "terminal",
        name: "VIN_SECRET",
        netId: d.nets[0]!.id,
        direction: "input",
        interfaceInstanceIds: [],
      },
    ],
  };
  d.connectivityEvidence.push({
    id: "label",
    kind: "name-claim",
    netId: d.nets[2]!.id,
    name: "VOUT_SECRET",
    scope: "local",
    owner: { kind: "net-label", annotationId: "label" },
  });
  const normal = JSON.stringify(describeCircuit(d, resolver));
  expect(normal).toContain("VIN_SECRET");
  expect(normal).toContain("VOUT_SECRET");
  expect(normal).not.toContain("PRIVATE_CELL");
  const anonymous = JSON.stringify(describeCircuit(d, resolver, true));
  expect(anonymous).not.toMatch(/alice|bob|SECRET|displayName/);
  expect(
    JSON.parse(anonymous).devices.map((i: { id: string }) => i.id),
  ).toEqual(["D1", "D2"]);
  const result = llmResultToPartition(d, resolver, answer());
  expect(result.partition.blocks.flatMap((b) => b.members).sort()).toEqual([
    "alice",
    "bob",
  ]);
});
it("groups units without flow or floorplan and completes omitted units", () => {
  const d = sample(),
    a = answer();
  a.blocks.pop();
  a.uncertain = ["U2"];
  const before = JSON.stringify(a);
  const result = llmResultToPartition(d, resolver, a);
  expect(result.partition).not.toHaveProperty("arrangement");
  expect(result.partition).not.toHaveProperty("flow");
  expect(result.partition.blocks.flatMap((b) => b.members).sort()).toEqual([
    "alice",
    "bob",
  ]);
  expect(JSON.stringify(a)).toBe(before);
});
it("measures human overlap, ARI and proposed floorplan directions independently", () => {
  const d = sample();
  d.instances[0]!.placement = placement(0, 0);
  d.instances[1]!.placement = placement(400, 0);
  const p = {
    blocks: [
      { id: "first", members: ["alice"] },
      { id: "second", members: ["bob"] },
    ],
    arrangement: { first: { x: 0, y: 0 }, second: { x: 240, y: 0 } },
  };
  expect(partitionMetrics(d, resolver, p, p)).toMatchObject({
    humanOverlap: 0,
    ari: 1,
    floorplanAgreement: 1,
  });
  p.arrangement!.second!.x = -240;
  expect(
    partitionMetrics(d, resolver, p, {
      blocks: [{ id: "all", members: ["alice", "bob"] }],
    }),
  ).toMatchObject({ ari: 0, floorplanAgreement: 0 });
  d.instances[1]!.placement = placement(0, 0);
  expect(partitionMetrics(d, resolver, p, p)).toMatchObject({
    humanOverlap: 0.5,
    floorplanAgreement: null,
  });
});

it("uses canonical aliases and unit membership for symmetric anonymous devices", () => {
  const d = circuit(
    Object.fromEntries(Array.from({ length: 12 }, (_, n) => [`m${n}`, "nmos"])),
    {},
  );
  const payload = describeCircuit(d, resolver, true);
  expect(payload.devices.map((i) => i.id)).toEqual(
    Array.from({ length: 12 }, (_, n) => `D${n + 1}`),
  );
  expect(
    payload.units.flatMap((u) => u.members.map((m) => m.id)).sort(),
  ).toEqual(payload.devices.map((i) => i.id).sort());
  d.instances.reverse();
  expect(describeCircuit(d, resolver, true)).toEqual(payload);
});

it("measures reference block recall by IoU and role match among recalled blocks", () => {
  const d = circuit(
    { a: "resistor", b: "resistor", c: "resistor", d: "resistor" },
    {},
  );
  const reference = {
    blocks: [
      { id: "ab", role: "gain" as const, members: ["a", "b"] },
      { id: "cd", role: "bias" as const, members: ["c", "d"] },
    ],
  };
  const proposed = {
    blocks: [
      { id: "a", role: "gain" as const, members: ["a"] },
      { id: "bcd", role: "other" as const, members: ["b", "c", "d"] },
    ],
  };
  expect(partitionMetrics(d, resolver, proposed, reference)).toMatchObject({
    blockRecall: 1,
    roleMatch: 0.5,
    ari: 0,
  });
  expect(
    partitionMetrics(
      d,
      resolver,
      { blocks: [{ id: "all", members: ["a", "b", "c", "d"] }] },
      {
        blocks: [
          { id: "a", members: ["a"] },
          { id: "b", members: ["b"] },
          { id: "cd", members: ["c", "d"] },
        ],
      },
    ),
  ).toMatchObject({ blockRecall: 1 / 3 });
});
