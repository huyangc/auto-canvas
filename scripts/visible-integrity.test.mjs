import assert from "node:assert/strict";
import { test } from "vitest";

import {
  createEmptyProject,
  createRoutePath,
} from "../packages/model/dist/index.js";
import {
  builtInSymbols,
  InMemorySymbolResolver,
} from "../packages/symbols/dist/index.js";
import {
  compareVisibleIntegrity,
  visibleIntegrity,
} from "./visible-integrity.mjs";

const resolver = new InMemorySymbolResolver(builtInSymbols);

const resistor = (id, x, y) => ({
  id,
  reference: id,
  symbolId: "resistor",
  placement: { position: { x, y }, rotation: 0, mirror: "none" },
});

const wire = (id, netId, start, end) =>
  createRoutePath({ id, netId, start, end, bends: [], modes: ["manual"] });

const pin = (instanceId, pinName) => ({
  kind: "terminal",
  instanceId,
  pinName,
});

const label = (id, netId, position) => ({
  id,
  kind: "net-label",
  binding: { kind: "net-name", netId },
  netId,
  anchor: { kind: "free", position },
  alignment: "start",
  rotation: 0,
  locked: false,
});

const nameClaim = (netId, annotationId, name) => ({
  id: `claim-${annotationId}`,
  kind: "name-claim",
  netId,
  name,
  owner: { kind: "net-label", annotationId },
  scope: "local",
});

/**
 * Two resistors joined top to top (y = -20) and bottom to bottom (y = 20) by
 * straight wires from x = 0 to 100; VOUT's label stands just above the top
 * wire.
 */
function clean() {
  const project = createEmptyProject("integrity", "Integrity", "doc");
  const document = project.documents[0];
  document.instances.push(resistor("R1", 0, 0), resistor("R2", 100, 0));
  document.nets.push(
    { id: "top", terminals: [pin("R1", "1"), pin("R2", "1")] },
    { id: "bottom", terminals: [pin("R1", "2"), pin("R2", "2")] },
  );
  document.routes.push(
    wire("top-wire", "top", pin("R1", "1"), pin("R2", "1")),
    wire("bottom-wire", "bottom", pin("R1", "2"), pin("R2", "2")),
  );
  document.annotations.push(label("vout", "top", { x: 40, y: -23 }));
  document.connectivityEvidence.push(nameClaim("top", "vout", "VOUT"));
  return { project, document };
}

const counts = (integrity) => ({
  danglingWires: integrity.erc.danglingWires.length,
  unconnectedPins: integrity.erc.unconnectedPins.length,
  touchingNotConnected: integrity.erc.touchingNotConnected.length,
  labelOwnership: integrity.labelOwnership.length,
});

const zero = {
  danglingWires: 0,
  unconnectedPins: 0,
  touchingNotConnected: 0,
  labelOwnership: 0,
};

void test("finds nothing in a clean drawing", () => {
  const { project, document } = clean();
  const integrity = visibleIntegrity(document, resolver, project);
  assert.deepEqual(counts(integrity), zero);
  // Without the Project it reads the Document alone, alike.
  assert.deepEqual(counts(visibleIntegrity(document, resolver)), zero);
  assert.deepEqual(compareVisibleIntegrity(integrity, integrity), {
    introduced: {
      danglingWires: [],
      unconnectedPins: [],
      touchingNotConnected: [],
      labelOwnership: [],
    },
    sourceDefects: [],
  });
});

void test("lists a source pin drawn on another Net's wire as a source defect, not an introduced one", () => {
  const source = clean();
  // R3's lower pin lands on the top wire, but R3 is on no Net.
  source.document.instances.push(resistor("R3", 50, -40));
  const before = visibleIntegrity(source.document, resolver, source.project);
  assert.deepEqual(
    before.erc.touchingNotConnected.map((item) => [
      item.instanceId,
      item.pinName,
      item.netId,
    ]),
    [["R3", "2", "top"]],
  );
  // The layout keeps the netlist: R3 is drawn apart, both pins open.
  const result = clean();
  result.document.instances.push(resistor("R3", 50, -80));
  const after = visibleIntegrity(result.document, resolver, result.project);
  assert.equal(after.erc.touchingNotConnected.length, 0);
  assert.deepEqual(
    after.erc.unconnectedPins.map((item) => item.instanceId).sort(),
    ["R3", "R3"],
  );
  const { introduced, sourceDefects } = compareVisibleIntegrity(before, after);
  assert.deepEqual(introduced.unconnectedPins, []);
  assert.deepEqual(
    sourceDefects.map((item) => `${item.instanceId}.${item.pinName}`),
    ["R3.2"],
  );
});

