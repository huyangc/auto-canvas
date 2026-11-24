import { visibleInstanceBounds } from "@icm/derived";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { expect } from "vitest";
import { connectionsIntact, planAutoLayout } from "../src/auto-layout.js";
import { auditRouting } from "../src/routing-audit.js";
import { preview } from "../src/transaction.js";
import { circuit } from "./document-fixture.js";

// The single-stage check shared by differential-branches.test.ts and
// differential-branches.slow.test.ts. `quick` plans without the full search.

const resolver = new InMemorySymbolResolver(builtInSymbols);

export function checkSingleStage({
  rename,
  shuffle,
  degeneration = false,
  quick = false,
}: {
  rename: boolean;
  shuffle: boolean;
  degeneration?: boolean;
  quick?: boolean;
}) {
  const source = circuit(
    {
      L: "nmos",
      R: "nmos",
      U: "resistor",
      V: "resistor",
      ip: "port",
      im: "port",
      op: "port",
      om: "port",
      rail: "vdd-port",
      ...(degeneration
        ? {
            S1: "resistor",
            S2: "resistor",
            T: "nmos",
            bias: "port",
            ground: "ground",
          }
        : {}),
    },
    {
      ip: ["L.G", "ip.P"],
      im: ["R.G", "im.P"],
      ...(degeneration
        ? {
            left: ["L.S", "S1.1"],
            right: ["R.S", "S2.1"],
            tail: ["S1.2", "S2.2", "T.D"],
            bias: ["T.G", "bias.P"],
            ground: ["T.S", "ground.P"],
          }
        : { tail: ["L.S", "R.S"] }),
      op: ["R.D", "V.2", "op.P"],
      om: ["L.D", "U.2", "om.P"],
      supply: ["U.1", "V.1", "rail.P"],
    },
  );
  const aliases: Record<string, string> = rename
    ? { L: "Mz", R: "Ma", U: "Ry", V: "Rb", S1: "Rd", S2: "Rc", T: "Me" }
    : {};
  const named = (id: string) => aliases[id] ?? id;
  for (const instance of source.instances) instance.id = named(instance.id);
  if (shuffle) source.instances.reverse();
  if (shuffle) source.nets.reverse();
  const internal: Record<string, string> =
    rename && degeneration ? { left: "n71", right: "n04", tail: "n50" } : {};
  for (const net of source.nets) {
    net.id = "net-" + (internal[net.id] ?? net.id);
    if (shuffle) net.terminals.reverse();
    for (const t of net.terminals) t.instanceId = named(t.instanceId);
  }
  source.netlist = {
    name: "pair",
    formalParameters: [],
    terminals: ["ip", "im", "op", "om", ...(degeneration ? ["bias"] : [])].map(
      (id) => ({
        id,
        name: id,
        netId: "net-" + id,
        direction: id.startsWith("i") ? "input" : "output",
        interfaceInstanceIds: [id],
      }),
    ),
  };
  const result = planAutoLayout(source, resolver, {
    presentation: "netlist",
    ...(quick ? { search: { seed: 1, evaluations: 0 } } : {}),
  });
  expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  const replay = preview(source, resolver, result.edits);
  if (!replay.ok) throw Error("single-stage result must replay");
  const doc = replay.document;
  const positions = new Map(
    doc.instances.map((i) => [i.id, i.placement!.position]),
  );
  if (quick) {
    // Quick planning keeps each mirrored pair on one row and every Net
    // intact, but not the shared axis, the output row or the crossing count
    // that the full search reaches below.
    for (const [a, b] of [
      ["ip", "im"],
      ["L", "R"],
      ["U", "V"],
      ...(degeneration ? [["S1", "S2"]] : []),
    ])
      expect(positions.get(named(a!))!.y).toBe(positions.get(named(b!))!.y);
    expect(connectionsIntact(doc, resolver)).toBe(true);
    expect(auditRouting(doc, resolver).unsafeProblems).toEqual([]);
    return;
  }
  const p = positions.get("om")!,
    n = positions.get("op")!,
    axis = (p.x + n.x) / 2;
  expect(p.y).toBe(n.y);
  expect(p.y).toBeLessThan(
    Math.min(
      ...visibleInstanceBounds(doc, resolver)
        .filter((b) => ["L", "R", "U", "V"].map(named).includes(b.id))
        .map((b) => b.bounds.y),
    ),
  );
  for (const [a, b] of [
    ["ip", "im"],
    ["L", "R"],
    ["U", "V"],
    ...(degeneration ? [["S1", "S2"]] : []),
  ]) {
    const x = positions.get(named(a!))!,
      y = positions.get(named(b!))!;
    expect((x.x - axis) * (p.x - axis)).toBeGreaterThan(0);
    expect(x.x + y.x).toBe(2 * axis);
    expect(x.y).toBe(y.y);
  }
  expect(connectionsIntact(doc, resolver)).toBe(true);
  expect(auditRouting(doc, resolver).crossings).toBe(0);
}
