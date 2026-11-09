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
      members: ["alice"],
      reason: "receives signal",
    },
    {
      id: "second",
      title: "Output",
      role: "output",
      members: ["bob"],
      reason: "drives output",
    },
  ],
  flow: ["first", "second"],
  floorplan: [
    { block: "first", column: 0, row: 0 },
    { block: "second", column: 1, row: 0 },
  ],
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
  const a = answer();
  a.blocks[0]!.members = ["D1"];
  a.blocks[1]!.members = ["D2"];
  expect(
    llmResultToPartition(d, resolver, a, true).partition?.blocks.map(
      (b) => b.members,
    ),
    // Alias numbers are deliberately not in source order.
  ).toEqual([["bob"], ["alice"]]);
});
it.each([
  [
    "Missing device",
    (a: LlmPartitionResult) => {
      a.blocks.pop();
      a.floorplan.pop();
      a.flow.pop();
    },
  ],
  [
    "Duplicate device",
    (a: LlmPartitionResult) => {
      a.blocks[1]!.members.push("alice");
    },
  ],
  [
    "Unknown device",
    (a: LlmPartitionResult) => {
      a.blocks[0]!.members.push("ghost");
    },
  ],
  [
    "Missing floorplan",
    (a: LlmPartitionResult) => {
      a.floorplan.pop();
    },
  ],
  [
    "Duplicate floorplan",
    (a: LlmPartitionResult) => {
      a.floorplan.push({ block: "first", column: 3, row: 1 });
    },
  ],
  [
    "Occupied grid",
    (a: LlmPartitionResult) => {
      a.floorplan[1]!.column = 0;
    },
  ],
  [
    "Unknown floorplan",
    (a: LlmPartitionResult) => {
      a.floorplan.push({ block: "ghost", column: 2, row: 0 });
    },
  ],
  [
    "Invalid grid",
    (a: LlmPartitionResult) => {
      a.floorplan[0]!.row = Infinity;
    },
  ],
  [
    "Flow",
    (a: LlmPartitionResult) => {
      a.flow.push("ghost");
    },
  ],
  [
    "Duplicate or empty block",
    (a: LlmPartitionResult) => {
      a.blocks[1]!.id = "first";
    },
  ],
])("rejects %s", (error, mutate) => {
  const a = answer();
  mutate(a);
  const validated = llmResultToPartition(sample(), resolver, a);
  expect(validated.partition).toBeUndefined();
  expect(validated.errors.join("; ")).toContain(error);
});
it("uses fixed grid pitch, display titles and existing L0 merges without changing the proposal", () => {
  const a = answer(),
    before = JSON.stringify(a);
  expect(llmResultToPartition(sample(), resolver, a).partition).toMatchObject({
    blocks: [{ title: "Input" }, { title: "Output" }],
    arrangement: { first: { x: 0, y: 0 }, second: { x: 240, y: 0 } },
  });
  const mirror = circuit(
    { alice: "nmos", bob: "nmos" },
    {
      g: ["alice.G", "alice.D", "bob.G"],
      s: ["alice.S", "bob.S"],
      o: ["bob.D"],
    },
  );
  const payload = describeCircuit(mirror, resolver, true);
  expect(payload.structures[0]?.kind).toBe("current-mirror");
  expect(JSON.stringify(payload.structures)).not.toMatch(/alice|bob/);
  const validated = llmResultToPartition(mirror, resolver, a);
  expect(validated.l0Merges).toBe(1);
  expect(validated.partition?.blocks[0]?.members).toEqual(["alice", "bob"]);
  expect(JSON.stringify(a)).toBe(before);
});
it("measures human overlap, ARI and proposed floorplan directions independently", () => {
  const d = sample();
  d.instances[0]!.placement = placement(0, 0);
  d.instances[1]!.placement = placement(400, 0);
  const p = llmResultToPartition(d, resolver, answer()).partition!;
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

it("numbers anonymous devices independently of their source order", () => {
  const symbols = Object.fromEntries(
    Array.from({ length: 12 }, (_, n) => [
      `m${String(n).padStart(2, "0")}`,
      "nmos",
    ]),
  );
  const d = circuit(symbols, {});
  const aliases = (
    describeCircuit(d, resolver, true).devices as {
      id: string;
      pins: unknown[];
    }[]
  ).map((x) => x.id);
  expect(aliases).toEqual(aliases.map((_, n) => `D${n + 1}`));
  const result = {
    blocks: aliases.map((id, n) => ({
      id: `b${n}`,
      title: "t",
      role: "other" as const,
      members: [id],
      reason: "r",
    })),
    flow: [],
    floorplan: aliases.map((_, n) => ({
      block: `b${n}`,
      column: n % 17,
      row: 0,
    })),
  };
  const { partition, errors } = llmResultToPartition(d, resolver, result, true);
  expect(errors).toEqual([]);
  const order = partition!.blocks.map((b) => b.members[0]);
  expect([...order].sort()).toEqual(Object.keys(symbols));
  expect(order).not.toEqual(Object.keys(symbols));
});
