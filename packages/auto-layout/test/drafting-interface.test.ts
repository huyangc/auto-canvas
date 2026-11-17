import { createRoutePath, type SchematicDocument } from "@icm/model";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { describe, expect, it } from "vitest";
import { planAutoLayout } from "../src/index.js";
import { placement } from "../src/geometry.js";
import { preview } from "../src/transaction.js";
import {
  detachedDraftingInterfaces,
  preserveDraftingInterfaces,
} from "../src/drafting-interface.js";
import { missingConnections } from "../src/routing-audit.js";
import type { AutoLayoutResult } from "../src/types.js";
import { circuit } from "./document-fixture.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);

const frame = (center = { x: 60, y: 0 }, size = { width: 80, height: 60 }) => ({
  id: "block",
  kind: "rectangle" as const,
  locked: false,
  zIndex: 0,
  anchor: { kind: "free" as const, position: center },
  center,
  ...size,
  rotation: 0,
  lineStyle: "solid" as const,
});

const lead = (id: string, netId: string, instanceId: string, end: string) =>
  createRoutePath({
    id,
    netId,
    start: { kind: "terminal", instanceId, pinName: "P" },
    end: { kind: "junction", junctionId: end },
    bends: [],
    modes: ["manual"],
  });

const anchor = (id: string, netId: string, x: number, y: number) => ({
  id,
  netId,
  position: { x, y },
  role: "route-anchor" as const,
});

/** A frame whose left edge (x = 20) carries net-a and right edge (x = 100)
 * carries net-b, each by one open lead from a port. */
function frameDocument() {
  const d = circuit(
    { a: "port", b: "port" },
    { "net-a": ["a.P"], "net-b": ["b.P"] },
  );
  d.instances[0]!.placement = placement(-100, 0);
  d.instances[1]!.placement = placement(160, 0, "horizontal");
  d.drafting = { objects: [frame()] };
  d.junctions = [
    anchor("left", "net-a", 20, 0),
    anchor("right", "net-b", 100, 0),
  ];
  d.routes = [
    lead("lead-a", "net-a", "a", "left"),
    lead("lead-b", "net-b", "b", "right"),
  ];
  d.netlist = {
    name: "frame",
    formalParameters: [],
    terminals: ["a", "b"].map((id) => ({
      id: `terminal-${id}`,
      name: id,
      direction: "passive" as const,
      netId: `net-${id}`,
      interfaceInstanceIds: [id],
    })),
  };
  return d;
}

/** Stand-in for a planner result that drops the given routes. */
const losing = (...routeIds: string[]): AutoLayoutResult => ({
  edits: routeIds.map((routeId) => ({
    kind: "remove_route_geometry",
    routeId,
  })),
  groups: [{ id: "g", kind: "matched-pair", members: ["a", "b"] }],
  diagnostics: [
    { severity: "warning", code: "PLANNER", rule: "planner", message: "x" },
  ],
});

function detached(d: SchematicDocument, plan: AutoLayoutResult) {
  const tx = preview(d, resolver, plan.edits);
  if (!tx.ok) throw new Error(JSON.stringify(tx.diagnostics));
  return detachedDraftingInterfaces(d, tx.document, resolver);
}

/** R161 refusal: no edits, no groups, exactly one error naming the frame. */
const refused = (plan: AutoLayoutResult) => {
  expect(plan.edits).toEqual([]);
  expect(plan.groups).toEqual([]);
  expect(plan.diagnostics).toEqual([
    expect.objectContaining({
      severity: "error",
      code: "AUTO_LAYOUT_DRAFTING_INTERFACE_UNSUPPORTED",
      rule: "drafting-interface",
    }),
  ]);
  expect(plan.diagnostics[0]!.message).toContain("block");
};