void test("reports an open 20-unit wire the source does not have as introduced", () => {
  const source = clean();
  const result = clean();
  result.document.junctions.push(
    { id: "J1", netId: "bottom", position: { x: 200, y: 20 } },
    { id: "J2", netId: "bottom", position: { x: 220, y: 20 } },
  );
  result.document.routes.push(
    wire(
      "stub",
      "bottom",
      { kind: "junction", junctionId: "J1" },
      { kind: "junction", junctionId: "J2" },
    ),
  );
  const { introduced } = compareVisibleIntegrity(
    visibleIntegrity(source.document, resolver, source.project),
    visibleIntegrity(result.document, resolver, result.project),
  );
  assert.deepEqual(introduced.danglingWires, [
    { routeId: "stub", junctionId: "J1", netId: "bottom" },
    { routeId: "stub", junctionId: "J2", netId: "bottom" },
  ]);
  assert.deepEqual(introduced.unconnectedPins, []);
});

/** `clean()` plus a 20-unit open stub on the bottom Net, with the given Route id. */
function withStub(routeId, junctionPrefix) {
  const drawing = clean();
  drawing.document.junctions.push(
    { id: `${junctionPrefix}1`, netId: "bottom", position: { x: 200, y: 20 } },
    { id: `${junctionPrefix}2`, netId: "bottom", position: { x: 220, y: 20 } },
  );
  drawing.document.routes.push(
    wire(
      routeId,
      "bottom",
      { kind: "junction", junctionId: `${junctionPrefix}1` },
      { kind: "junction", junctionId: `${junctionPrefix}2` },
    ),
  );
  return drawing;
}

const compareDrawings = (source, result) =>
  compareVisibleIntegrity(
    visibleIntegrity(source.document, resolver, source.project),
    visibleIntegrity(result.document, resolver, result.project),
  );

void test("does not report an open end of a carried Route on a Net the source had one on", () => {
  const source = withStub("stub", "J");
  const result = withStub("auto-layout-carried-route-1", "K");
  assert.equal(
    visibleIntegrity(result.document, resolver, result.project).erc
      .danglingWires.length,
    2,
  );
  assert.deepEqual(
    compareDrawings(source, result).introduced.danglingWires,
    [],
  );
});

void test("reports a new open end on a Net where the source also had one", () => {
  const source = withStub("stub", "J");
  const result = withStub("fresh-stub", "K");
  assert.deepEqual(
    compareDrawings(source, result).introduced.danglingWires.map(
      (item) => item.routeId,
    ),
    ["fresh-stub", "fresh-stub"],
  );
});

void test("reports an open end of a carried Route on a Net the source had none on", () => {
  const result = withStub("auto-layout-carried-route-1", "K");
  assert.equal(
    compareDrawings(clean(), result).introduced.danglingWires.length,
    2,
  );
});

void test("reports a pin the result draws on another Net's wire as introduced", () => {
  const result = clean();
  result.document.instances.push(resistor("R3", 50, -40));
  const { introduced, sourceDefects } = compareDrawings(clean(), result);
  assert.deepEqual(
    introduced.touchingNotConnected.map(
      (item) => `${item.instanceId}.${item.pinName}`,
    ),
    ["R3.2"],
  );
  assert.deepEqual(sourceDefects, []);
});

const findings = (erc) => ({
  erc: {
    danglingWires: [],
    unconnectedPins: [],
    touchingNotConnected: [],
    ...erc,
  },
  labelOwnership: [],
});

void test("keeps a pin pair the source already draws touching out of introduced", () => {
  const pair = {
    instanceId: "R1",
    pinName: "2",
    otherInstanceId: "R2",
    otherPinName: "1",
  };
  const swapped = {
    instanceId: "R2",
    pinName: "1",
    otherInstanceId: "R1",
    otherPinName: "2",
  };
  const onWire = { instanceId: "R1", pinName: "2", netId: "top" };
  const source = findings({ touchingNotConnected: [pair, onWire] });
  const result = findings({ touchingNotConnected: [swapped, onWire] });
  const compared = compareVisibleIntegrity(source, result);
  // Fixed instances keep their pin pair; a pin on a wire is always re-routed.
  assert.deepEqual(compared.introduced.touchingNotConnected, [onWire]);
  assert.deepEqual(compared.sourceDefects, [pair, onWire]);
  assert.deepEqual(
    compareVisibleIntegrity(findings({}), result).introduced
      .touchingNotConnected,
    [swapped, onWire],
  );
});

void test("excuses carried open ends only up to the source's count on that Net", () => {
  const end = (routeId, junctionId) => ({ routeId, junctionId, netId: "n" });
  const source = findings({ danglingWires: [end("stub", "J1")] });
  const result = findings({
    danglingWires: [
      end("auto-layout-carried-route-1", "K1"),
      end("auto-layout-carried-route-1", "K2"),
    ],
  });
  assert.deepEqual(
    compareVisibleIntegrity(source, result).introduced.danglingWires,
    [end("auto-layout-carried-route-1", "K2")],
  );
});

void test("reports a pin the result leaves open as introduced", () => {
  const source = clean();
  const result = clean();
  result.document.routes = result.document.routes.filter(
    (route) => route.id !== "bottom-wire",
  );
  result.document.nets[1].terminals = [pin("R1", "2")];
  const { introduced } = compareVisibleIntegrity(
    visibleIntegrity(source.document, resolver, source.project),
    visibleIntegrity(result.document, resolver, result.project),
  );
  assert.ok(
    introduced.unconnectedPins.some(
      (item) => item.instanceId === "R2" && item.pinName === "2",
    ),
  );
});

