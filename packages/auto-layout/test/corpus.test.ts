import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import {
  deriveElectricalTopologyProjection,
  resolveRouteGeometry,
  visibleInstanceBounds,
} from "@icm/derived";
import { DocumentHistory, executeTransaction } from "@icm/edit-engine";
import { compareElectricalGraphs, projectElectricalGraph } from "@icm/netlist";
import { parseProject } from "@icm/project-protocol";
import { builtInSymbols, createProjectSymbolResolver } from "@icm/symbols";
import { planAutoLayout } from "../src/index.js";
import { enclosingBox, pinPoints, pinExit } from "../src/geometry.js";
import { auditRouting, floatingPins } from "../src/routing-audit.js";
import { freedAnnotations } from "../src/labels.js";
import { terminalPartition } from "../src/transaction.js";
import { devicePins, isMarker } from "../src/placement-connectivity.js";
import { classifyNets } from "../src/net-roles.js";
import cases from "./corpus-cases.json";
const targets: Record<string, [number, number]> = {
  "five-t-ota": [0, 1],
  "fig-17-19b": [0, 2],
  "two-inverters": [1, 2],
  "differential-stage": [0, 0],
  "common-source": [0, 2],
  "rc-lowpass": [0, 0],
  "rc-highpass": [0, 0],
  rlc: [0, 0],
  "two-stage-symbolic": [0, 3],
};

