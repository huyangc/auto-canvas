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
import {
  highSideSourceResistorTail,
  inputStageTail,
  sourceResistorTail,
} from "./current-source-tail.test-support.js";
import { circuit } from "./document-fixture.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);
const quick = { seed: 1, evaluations: 0 };

// The full-search geometry of these four inputs is checked in
// current-source-tail.slow.test.ts. Quick planning keeps the validity, Net and
// routing-safety checks, plus the original geometry that quick planning still
// satisfies, for the inputs where it does.
it.each([false, true])(
  "quick planning draws the source-resistor tail validly (reverse=%s)",
  (reverse) => {
    const { doc, tailPin } = sourceResistorTail(reverse);
    const plan = planAutoLayout(doc, resolver, {
      presentation: "netlist",
      search: quick,
    });
    expect(plan.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const result = preview(doc, resolver, plan.edits);
    if (!result.ok) throw Error("layout transaction must replay");
    expect(equivalentTerminals(doc, result.document, resolver)).toBe(true);
    expect(auditRouting(result.document, resolver).unsafeProblems).toEqual([]);
    const drawing = result.document,
      pins = pinPoints(drawing, resolver);
    const point = (id: string, pin = "P") =>
      pins.find((x) => x.instanceId === id && x.pinName === pin)!.point;
    if (reverse) {
      const a = point("a"),
        axis = (a.x + point("b").x) / 2;
      expect((point("v").x - axis) * (a.x - axis)).toBeGreaterThan(0);
    } else {
      const tail = drawing.instances.find(
        (i) => i.symbolId === "current-source",
      )!;
      expect(tail.placement!.position.y).toBeGreaterThan(
        point(tail.id, tailPin).y,
      );
    }
  },
  60_000,
);

it.each(["feedback", "biased-follower"] as const)(
  "quick planning keeps the tail below a %s pair on its axis",
  (topology) => {
    const { doc, follower } = inputStageTail(topology);
    const plan = planAutoLayout(doc, resolver, {
      presentation: "netlist",
      search: quick,
    });
    expect(plan.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const replay = preview(doc, resolver, plan.edits);
    if (!replay.ok) throw Error("layout must replay");
    const d = replay.document,
      point = (id: string) =>
        d.instances.find((i) => i.id === id)!.placement!.position;
    const axis = (point("a").x + point("b").x) / 2;
    if (!follower) {
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
    }
    expect((point("u").x - axis) * (point("b").x - axis)).toBeGreaterThan(0);
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
    const audit = auditRouting(d, resolver);
    expect(audit.unsafeProblems).toEqual([]);
    expect(audit.crossings).toBeLessThanOrEqual(follower ? 2 : 0);
  },
  60_000,
);

it("leaves the current source of a high-side pair between the supply and the pair (R170)", () => {
  const doc = circuit(
    {
      upper: "pmos",
      lower: "pmos",
      bias: "current-source",
      supply: "vdd-port",
      u: "port",
      v: "port",
      a: "port",
      b: "port",
    },
    {
      nu: ["u.P", "lower.G"],
      nv: ["v.P", "upper.G"],
      na: ["a.P", "upper.D"],
      nb: ["b.P", "lower.D"],
      common: ["upper.S", "lower.S", "bias.-"],
      rail: ["supply.P", "bias.+"],
    },
  );
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
    y = (id: string) =>
      d.instances.find((i) => i.id === id)!.placement!.position.y;
  const pair = visibleInstanceBounds(d, resolver).filter(
    (b) => b.id === "upper" || b.id === "lower",
  );
  expect(pair).toHaveLength(2);
  expect(y("supply")).toBeLessThan(y("bias"));
  expect(y("bias")).toBeLessThan(Math.min(...pair.map((b) => b.bounds.y)));
  expect(
    equivalentTerminals(
      netlistPresentation(doc, resolver).document,
      d,
      resolver,
    ),
  ).toBe(true);
  expect(auditRouting(d, resolver).crossings).toBe(0);
}, 60000);
it.each([false, true])(
  "quick planning preserves the high-side source-resistor circuit (reverse=%s)",
  (reverse) => {
    const { doc } = highSideSourceResistorTail(reverse);
    const plan = planAutoLayout(doc, resolver, {
      presentation: "netlist",
      search: quick,
    });
    expect(plan.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const result = preview(doc, resolver, plan.edits);
    if (!result.ok) throw Error("layout transaction must replay");
    expect(equivalentTerminals(doc, result.document, resolver)).toBe(true);
    expect(auditRouting(result.document, resolver).unsafeProblems).toEqual([]);
  },
  60_000,
);
