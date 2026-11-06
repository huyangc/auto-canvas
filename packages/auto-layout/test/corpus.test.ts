import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import {
  deriveElectricalTopologyProjection,
  endpointKey,
  visibleInstanceBounds,
} from "@icm/derived";
import { executeTransaction } from "@icm/edit-engine";
import { compareElectricalGraphs, projectElectricalGraph } from "@icm/netlist";
import { parseProject } from "@icm/project-protocol";
import { builtInSymbols, createProjectSymbolResolver } from "@icm/symbols";
import { planAutoLayout } from "../src/index.js";
import { enclosingBox, pinPoints } from "../src/geometry.js";
import { classifyNets } from "../src/net-roles.js";
import cases from "./corpus-cases.json";

function expectedReanchoredAnnotations(
  document: Parameters<typeof planAutoLayout>[0],
) {
  return document.annotations.map((annotation) =>
    annotation.anchor.kind === "route"
      ? {
          ...annotation,
          anchor: {
            kind: "free",
            position: annotation.anchor.fallbackPosition,
          },
        }
      : annotation,
  );
}

it.each(cases)(
  "$id: real transactions preserve electricity and satisfy placement",
  (fixture) => {
    const project = parseProject(readFileSync(fixture.file, "utf8"));
    const document = project.documents.find(
      (d) => d.id === (fixture.documentId ?? project.topDocumentId),
    )!;
    const resolver = createProjectSymbolResolver(project, builtInSymbols);
    const beforeGraph = projectElectricalGraph(project);
    const beforeTopology = deriveElectricalTopologyProjection(
      document,
      resolver,
    );
    const plan = planAutoLayout(document, resolver);
    expect(plan.diagnostics).toEqual([]);
    expect(JSON.stringify(plan.edits)).toBe(
      JSON.stringify(planAutoLayout(document, resolver).edits),
    );
    expect(
      plan.groups.map((g) => [g.kind, ...[...g.members].sort()]).sort(),
    ).toEqual([...fixture.groups].sort());
    const result = executeTransaction(
      document,
      {
        transactionId: `auto-${fixture.id}`,
        documentId: document.id,
        expectedRevision: document.revision,
        actor: { kind: "agent", id: "auto-layout-test" },
        edits: plan.edits,
      },
      { symbolResolver: resolver },
    );
    expect(result, JSON.stringify(result.diagnostics)).toHaveProperty(
      "applied",
      true,
    );
    if (!result.ok) return;
    const after = result.document;
    if (beforeGraph.status === "ready") {
      const afterGraph = projectElectricalGraph({
        ...project,
        documents: project.documents.map((d) =>
          d.id === document.id ? after : d,
        ),
      });
      expect(afterGraph.status).toBe("ready");
      if (afterGraph.status === "ready")
        expect(
          compareElectricalGraphs(beforeGraph.graph, afterGraph.graph),
        ).toBe("equal");
    } else {
      const afterTopology = deriveElectricalTopologyProjection(after, resolver);
      const terminals = (entries: ReadonlyMap<string, string>) =>
        [...entries].filter(([key]) => key.startsWith("terminal:")).sort();
      expect(terminals(afterTopology.endpointToBaseNet)).toEqual(
        terminals(beforeTopology.endpointToBaseNet),
      );
    }
    for (const instance of after.instances) {
      expect(instance.placement).not.toBeNull();
      expect(instance.placement!.position.x % after.presentation.grid).toBe(0);
      expect(instance.placement!.position.y % after.presentation.grid).toBe(0);
    }
    const pins = pinPoints(after, resolver).map(
      (p) => `${p.point.x},${p.point.y}`,
    );
    expect(new Set(pins).size).toBe(pins.length);
    const boxes = visibleInstanceBounds(after, resolver);
    for (let i = 0; i < boxes.length; i++)
      for (const b of boxes.slice(i + 1)) {
        const a = boxes[i]!;
        expect(
          a.bounds.x < b.bounds.x + b.bounds.width &&
            b.bounds.x < a.bounds.x + a.bounds.width &&
            a.bounds.y < b.bounds.y + b.bounds.height &&
            b.bounds.y < a.bounds.y + a.bounds.height,
          `${a.id}/${b.id} overlap`,
        ).toBe(false);
      }
    const oldBox = enclosingBox(document, resolver);
    const resultBox = enclosingBox(after, resolver);
    expect(Math.abs(resultBox.x - oldBox.x)).toBeLessThanOrEqual(
      after.presentation.grid / 2,
    );
    expect(Math.abs(resultBox.y - oldBox.y)).toBeLessThanOrEqual(
      after.presentation.grid / 2,
    );
    for (const route of after.routes) {
      expect(document.routes.some((r) => r.id === route.id)).toBe(false);
      const end = route.legs.at(-1)!.to;
      expect(end.kind).toBe("endpoint");
      if (end.kind !== "endpoint") continue;
      const startNet = beforeTopology.endpointToBaseNet.get(
        endpointKey(route.start),
      );
      expect(startNet).toBeDefined();
      expect(
        beforeTopology.endpointToBaseNet.get(endpointKey(end.endpoint)),
      ).toBe(startNet);
    }
    expect(after.drafting).toEqual(document.drafting);
    expect(after.annotations.map((a) => a.id).sort()).toEqual(
      document.annotations.map((a) => a.id).sort(),
    );
    for (const annotation of expectedReanchoredAnnotations(document)) {
      const actual = after.annotations.find((a) => a.id === annotation.id)!;
      expect(actual.content).toEqual(annotation.content);
      expect(actual.binding).toEqual(annotation.binding);
      // Instance transforms legitimately move attached annotations. Route
      // labels, however, must retain every field except the approved anchor.
      if (
        document.annotations.find((a) => a.id === annotation.id)!.anchor
          .kind === "route"
      )
        expect(actual).toEqual(annotation);
    }
    for (const group of document.layoutGroups)
      expect(after.layoutGroups.find((g) => g.id === group.id)).toEqual(group);
    const placed = (id: string) =>
      after.instances.find((i) => i.id === id)!.placement!;
    for (const group of plan.groups) {
      const [left, right] = group.members.map(placed);
      expect(left!.position.y).toBe(right!.position.y);
      expect(right!.position.x - left!.position.x).toBe(100);
      expect(left!.mirror).toBe(
        group.kind === "differential-pair" ? "none" : "horizontal",
      );
      expect(right!.mirror).toBe(
        group.kind === "differential-pair" ? "horizontal" : "none",
      );
      if (group.tailInstanceId) {
        expect(placed(group.tailInstanceId).position.x).toBe(
          (left!.position.x + right!.position.x) / 2,
        );
        expect(placed(group.tailInstanceId).position.y).toBe(
          left!.position.y + 120,
        );
      }
    }
    if (fixture.id === "five-t-ota") {
      expect(placed("M1").position.y).toBeLessThan(placed("M3").position.y);
      expect(placed("M2").position.y).toBeLessThan(placed("M4").position.y);
      expect(placed("M3").position.y).toBeLessThan(placed("M5").position.y);
      expect(placed("M1").position.x + placed("M2").position.x).toBe(
        placed("M3").position.x + placed("M4").position.x,
      );
      expect(placed("M2").mirror).toBe("horizontal");
    }
    if (fixture.id === "two-inverters")
      for (const [p, n] of [
        ["XDP", "XDN"],
        ["XSP", "XSN"],
      ]) {
        expect(placed(p!).position.y).toBeLessThan(placed(n!).position.y);
        expect(placed(p!).position.x).toBe(placed(n!).position.x);
      }
    if (fixture.id === "common-source")
      expect(placed("RD").position.y).toBeLessThan(placed("XM1").position.y);
    if (["five-t-ota", "two-inverters"].includes(fixture.id)) {
      const roles = classifyNets(document, resolver);
      const devices = after.instances.filter(
        (i) =>
          !["port", "port-filled", "ground", "vdd-port"].includes(i.symbolId),
      );
      for (const terminal of after.netlist!.terminals)
        for (const id of terminal.interfaceInstanceIds) {
          const p = placed(id);
          if (roles.byNet.get(terminal.netId) === "input") {
            expect(p.position.x).toBeLessThanOrEqual(
              Math.min(...devices.map((i) => i.placement!.position.x)),
            );
            expect(p.rotation).toBe(0);
          }
          if (roles.byNet.get(terminal.netId) === "output") {
            expect(p.position.x).toBeGreaterThanOrEqual(
              Math.max(...devices.map((i) => i.placement!.position.x)),
            );
            expect(p.rotation).toBe(0);
            expect(p.mirror).toBe("horizontal");
          }
          if (roles.byNet.get(terminal.netId) === "supply")
            expect(p.rotation).toBe(90);
          if (roles.byNet.get(terminal.netId) === "ground")
            expect(p.rotation).toBe(270);
        }
    }
    const roles = classifyNets(document, resolver);
    const ports = after.instances.filter((i) =>
      ["port", "port-filled"].includes(i.symbolId),
    );
    for (const side of ["input", "output", "supply", "ground"]) {
      const members = ports.filter((i) => {
        const role = roles.byNet.get(roles.pinNet(i.id, "P") ?? "");
        return side === "input"
          ? !["output", "supply", "ground"].includes(role ?? "")
          : role === side;
      });
      const vertical = side === "input" || side === "output";
      const coordinates = members
        .map((i) =>
          vertical ? i.placement!.position.y : i.placement!.position.x,
        )
        .sort((a, b) => a - b);
      for (let n = 1; n < coordinates.length; n++)
        expect(coordinates[n]! - coordinates[n - 1]!).toBeGreaterThanOrEqual(
          40,
        );
      if (side === "output")
        for (const i of members)
          expect(i.placement).toMatchObject({
            rotation: 0,
            mirror: "horizontal",
          });
    }
    const allPins = pinPoints(after, resolver);
    const pin = (id: string, name: string) =>
      allPins.find((p) => p.instanceId === id && p.pinName === name)!.point;
    if (["rlc", "common-source"].includes(fixture.id)) {
      const hosts = new Set<string>();
      for (const ground of after.instances.filter(
        (i) => i.symbolId === "ground",
      )) {
        const point = pin(ground.id, "0");
        const net = roles.pinNet(ground.id, "0");
        const host = allPins.find(
          (p) =>
            p.instanceId !== ground.id &&
            p.pinName !== "B" &&
            roles.pinNet(p.instanceId, p.pinName) === net &&
            p.point.x === point.x &&
            p.point.y + 40 === point.y,
        );
        expect(host, ground.id).toBeDefined();
        expect(hosts.has(host!.instanceId)).toBe(false);
        hosts.add(host!.instanceId);
      }
    }
    const horizontal = (id: string) => {
      expect(pin(id, "1").y).toBe(pin(id, "2").y);
      expect(pin(id, "1").x).not.toBe(pin(id, "2").x);
    };
    const vertical = (id: string, a: string, b: string) => {
      expect(pin(id, a).x).toBe(pin(id, b).x);
      expect(pin(id, a).y).not.toBe(pin(id, b).y);
    };
    if (fixture.id === "rlc") {
      for (const [a, b] of [
        ["V1", "R1"],
        ["R1", "L1"],
        ["L1", "C1"],
      ])
        expect(placed(a!).position.x).toBeLessThan(placed(b!).position.x);
      expect(placed("R1").position.y).toBe(placed("L1").position.y);
      horizontal("R1");
      horizontal("L1");
      vertical("V1", "+", "-");
      vertical("C1", "1", "2");
    }
    if (["rc-lowpass", "rc-highpass"].includes(fixture.id)) {
      const [series, shunt] =
        fixture.id === "rc-lowpass" ? ["R1", "C1"] : ["C1", "R1"];
      expect(placed("V1").position.x).toBeLessThan(placed(series!).position.x);
      expect(placed(series!).position.x).toBeLessThan(
        placed(shunt!).position.x,
      );
      horizontal(series!);
      vertical(shunt!, "1", "2");
    }
    if (fixture.id === "two-stage-symbolic") {
      expect(placed("X7").position.x).toBeLessThan(placed("X8").position.x);
      expect(placed("X7").position.y).toBe(placed("X8").position.y);
      expect(placed("P13").position.x).toBeLessThan(placed("X7").position.x);
      expect(placed("P12").position.x).toBeGreaterThan(placed("X8").position.x);
      horizontal("C10");
      expect(placed("C10").position.y).toBe(placed("X7").position.y - 120);
    }
    if (fixture.id === "common-source")
      expect(pin("RD", "2").x).toBe(pin("XM1", "D").x);
    const again = planAutoLayout(after, resolver);
    expect(again.diagnostics).toEqual([]);
    expect(
      again.edits.filter((e) =>
        ["move_instance", "rotate_instance", "mirror_instance"].includes(
          e.kind,
        ),
      ),
    ).toEqual([]);
  },
);