function expectedReanchoredAnnotations(
  document: Parameters<typeof planAutoLayout>[0],
) {
  const freed = new Set(freedAnnotations(document).map((a) => a.id));
  return document.annotations.map((annotation) =>
    freed.has(annotation.id) && annotation.anchor.kind !== "free"
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
    expect(plan.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(
      plan.diagnostics.filter((d) => d.code === "AUTO_LAYOUT_NET_UNROUTED"),
    ).toEqual([]);
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
    const pins = pinPoints(after, resolver);
    const contacting = new Set<string>();
    const pairId = (a: string, b: string) => JSON.stringify([a, b].sort());
    for (const [index, a] of pins.entries()) {
      const peers = pins
        .slice(index + 1)
        .filter((b) => a.point.x === b.point.x && a.point.y === b.point.y);
      expect(peers.length).toBeLessThanOrEqual(1);
      for (const b of peers) {
        const netsOf = (p: typeof a) =>
          document.nets
            .filter((n) =>
              n.terminals.some(
                (t) =>
                  !t.memberId &&
                  t.instanceId === p.instanceId &&
                  t.pinName === p.pinName,
              ),
            )
            .map((n) => n.id);
        const originalNets = netsOf(a);
        expect(originalNets).toHaveLength(1);
        expect(netsOf(b)).toEqual(originalNets);
        const exit = (p: typeof a) => {
          const i = after.instances.find((i) => i.id === p.instanceId)!;
          const pin = resolver
            .resolve(i.symbolId, i.symbolVariantId)!
            .definition.pins.find((x) => x.name === p.pinName)!;
          expect(pin.presentation.visibility).not.toBe("implicit");
          return pinExit(pin, i.placement!);
        };
        const ea = exit(a),
          eb = exit(b);
        expect(Math.abs(ea.x + eb.x) + Math.abs(ea.y + eb.y)).toBe(0);
        contacting.add(pairId(a.instanceId, b.instanceId));
      }
    }
    const boxes = visibleInstanceBounds(after, resolver);
    for (const [index, a] of boxes.entries())
      for (const b of boxes.slice(index + 1)) {
        const overlap = (axis: "x" | "y", size: "width" | "height") =>
          Math.min(
            a.bounds[axis] + a.bounds[size],
            b.bounds[axis] + b.bounds[size],
          ) - Math.max(a.bounds[axis], b.bounds[axis]);
        // The one-unit hit padding can meet on both sides of a licensed landing.
        expect(
          Math.min(overlap("x", "width"), overlap("y", "height")),
          pairId(a.id, b.id),
        ).toBeLessThanOrEqual(
          contacting.has(pairId(a.id, b.id)) ? 2 + 1e-6 : 0,
        );
      }
    const oldBox = enclosingBox(document, resolver);
    const resultBox = enclosingBox(after, resolver);
    expect(Math.abs(resultBox.x - oldBox.x)).toBeLessThanOrEqual(
      after.presentation.grid / 2,
    );
    if (!document.drafting?.objects.length)
      expect(Math.abs(resultBox.y - oldBox.y)).toBeLessThanOrEqual(
        after.presentation.grid / 2,
      );
    else
      expect(resultBox.y).toBeGreaterThanOrEqual(
        oldBox.y - after.presentation.grid / 2,
      );
    const audit = auditRouting(after, resolver);
    expect(audit.problems).toEqual([]);
    expect(floatingPins(after, resolver)).toEqual([]);
    expect(audit.crossings).toBeLessThanOrEqual(targets[fixture.id]![0]);
    expect(audit.bends).toBeLessThanOrEqual(targets[fixture.id]![1]);
    expect(terminalPartition(after, resolver)).toBe(
      terminalPartition(document, resolver),
    );
    for (const route of after.routes) {
      expect(document.routes.some((r) => r.id === route.id)).toBe(false);
      const end = route.legs.at(-1)!.to;
      for (const endpoint of [
        route.start,
        end.kind === "endpoint" ? end.endpoint : null,
      ])
        if (endpoint?.kind === "terminal")
          expect(endpoint.pinName).not.toBe("B");
    }
    expect(after.drafting).toEqual(document.drafting);
    expect(after.annotations.map((a) => a.id).sort()).toEqual(
      document.annotations.map((a) => a.id).sort(),
    );
    for (const annotation of expectedReanchoredAnnotations(document)) {
      const actual = after.annotations.find((a) => a.id === annotation.id)!;
      expect(actual.content).toEqual(annotation.content);
      expect(actual.binding).toEqual(annotation.binding);
      if (
        freedAnnotations(document).some((a) => a.id === actual.id) &&
        ["net-label", "power-label"].includes(actual.kind)
      ) {
        const legs = after.routes
          .filter((r) => r.netId === actual.netId)
          .flatMap(
            (r) =>
              resolveRouteGeometry(after, resolver, r)?.segments.filter(
                (s) => s.from.y === s.to.y && s.from.x !== s.to.x,
              ) ?? [],
          );
        if (legs.length) {
          expect(actual.anchor.kind).toBe("route");
          if (actual.anchor.kind === "route") {
            const anchor = actual.anchor;
            expect(anchor.t).toBe(0.5);
            expect(anchor.normalOffset).not.toBe(0);
            const originalAnchor = document.annotations.find(
              (a) => a.id === actual.id,
            )!.anchor;
            expect(anchor.normalOffset).toBe(
              originalAnchor.kind === "route"
                ? originalAnchor.normalOffset
                : -10,
            );
            expect(anchor.direction).toBe(
              originalAnchor.kind === "route"
                ? originalAnchor.direction
                : "forward",
            );
            expect(anchor.orientation).toBe(
              originalAnchor.kind === "route"
                ? originalAnchor.orientation
                : "horizontal",
            );
            const leg = legs.find(
              (s) =>
                s.address.routeId === anchor.routeId &&
                s.address.legId === anchor.legId,
            )!;
            expect(Math.abs(leg.to.x - leg.from.x)).toBe(
              Math.max(...legs.map((s) => Math.abs(s.to.x - s.from.x))),
            );
          }
        } else {
          expect(actual.anchor.kind).toBe("free");
          const original = document.annotations.find(
            (a) => a.id === actual.id,
          )!;
          const fallback =
            original.anchor.kind === "free"
              ? original.anchor.position
              : original.anchor.fallbackPosition;
          const net = document.nets.find((n) => n.id === original.netId);
          const candidates = pinPoints(after, resolver).filter((p) =>
            net?.terminals.some(
              (t) =>
                t.instanceId === p.instanceId &&
                t.pinName === p.pinName &&
                t.pinName !== "B",
            ),
          );
          if (candidates.length && actual.anchor.kind === "free")
            expect(
              Math.hypot(
                actual.anchor.position.x - fallback.x,
                actual.anchor.position.y - fallback.y,
              ),
            ).toBe(
              Math.min(
                ...candidates.map((p) =>
                  Math.hypot(p.point.x - fallback.x, p.point.y - fallback.y),
                ),
              ),
            );
        }
      }
    }
    for (const group of document.layoutGroups)
      expect(after.layoutGroups.find((g) => g.id === group.id)).toEqual(group);
    const placed = (id: string) =>
      after.instances.find((i) => i.id === id)!.placement!;
    for (const group of plan.groups) {
      const [left, right] = group.members.map(placed);
      expect(left!.position.y).toBe(right!.position.y);
      const stacked = plan.groups.find(
        (other) =>
          other !== group &&
          other.members.some((id) =>
            document.nets.some(
              (n) =>
                n.terminals.some(
                  (t) => t.instanceId === id && ["D", "S"].includes(t.pinName),
                ) &&
                n.terminals.some(
                  (t) =>
                    group.members.includes(t.instanceId) &&
                    ["D", "S"].includes(t.pinName),
                ),
            ),
          ),
      );
      const pitch = right!.position.x - left!.position.x;
      if (!stacked) expect(pitch).toBe(100);
      else {
        const [otherLeft, otherRight] = stacked.members.map(placed);
        expect(
          Math.min(pitch, otherRight!.position.x - otherLeft!.position.x),
        ).toBe(100);
        const points = pinPoints(after, resolver);
        for (const net of document.nets) {
          const own = net.terminals.filter(
            (t) =>
              group.members.includes(t.instanceId) &&
              ["D", "S"].includes(t.pinName),
          );
          const other = net.terminals.filter(
            (t) =>
              stacked.members.includes(t.instanceId) &&
              ["D", "S"].includes(t.pinName),
          );
          for (const a of own)
            for (const b of other) {
              const point = (t: typeof a) =>
                points.find(
                  (p) =>
                    p.instanceId === t.instanceId && p.pinName === t.pinName,
                )!.point;
              expect(point(a).x).toBe(point(b).x);
            }
        }
      }
      expect(left!.mirror).toBe(
        group.kind === "differential-pair" ? "none" : "horizontal",
      );
      expect(right!.mirror).toBe(
        group.kind === "differential-pair" ? "horizontal" : "none",
      );
      if (group.tailInstanceId) {
        const tailPin = pinPoints(after, resolver).find(
          (p) =>
            p.instanceId === group.tailInstanceId &&
            ["D", "+"].includes(p.pinName),
        )!;
        expect(tailPin.point.x).toBe(
          (left!.position.x + right!.position.x) / 2,
        );
        expect(placed(group.tailInstanceId).position.y).toBe(
          left!.position.y + 120,
        );
      }
    }
    if (fixture.id === "five-t-ota") {
      const topology = deriveElectricalTopologyProjection(after, resolver);
      for (const id of ["M1", "M2"])
        expect(topology.endpointToBaseNet.get(`terminal:${id}:B`)).toBe(
          topology.endpointToBaseNet.get(`terminal:${id}:S`),
        );
      for (const evidence of document.connectivityEvidence) {
        const owner =
          evidence.kind === "name-claim" &&
          evidence.owner.kind === "power-marker"
            ? evidence.owner.objectId
            : undefined;
        if (
          evidence.kind !== "name-claim" ||
          evidence.owner.kind !== "power-marker" ||
          ![...document.routes, ...document.junctions].some(
            (o) => o.id === owner,
          )
        )
          continue;
        const transferred = after.connectivityEvidence.find(
          (e) => e.id === evidence.id,
        );
        expect(transferred).toMatchObject({
          ...evidence,
          owner: { kind: "power-marker", objectId: expect.any(String) },
        });
        if (
          transferred?.kind === "name-claim" &&
          transferred.owner.kind === "power-marker"
        ) {
          const objectId = transferred.owner.objectId;
          const label = document.annotations.find(
            (a) =>
              a.binding?.kind === "net-name" &&
              a.binding.netId === evidence.netId &&
              a.anchor.kind === "object" &&
              a.anchor.objectId === owner,
          );
          if (label) {
            expect(objectId).toBe(label.id);
            expect(
              after.annotations.find((a) => a.id === objectId)?.netId,
            ).toBe(transferred.netId);
          } else {
            expect(
              after.routes.some(
                (r) => r.id === objectId && r.netId === transferred.netId,
              ),
            ).toBe(true);
          }
        }
      }
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
    const roles = classifyNets(document, resolver);
    const ports = after.instances.filter((i) =>
      ["port", "port-filled"].includes(i.symbolId),
    );
    const deviceBox = enclosingBox(
      {
        ...after,
        instances: after.instances.filter(
          (i) =>
            !["port", "port-filled", "ground", "vdd-port"].includes(i.symbolId),
        ),
      },
      resolver,
    );
    const snap = (n: number) =>
      Math.round(n / after.presentation.grid) * after.presentation.grid;
    const localPorts = new Set<string>();
    const devicePinsAfter = pinPoints(
      { ...after, instances: after.instances.filter((i) => !isMarker(i)) },
      resolver,
    );
    for (const port of ports) {
      const net = roles.pinNet(port.id, "P");
      const hosts = devicePinsAfter.filter(
        (p) =>
          net !== undefined && roles.pinNet(p.instanceId, p.pinName) === net,
      );
      if (hosts.length !== 1 || roles.rails.has(net ?? "")) continue;
      const host = hosts[0]!,
        instance = after.instances.find((i) => i.id === host.instanceId)!;
      const exit = pinExit(
        devicePins(instance, resolver).find((p) => p.name === host.pinName)!,
        instance.placement!,
      );
      if (
        port.placement!.position.x === snap(host.point.x + exit.x * 80) &&
        port.placement!.position.y === snap(host.point.y + exit.y * 80)
      )
        localPorts.add(port.id);
    }
    for (const port of ports.filter((p) => !localPorts.has(p.id))) {
      const p = port.placement!;
      if (p.rotation === 0)
        expect(p.position.x).toBe(
          snap(
            p.mirror === "horizontal"
              ? deviceBox.x + deviceBox.width + 80
              : deviceBox.x - 80,
          ),
        );
      else
        expect(p.rotation).toBe(
          roles.byNet.get(roles.pinNet(port.id, "P") ?? "") === "supply"
            ? 90
            : 270,
        );
    }
    for (const side of ["left", "right", "top", "bottom"]) {
      const members = ports.filter((i) => {
        if (localPorts.has(i.id)) return false;
        const p = i.placement!;
        return side === "top"
          ? p.rotation === 90
          : side === "bottom"
            ? p.rotation === 270
            : p.rotation === 0 &&
              (side === "right"
                ? p.mirror === "horizontal"
                : p.mirror === "none");
      });
      const coordinates = members
        .map((i) =>
          ["left", "right"].includes(side)
            ? i.placement!.position.y
            : i.placement!.position.x,
        )
        .sort((a, b) => a - b);
      for (let n = 1; n < coordinates.length; n++)
        expect(coordinates[n]! - coordinates[n - 1]!).toBeGreaterThanOrEqual(
          40,
        );
    }
    const allPins = pinPoints(after, resolver);
    const pin = (id: string, name: string) =>
      allPins.find((p) => p.instanceId === id && p.pinName === name)!.point;
    if (fixture.id === "five-t-ota") {
      expect(pin("M2", "D").x).toBe(pin("M3", "D").x);
      expect(pin("M1", "D").x).toBe(pin("M4", "D").x);
      const drainNet = roles.pinNet("M4", "D");
      const drainRoutes = {
        ...after,
        routes: after.routes.filter((r) => r.netId === drainNet),
      };
      expect(auditRouting(drainRoutes, resolver).bends).toBe(0);
    }
    if (fixture.id === "fig-17-19b") {
      expect(pin("M1", "S").x).toBe(pin("M2", "D").x);
      for (const port of ports.filter(
        (i) => roles.byNet.get(roles.pinNet(i.id, "P") ?? "") === "input",
      )) {
        const gate = allPins.find(
          (p) =>
            p.pinName === "G" &&
            roles.pinNet(p.instanceId, p.pinName) ===
              roles.pinNet(port.id, "P"),
        )!;
        expect(pin(port.id, "P").y).toBe(gate.point.y);
      }
      const outputs = ports.filter(
        (i) => roles.byNet.get(roles.pinNet(i.id, "P") ?? "") === "output",
      );
      expect(outputs.map((i) => i.placement!.mirror).sort()).toEqual([
        "horizontal",
        "none",
      ]);
    }
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
      // The source drives a passive chain, so its Net is a wire, not a trunk.
      expect(pin("V1", "+").y).toBe(pin("R1", "1").y);
      const inNet = after.routes.filter(
        (r) => r.netId === roles.pinNet("V1", "+"),
      );
      for (const route of inNet)
        for (const segment of resolveRouteGeometry(after, resolver, route)
          ?.segments ?? []) {
          expect(segment.from.y).toBeGreaterThanOrEqual(pin("V1", "+").y);
          expect(segment.to.y).toBeGreaterThanOrEqual(pin("V1", "+").y);
        }
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
      expect(pin("X7", "IN+").y).toBeLessThan(pin("X7", "IN-").y);
      expect(placed("X7").position.x).toBeLessThan(placed("X8").position.x);
      expect(placed("X7").position.y).toBe(placed("X8").position.y);
      expect(placed("P12").position.x).toBeGreaterThan(placed("X8").position.x);
      expect(placed("P13").position.x).toBeLessThan(placed("X7").position.x);
      horizontal("C10");
      expect(placed("C10").position.y).toBe(placed("X7").position.y - 120);
    }
    if (fixture.id === "common-source")
      expect(pin("RD", "2").x).toBe(pin("XM1", "D").x);
    const again = planAutoLayout(after, resolver);
    expect(again.diagnostics).toEqual([]);
    const history = new DocumentHistory(document, { symbolResolver: resolver });
    const transaction = {
      transactionId: `history-${fixture.id}`,
      documentId: document.id,
      expectedRevision: document.revision,
      actor: { kind: "agent" as const, id: "test" },
      edits: plan.edits,
    };
    expect(history.transact(transaction).ok).toBe(true);
    expect(
      history.transact({
        ...transaction,
        expectedRevision: history.document.revision,
        edits: [{ kind: "undo" }],
      }).ok,
    ).toBe(true);
    expect(history.canUndo).toBe(false);
    expect(terminalPartition(history.document, resolver)).toBe(
      terminalPartition(document, resolver),
    );
    const twice = executeTransaction(
      after,
      { ...transaction, expectedRevision: after.revision, edits: again.edits },
      { symbolResolver: resolver },
    );
    expect(twice.ok).toBe(true);
    if (twice.ok)
      expect(twice.document.routes.length).toBe(after.routes.length);
    expect(
      again.edits.filter((e) =>
        ["move_instance", "rotate_instance", "mirror_instance"].includes(
          e.kind,
        ),
      ),
    ).toEqual([]);
  },
  30000,
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
    const removalStart = plan.edits.findIndex(
      (e) => e.kind === "remove_route_geometry" || e.kind === "remove_junction",
    );
    let cleanupLength =
      removalStart + document.routes.length + document.junctions.length;
    while (
      ["connect_endpoints", "upsert_schematic_annotation"].includes(
        plan.edits[cleanupLength]?.kind ?? "",
      )
    )
      cleanupLength++;
    const edits = plan.edits.slice(0, cleanupLength);
    expect(
      edits.slice(
        removalStart,
        removalStart + document.routes.length + document.junctions.length,
      ),
    ).toEqual([
      ...document.routes.map((r) => ({
        kind: "remove_route_geometry",
        routeId: r.id,
      })),
      ...document.junctions.map((j) => ({
        kind: "remove_junction",
        junctionId: j.id,
      })),
    ]);
    expect(
      edits
        .slice(0, removalStart)
        .every(
          (e) =>
            e.kind === "upsert_schematic_annotation" ||
            e.kind === "upsert_connectivity_evidence",
        ),
    ).toBe(true);
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
    // A claim owned by removed geometry is handed to the new supply wire only
    // after routing, so until then its MOS bulk pins are out of the supply
    // Net. The complete transaction is compared in full by the test above.
    const owners = new Set(
      [...document.routes, ...document.junctions].map((o) => o.id),
    );
    const transfersClaim = document.connectivityEvidence.some(
      (e) =>
        e.kind === "name-claim" &&
        e.owner.kind === "power-marker" &&
        owners.has(e.owner.objectId),
    );
    const withoutBulk = (d: typeof document) =>
      [...deriveElectricalTopologyProjection(d, resolver).endpointToBaseNet]
        .filter(([key]) => key.startsWith("terminal:") && !key.endsWith(":B"))
        .sort();
    if (transfersClaim)
      expect(withoutBulk(result.document)).toEqual(withoutBulk(document));
    else
      expect(terminalPartition(result.document, resolver)).toBe(
        terminalPartition(document, resolver),
      );
    expect(result.document.routes).toEqual([]);
    expect(result.document.junctions).toEqual([]);
    expect(result.document.drafting).toEqual(document.drafting);
    expect(result.document.annotations).toEqual(
      expectedReanchoredAnnotations(document),
    );
    expect(result.document.layoutGroups).toEqual(document.layoutGroups);
    if (transfersClaim) return;
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
  30000,
);
