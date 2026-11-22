import {
  contactRequiresJunctionDot,
  deriveDocumentContactEvidence,
  visibleInstanceBounds,
} from "@icm/derived";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { expect, it } from "vitest";
import { planAutoLayout } from "../src/auto-layout.js";
import { pinPoints } from "../src/geometry.js";
import { netlistPresentation } from "../src/netlist-presentation.js";
import { auditRouting } from "../src/routing-audit.js";
import { equivalentTerminals, preview } from "../src/transaction.js";
import { circuit } from "./document-fixture.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);
it.each([false, true])(
  "draws the two source resistors joining above the current source (reverse=%s)",
  (reverse) => {
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
    const plan = planAutoLayout(doc, resolver, { presentation: "netlist" });
    expect(plan.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const result = preview(doc, resolver, plan.edits);
    if (!result.ok) throw Error("layout transaction must replay");
    const drawing = result.document,
      pins = pinPoints(drawing, resolver);
    const point = (id: string, pin = "P") =>
      pins.find((x) => x.instanceId === id && x.pinName === pin)!.point;
    const a = point("a"),
      b = point("b"),
      axis = (a.x + b.x) / 2;
    expect((point("u").x - axis) * (b.x - axis)).toBeGreaterThan(0);
    expect((point("v").x - axis) * (a.x - axis)).toBeGreaterThan(0);
    expect(a.y).toBe(b.y);
    const tail = drawing.instances.find(
      (i) => i.symbolId === "current-source",
    )!;
    const foot = point(tail.id, tailPin);
    expect(foot.x).toBe(axis);
    expect(tail.placement!.position.y).toBeGreaterThan(foot.y);
    const body = visibleInstanceBounds(drawing, resolver).filter((v) =>
      drawing.instances.some(
        (i) =>
          i.id === v.id &&
          ["nmos", "resistor", "current-source"].includes(i.symbolId),
      ),
    );
    expect(a.y).toBeLessThan(Math.min(...body.map((v) => v.bounds.y)));
    const shared = drawing.nets.find((n) =>
      n.terminals.some(
        (t) => t.instanceId === tail.id && t.pinName === tailPin,
      ),
    )!;
    const tee = deriveDocumentContactEvidence(drawing, resolver).contacts.find(
      (c) =>
        c.netId === shared.id &&
        c.point.x === axis &&
        c.point.y < foot.y &&
        contactRequiresJunctionDot(c),
    );
    expect(tee?.branchDirections).toEqual(
      expect.arrayContaining([
        { x: -1, y: 0 },
        { x: 1, y: 0 },
        { x: 0, y: 1 },
      ]),
    );
    expect(equivalentTerminals(doc, drawing, resolver)).toBe(true);
    expect(auditRouting(drawing, resolver).crossings).toBe(0);
  },
  60_000,
);

it.each(["high-side", "feedback", "biased-follower"] as const)(
  "keeps the inputs outside both banks and the tail below a %s pair",
  (topology) => {
    const high = topology === "high-side";
    const follower = topology === "biased-follower";
    const doc = circuit(
      {
        upper: high ? "pmos" : "nmos",
        lower: high ? "pmos" : "nmos",
        bias: "current-source",
        supply: "vdd-port",
        u: "port",
        v: "port",
        a: "port",
        b: "port",
        ...(high
          ? {}
          : {
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
            }),
      },
      {
        nu: ["u.P", "lower.G"],
        nv: ["v.P", "upper.G"],
        na: [
          "a.P",
          "upper.D",
          ...(high ? [] : ["m1.D", follower ? "f1.G" : "r1.2"]),
        ],
        nb: [
          "b.P",
          "lower.D",
          ...(high ? [] : ["m2.D", follower ? "f2.G" : "r2.1"]),
        ],
        common: ["upper.S", "lower.S", high ? "bias.-" : "bias.+"],
        rail: [
          "supply.P",
          ...(high
            ? ["bias.+"]
            : ["m1.S", "m2.S", ...(follower ? ["f1.D", "f2.D"] : [])]),
        ],
        ...(high
          ? {}
          : {
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
            }),
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
    const plan = planAutoLayout(doc, resolver, { presentation: "netlist" });
    expect(plan.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const replay = preview(doc, resolver, plan.edits);
    if (!replay.ok) throw Error("layout must replay");
    const d = replay.document,
      point = (id: string) =>
        d.instances.find((i) => i.id === id)!.placement!.position;
    const axis = (point("a").x + point("b").x) / 2;
    const bodies = visibleInstanceBounds(d, resolver).filter((b) =>
      doc.instances.some(
        (i) =>
          i.id === b.id &&
          !["port", "vdd-port", "ground", "current-source"].includes(
            i.symbolId,
          ),
      ),
    );
    expect(Math.min(point("u").x, point("v").x)).toBeLessThan(
      Math.min(...bodies.map((b) => b.bounds.x)),
    );
    expect(Math.max(point("u").x, point("v").x)).toBeGreaterThan(
      Math.max(...bodies.map((b) => b.bounds.x + b.bounds.width)),
    );
    expect((point("u").x - axis) * (point("b").x - axis)).toBeGreaterThan(0);
    expect(point("a").y).toBe(point("b").y);
    expect(point("a").y).toBeLessThan(
      Math.min(...bodies.map((b) => b.bounds.y)),
    );
    expect(point("bias").x).toBe(axis);
    expect(
      deriveDocumentContactEvidence(d, resolver).contacts.some(
        (c) =>
          c.netId === "common" &&
          c.point.x === axis &&
          c.point.y < point("bias").y &&
          contactRequiresJunctionDot(c),
      ),
    ).toBe(true);
    expect(
      equivalentTerminals(
        netlistPresentation(doc, resolver).document,
        d,
        resolver,
      ),
    ).toBe(true);
    expect(auditRouting(d, resolver).crossings).toBeLessThanOrEqual(
      follower ? 2 : 0,
    );
  },
  60000,
);