// Commit the planner's first phases independently to isolate route removal
// and annotation re-anchoring from instance transforms.
it.each(cases)(
  "$id: R2 re-anchoring and Route removal preserve terminal membership",
  (fixture) => {
    const project = parseProject(readFileSync(fixture.file, "utf8"));
    const document = project.documents.find(
      (d) => d.id === (fixture.documentId ?? project.topDocumentId),
    )!;
    const resolver = createProjectSymbolResolver(project, builtInSymbols);
    const before = projectElectricalGraph(project);
    const plan = planAutoLayout(document, resolver);
    expect(plan.diagnostics).toEqual([]);
    const edits = plan.edits.slice(
      0,
      document.annotations.filter((a) => a.anchor.kind === "route").length +
        document.routes.length,
    );
    expect(edits.map((e) => e.kind)).toEqual([
      ...document.annotations
        .filter((a) => a.anchor.kind === "route")
        .map(() => "upsert_schematic_annotation"),
      ...document.routes.map(() => "remove_route_geometry"),
    ]);
    const result = executeTransaction(
      document,
      {
        transactionId: `remove-${fixture.id}`,
        documentId: document.id,
        expectedRevision: document.revision,
        actor: { kind: "agent", id: "auto-layout-test" },
        edits,
      },
      { symbolResolver: resolver },
    );
    expect(result.applied, JSON.stringify(result.diagnostics)).toBe(true);
    if (!result.ok) return;
    expect(result.document.routes).toEqual([]);
    expect(result.document.drafting).toEqual(document.drafting);
    expect(result.document.annotations).toEqual(
      expectedReanchoredAnnotations(document),
    );
    expect(result.document.layoutGroups).toEqual(document.layoutGroups);
    if (before.status === "ready") {
      const after = projectElectricalGraph({
        ...project,
        documents: project.documents.map((d) =>
          d.id === document.id ? result.document : d,
        ),
      });
      expect(after.status).toBe("ready");
      if (after.status === "ready")
        expect(compareElectricalGraphs(before.graph, after.graph)).toBe(
          "equal",
        );
    } else {
      const terminals = (d: typeof document) =>
        [...deriveElectricalTopologyProjection(d, resolver).endpointToBaseNet]
          .filter(([key]) => key.startsWith("terminal:"))
          .sort();
      expect(terminals(result.document)).toEqual(terminals(document));
    }
  },
);