void test("flags a label seated over a foreign wire", () => {
  const source = clean();
  const result = clean();
  // VOUT now stands just above the bottom wire, 40 units from its own.
  result.document.annotations[0].anchor.position = { x: 40, y: 17 };
  const before = visibleIntegrity(source.document, resolver, source.project);
  const after = visibleIntegrity(result.document, resolver, result.project);
  assert.deepEqual(before.labelOwnership, []);
  assert.equal(after.labelOwnership.length, 1);
  assert.equal(after.labelOwnership[0].annotationId, "vout");
  assert.equal(after.labelOwnership[0].name, "VOUT");
  assert.equal(after.labelOwnership[0].reason, "foreign-closer");
  assert.equal(after.labelOwnership[0].foreignNetId, "bottom");
  assert.ok(after.labelOwnership[0].ownDistance > 10);
  assert.deepEqual(
    compareVisibleIntegrity(before, after).introduced.labelOwnership.map(
      (flag) => flag.annotationId,
    ),
    ["vout"],
  );
});

void test("flags a label no wire or pin of its Net comes within one grid of", () => {
  const { project, document } = clean();
  document.annotations[0].anchor.position = { x: 40, y: -60 };
  const [flag] = visibleIntegrity(document, resolver, project).labelOwnership;
  assert.equal(flag.reason, "own-far");
  assert.ok(flag.ownDistance > 10);
});

void test("calls a label apart from every wire own-far even when another Net is nearer", () => {
  const { project, document } = clean();
  // Far below both wires: the bottom wire is nearer, but not under it.
  document.annotations[0].anchor.position = { x: 40, y: 80 };
  const [flag] = visibleIntegrity(document, resolver, project).labelOwnership;
  assert.equal(flag.reason, "own-far");
  assert.equal(flag.foreignNetId, "bottom");
  assert.ok(
    flag.foreignDistance > 10 && flag.foreignDistance < flag.ownDistance,
  );
});

void test("does not flag a label seated on its own wire", () => {
  const { project, document } = clean();
  // Struck through by its own wire: distance 0, no other Net nearer.
  document.annotations[0].anchor.position = { x: 40, y: -15 };
  assert.deepEqual(
    visibleIntegrity(document, resolver, project).labelOwnership,
    [],
  );
});

void test("counts a Net joined by a matching label name as the label's own", () => {
  const { project, document } = clean();
  // A third resistor's Net is joined to the top Net by a second VOUT label,
  // and the first label now stands over that Net's wire alone.
  document.instances.push(resistor("R3", 300, 0), resistor("R4", 400, 0));
  document.nets.push({
    id: "far",
    terminals: [pin("R3", "1"), pin("R4", "1")],
  });
  document.routes.push(wire("far-wire", "far", pin("R3", "1"), pin("R4", "1")));
  document.annotations.push(label("vout-far", "far", { x: 340, y: -23 }));
  document.connectivityEvidence.push(nameClaim("far", "vout-far", "VOUT"));
  document.annotations[0].anchor.position = { x: 320, y: -23 };
  assert.deepEqual(
    visibleIntegrity(document, resolver, project).labelOwnership,
    [],
  );
});

/** clean() with VOUT turned into a power label: text naming the top rail. */
function powered() {
  const drawing = clean();
  drawing.document.annotations[0].kind = "power-label";
  drawing.document.connectivityEvidence[0] = {
    id: "claim-vout",
    kind: "name-claim",
    netId: "top",
    name: "VOUT",
    owner: { kind: "power-marker", objectId: "vout" },
    powerDomain: "vdd",
    scope: "local",
  };
  return drawing;
}

void test("flags a power label seated over a foreign wire", () => {
  const source = powered();
  const result = powered();
  result.document.annotations[0].anchor.position = { x: 40, y: 17 };
  const before = visibleIntegrity(source.document, resolver, source.project);
  const after = visibleIntegrity(result.document, resolver, result.project);
  assert.deepEqual(before.labelOwnership, []);
  assert.equal(after.labelOwnership.length, 1);
  assert.equal(after.labelOwnership[0].annotationId, "vout");
  assert.equal(after.labelOwnership[0].reason, "foreign-closer");
  assert.equal(after.labelOwnership[0].foreignNetId, "bottom");
  assert.deepEqual(
    compareVisibleIntegrity(before, after).introduced.labelOwnership.map(
      (flag) => flag.annotationId,
    ),
    ["vout"],
  );
});

void test("lets a power label stand up to two grids from its rail", () => {
  const { project, document } = powered();
  // About 15 units above the top wire: too far for a Net label.
  document.annotations[0].anchor.position = { x: 40, y: -36 };
  assert.deepEqual(
    visibleIntegrity(document, resolver, project).labelOwnership,
    [],
  );
  document.annotations[0].anchor.position = { x: 40, y: -60 };
  const [flag] = visibleIntegrity(document, resolver, project).labelOwnership;
  assert.equal(flag.reason, "own-far");
});
