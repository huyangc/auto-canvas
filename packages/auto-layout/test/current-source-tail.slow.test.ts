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
  inputStageTail,
  sourceResistorTail,
} from "./current-source-tail.test-support.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);
it.each([false, true])(
  "draws the two source resistors joining above the current source (reverse=%s)",
  (reverse) => {
    const { doc, tailPin } = sourceResistorTail(reverse);
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

it.each(["feedback", "biased-follower"] as const)(
  "keeps the inputs outside both banks and the tail below a %s pair",
  (topology) => {
    const { doc, follower } = inputStageTail(topology);
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