describe("R161 drawn frame interfaces", () => {
  it("refuses, leaving the source unchanged, when a contact is detached", () => {
    const d = frameDocument();
    const candidate = losing("lead-a");
    expect(detached(d, candidate)).toEqual(["block"]);
    refused(preserveDraftingInterfaces(d, resolver, candidate));
  });

  it("refuses the same way when the source itself is incomplete", () => {
    const d = frameDocument();
    // A second, unrouted terminal on net-a: the source misses a connection.
    d.instances.push({
      id: "r",
      symbolId: "resistor",
      placement: placement(-100, 80),
    });
    d.nets[0]!.terminals.push({ instanceId: "r", pinName: "1" });
    expect(missingConnections(d, resolver)).toBeGreaterThan(0);
    refused(preserveDraftingInterfaces(d, resolver, losing("lead-a")));
  });

  it("returns the candidate itself when no interface is detached", () => {
    const candidate = losing("lead-a");
    // No rectangles at all.
    const plain = frameDocument();
    plain.drafting = { objects: [] };
    expect(preserveDraftingInterfaces(plain, resolver, candidate)).toBe(
      candidate,
    );
    // A box touched by one Net is an annotation, not a functional block.
    const note = frameDocument();
    note.routes = note.routes.filter((r) => r.id !== "lead-b");
    note.junctions = note.junctions.filter((j) => j.id !== "right");
    expect(preserveDraftingInterfaces(note, resolver, candidate)).toBe(
      candidate,
    );
    // A plan that keeps every contact.
    const kept = frameDocument();
    const touchesNothing: AutoLayoutResult = {
      ...losing(),
      edits: [
        // The planner re-draws both leads onto the same frame contacts.
        { kind: "remove_route_geometry", routeId: "lead-a" },
        { kind: "remove_route_geometry", routeId: "lead-b" },
        ...kept.routes.map((route) => ({
          kind: "set_route_path" as const,
          route: { ...route, id: `${route.id}-new` },
        })),
      ],
    };
    expect(detached(kept, touchesNothing)).toEqual([]);
    expect(preserveDraftingInterfaces(kept, resolver, touchesNothing)).toBe(
      touchesNothing,
    );
  });

  it("counts two Nets on one frame edge as distinct contacts", () => {
    // Both contacts on the left edge; the right edge is bare.
    const d = frameDocument();
    d.junctions = [
      anchor("left", "net-a", 20, 0),
      anchor("low", "net-b", 20, 20),
    ];
    d.instances[1]!.placement = placement(-100, 20);
    d.routes = [
      lead("lead-a", "net-a", "a", "left"),
      createRoutePath({
        id: "lead-b",
        netId: "net-b",
        start: { kind: "terminal", instanceId: "b", pinName: "P" },
        end: { kind: "junction", junctionId: "low" },
        bends: [],
        modes: ["manual"],
      }),
    ];
    expect(detached(d, losing())).toEqual([]);
    // Losing either one detaches the frame although the other Net stays.
    expect(detached(d, losing("lead-b"))).toEqual(["block"]);
    refused(preserveDraftingInterfaces(d, resolver, losing("lead-b")));
    refused(preserveDraftingInterfaces(d, resolver, losing("lead-a")));
  });
});

describe("R161 in planAutoLayout", () => {
  /** Ports on both sides of a block, a load on the output; the planner
   * re-routes pin groups and drops the open leads into the frame. */
  function plannerFixture() {
    const d = circuit(
      { input: "port", output: "port", load: "resistor", ground: "ground" },
      {
        "net-input": ["input.P"],
        "net-output": ["output.P", "load.1"],
        "net-ground": ["load.2", "ground.0"],
      },
    );
    d.instances[0]!.placement = placement(-100, 0);
    d.instances[1]!.placement = placement(100, 0, "horizontal");
    d.instances[2]!.placement = placement(80, 50);
    d.instances[3]!.placement = placement(80, 100);
    d.drafting = {
      objects: [frame({ x: 0, y: 0 }, { width: 100, height: 80 })],
    };
    d.junctions = [
      anchor("left", "net-input", -50, 0),
      anchor("right", "net-output", 50, 0),
      { ...anchor("branch", "net-output", 80, 0), role: "branch" as const },
    ];
    const wire = (
      id: string,
      netId: string,
      start: Parameters<typeof createRoutePath>[0]["start"],
      end: Parameters<typeof createRoutePath>[0]["end"],
    ) =>
      createRoutePath({ id, netId, start, end, bends: [], modes: ["manual"] });
    d.routes = [
      lead("lead-left", "net-input", "input", "left"),
      lead("lead-right", "net-output", "output", "branch"),
      wire(
        "frame-wire",
        "net-output",
        { kind: "junction", junctionId: "branch" },
        { kind: "junction", junctionId: "right" },
      ),
      wire(
        "load-wire",
        "net-output",
        { kind: "junction", junctionId: "branch" },
        { kind: "terminal", instanceId: "load", pinName: "1" },
      ),
      wire(
        "ground-wire",
        "net-ground",
        { kind: "terminal", instanceId: "load", pinName: "2" },
        { kind: "terminal", instanceId: "ground", pinName: "0" },
      ),
    ];
    d.netlist = {
      name: "frame",
      formalParameters: [],
      terminals: ["input", "output"].map((id) => ({
        id: `terminal-${id}`,
        name: id,
        direction: "passive" as const,
        netId: `net-${id}`,
        interfaceInstanceIds: [id],
      })),
    };
    return d;
  }

  it("refuses a source whose frame leads the plan would drop", () => {
    const d = plannerFixture();
    expect(missingConnections(d, resolver)).toBe(0);
    refused(planAutoLayout(d, resolver));
  });

  it("lays out the same circuit when the frame is not a functional block", () => {
    const d = plannerFixture();
    d.drafting = { objects: [] };
    const plan = planAutoLayout(d, resolver);
    expect(plan.edits.length).toBeGreaterThan(0);
    expect(
      plan.diagnostics.filter((x) => x.rule === "drafting-interface"),
    ).toEqual([]);
  });

  it.each(["during", "deadline"] as const)(
    "still refuses when search stops %s",
    (when) => {
      const controller = new AbortController();
      const plan = planAutoLayout(plannerFixture(), resolver, {
        search: {
          seed: 1,
          evaluations: 100,
          signal: controller.signal,
          ...(when === "deadline" ? { deadline: 0 } : {}),
          onProgress: (progress) => {
            if (when === "during" && progress.evaluations === 4)
              controller.abort();
          },
        },
      });
      refused(plan);
    },
  );
});
