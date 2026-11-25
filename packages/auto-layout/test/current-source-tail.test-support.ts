import { circuit } from "./document-fixture.js";

// Documents shared by current-source-tail.test.ts (quick planning) and
// current-source-tail.slow.test.ts (the full search).

/** A resistor-loaded pair whose source resistors join above a current source. */
export function sourceResistorTail(reverse: boolean) {
  const tailPin = reverse ? "-" : "+";
  const doc = circuit(
    {
      P: "nmos",
      M: "nmos",
      A: "resistor",
      B: "resistor",
      C: "resistor",
      D: "resistor",
      J: "current-source",
      u: "port",
      v: "port",
      a: "port",
      b: "port",
      power: "vdd-port",
      gnd: "ground",
    },
    {
      u: ["P.G", "u.P"],
      v: ["M.G", "v.P"],
      a: ["M.D", "A.2", "a.P"],
      b: ["P.D", "B.2", "b.P"],
      power: ["A.1", "B.1", "power.P"],
      first: ["P.S", "D.2"],
      second: ["M.S", "C.1"],
      common: ["D.1", "C.2", "J." + tailPin],
      return: ["J." + (reverse ? "+" : "-"), "gnd.0"],
    },
  );
  const ext = ["u", "v", "a", "b"];
  if (reverse) {
    doc.instances.reverse();
    doc.nets.reverse();
    const alias = (id: string) =>
      ext.includes(id) ? id : "d" + id.toLowerCase();
    for (const i of doc.instances) i.id = alias(i.id);
    for (const [j, n] of doc.nets.entries()) {
      if (!ext.includes(n.id)) n.id = "w" + j;
      for (const t of n.terminals) t.instanceId = alias(t.instanceId);
    }
  }
  for (const net of doc.nets) net.id = "net-" + net.id;
  doc.netlist = {
    name: "gain",
    formalParameters: [],
    terminals: ext.map((id, i) => ({
      id,
      name: id,
      netId: "net-" + id,
      direction: i < 2 ? "input" : "output",
      interfaceInstanceIds: [id],
    })),
  };
  return { doc, tailPin };
}

/** An input pair with a tail current source and a feedback or follower load. */
export function inputStageTail(topology: "feedback" | "biased-follower") {
  const follower = topology === "biased-follower";
  const doc = circuit(
    {
      upper: "nmos",
      lower: "nmos",
      bias: "current-source",
      supply: "vdd-port",
      u: "port",
      v: "port",
      a: "port",
      b: "port",
      ...(follower
        ? {
            f1: "nmos",
            f2: "nmos",
            j1: "current-source",
            j2: "current-source",
          }
        : { r1: "resistor", r2: "resistor" }),
      m1: "pmos",
      m2: "pmos",
      ...(follower ? {} : { gnd: "ground" }),
    },
    {
      nu: ["u.P", "lower.G"],
      nv: ["v.P", "upper.G"],
      na: ["a.P", "upper.D", "m1.D", follower ? "f1.G" : "r1.2"],
      nb: ["b.P", "lower.D", "m2.D", follower ? "f2.G" : "r2.1"],
      common: ["upper.S", "lower.S", "bias.+"],
      rail: ["supply.P", "m1.S", "m2.S", ...(follower ? ["f1.D", "f2.D"] : [])],
      ...(follower
        ? {
            biasA: ["f1.S", "j1.+", "m1.G"],
            biasB: ["f2.S", "j2.+", "m2.G"],
          }
        : { feedback: ["r1.1", "r2.2", "m1.G", "m2.G"] }),
      ground: [
        "bias.-",
        ...(follower
          ? ["j1.-", "j2.-", "upper.B", "lower.B", "f1.B", "f2.B"]
          : ["gnd.0"]),
      ],
    },
  );
  if (follower) {
    doc.nets
      .find((n) => n.id === "rail")!
      .terminals.push(
        { instanceId: "m1", pinName: "B" },
        { instanceId: "m2", pinName: "B" },
      );
    doc.mosBulkDefaults = { nmosNetId: "ground", pmosNetId: "rail" };
    doc.connectivityEvidence.push(
      {
        id: "ground-source",
        kind: "spice-source",
        netId: "ground",
        sourceNetId: "0",
      },
      {
        id: "ground-claim",
        kind: "name-claim",
        netId: "ground",
        name: "0",
        scope: "global",
        powerDomain: "ground",
        owner: { kind: "global-declaration", sourceNetId: "0" },
      },
    );
  }
  doc.netlist = {
    name: "inputstage",
    formalParameters: [],
    terminals: ["u", "v", "a", "b"].map((id, k) => ({
      id,
      name: id,
      netId: "n" + id,
      direction: k < 2 ? "input" : "output",
      interfaceInstanceIds: [id],
    })),
  };
  return { doc, follower };
}

export function highSideSourceResistorTail(reverse: boolean) {
  const tailPin = reverse ? "-" : "+";
  const doc = circuit(
    {
      P: "pmos",
      M: "pmos",
      A: "resistor",
      B: "resistor",
      C: "resistor",
      D: "resistor",
      J: "current-source",
      u: "port",
      v: "port",
      a: "port",
      b: "port",
      power: "vdd-port",
      gnd: "ground",
    },
    {
      u: ["P.G", "u.P"],
      v: ["M.G", "v.P"],
      a: ["M.D", "A.2", "a.P"],
      b: ["P.D", "B.2", "b.P"],
      power: ["A.1", "B.1", "gnd.0"],
      first: ["P.S", "D.2"],
      second: ["M.S", "C.1"],
      common: ["D.1", "C.2", "J." + tailPin],
      return: ["J." + (reverse ? "+" : "-"), "power.P"],
    },
  );
  const ext = ["u", "v", "a", "b"];
  for (const net of doc.nets) net.id = "net-" + net.id;
  doc.netlist = {
    name: "gain",
    formalParameters: [],
    terminals: ext.map((id, i) => ({
      id,
      name: id,
      netId: "net-" + id,
      direction: i < 2 ? "input" : "output",
      interfaceInstanceIds: [id],
    })),
  };
  return { doc, tailPin };
}
