import assert from "node:assert/strict";
import { test } from "vitest";

import {
  aspect,
  compareReports,
  failingCriteria,
  failureClass,
  formatComparison,
  longNarrow,
  longNarrowVsHuman,
  splitOf,
} from "./netlist-input-compare.mjs";

// File ids with a known split under sha256(id) % 3.
const candidates = Array.from({ length: 40 }, (_, i) => `case-${i}`);
const [devA, devB] = candidates.filter((id) => splitOf(id) === "dev");
const [valA] = candidates.filter((id) => splitOf(id) === "val");

const side = ({
  crossings = 0,
  bends = 0,
  wire = 0,
  width = 100,
  height = 100,
}) => ({
  crossings,
  bends,
  wireLength: wire,
  layoutWidth: width,
  layoutHeight: height,
  floatingPins: [],
  missingConnections: 0,
  unsafeProblems: [],
  netBreakdown: {
    wireLengthByNetKind: { rail: wire / 2, port: 0, signal: wire / 2 },
    crossingsByKindPair: { "rail-signal": crossings },
  },
  netKindDetail: {
    bendsByNetKind: { rail: bends, port: 0, signal: 0 },
    railCrossings: crossings,
    presentation: {
      ground: 0,
      supply: 0,
      ports: 0,
      netLabels: 0,
      powerLabels: 0,
    },
  },
  symmetry: {
    pairs: 1,
    mirrored: 1,
    level: 1,
    orientationMirrored: 1,
    axisDevices: 0,
    onAxis: 0,
  },
  symmetryStage: {
    pairs: 1,
    mirrored: 1,
    level: 1,
    orientationMirrored: 1,
    axisDevices: 0,
    onAxis: 0,
  },
  readabilityMetrics: {
    signalDirection: { violations: 1, opportunities: 2 },
    netlistSymmetry: { violations: 0, opportunities: 1 },
  },
});

const noIntegrity = {
  introduced: {
    danglingWires: [],
    unconnectedPins: [],
    touchingNotConnected: [],
    labelOwnership: [],
  },
};
const conversion = (source = {}, electricalGraph = "equal") => ({
  stage: "converted",
  electricalGraph,
  reexport: "identical",
  pinsNettedOnlyInImport: ["x1.VDD"],
  source: {
    ground: 2,
    supply: 0,
    labelJoinedNets: 0,
    pinContacts: 0,
    ...source,
  },
  import: {
    hiddenPinsExplicit: 1,
    groundClaim: false,
    supplyTerminals: 1,
    groundTerminals: 1,
  },
});
const completed = (id, human, result, extra = {}) => ({
  id,
  status: "completed",
  equivalent: true,
  human: side(human),
  result: side(result),
  diagnostics: [],
  integrity: noIntegrity,
  ...extra,
});

const drawingReport = {
  cases: [
    completed(
      devA,
      { crossings: 1, bends: 2, wire: 100 },
      { crossings: 2, bends: 3, wire: 120 },
    ),
    completed(
      devB,
      { bends: 1, wire: 50, width: 150, height: 100 },
      { bends: 1, wire: 60, width: 200, height: 100 },
    ),
    completed(
      valA,
      { crossings: 1, bends: 4, wire: 80 },
      { crossings: 1, bends: 4, wire: 90 },
    ),
    {
      id: "refused-drawing",
      status: "refused",
      human: side({}),
      result: null,
      diagnostics: [],
    },
    // Completed on drawing input; never converted, and refused on netlist input.
    completed("not-converted", {}, {}),
    completed("netlist-refused", {}, {}),
  ],
};
// Netlist cases in another order; one the drawing refused.
const netlistReport = {
  netlistInput: { folder: "netlist", reference: "drawing" },
  cases: [
    completed(
      valA,
      { crossings: 1, bends: 4, wire: 80 },
      { crossings: 3, bends: 2, wire: 90 },
      { conversion: conversion({}, "different") },
    ),
    completed(
      devB,
      { bends: 1, wire: 50 },
      { bends: 2, wire: 70, width: 300, height: 100 },
      { conversion: conversion({ ground: 1 }) },
    ),
    completed(
      devA,
      { crossings: 1, bends: 2, wire: 100 },
      { crossings: 1, bends: 3, wire: 150 },
      { conversion: conversion() },
    ),
    completed(
      "refused-drawing",
      {},
      { bends: 9 },
      { conversion: conversion() },
    ),
    {
      id: "netlist-refused",
      status: "refused",
      human: side({}),
      result: null,
      diagnostics: [],
      conversion: conversion(),
    },
  ],
};
const metas = [
  {
    id: devA,
    ...conversion(),
    electricalGraph: "equal",
    reexport: "identical",
    errorCodes: [],
  },
  {
    id: devB,
    ...conversion(),
    electricalGraph: "equal",
    reexport: "same-cards",
    errorCodes: [],
  },
  {
    id: valA,
    ...conversion(),
    electricalGraph: "different",
    reexport: "identical",
    errorCodes: [],
  },
  {
    id: "blocked",
    stage: "export-blocked",
    errorCodes: ["MISSING_MODEL_TARGET"],
  },
];

test("pairs cases by file id and totals each side per split", () => {
  const { splits } = compareReports(netlistReport, drawingReport, metas);
  const all = splits.all.paired;
  assert.equal(all.pairs, 3);
  assert.equal(all.netlistCompletedDrawingNot, 1);
  assert.deepEqual(all.drawingCompletedNetlistNot, {
    notConverted: 1,
    convertedNotCompleted: 1,
  });
  // The same totals restricted to an equal electrical graph: valA drops out.
  assert.equal(all.electricalGraphEqual.pairs, 2);
  assert.deepEqual(
    {
      ...all.electricalGraphEqual.table.crossings,
      netlistVsDrawing: undefined,
    },
    { human: 1, drawing: 2, netlist: 1, netlistVsDrawing: undefined },
  );
  assert.equal(all.electricalGraphEqual.byNetKind.netlist.railCrossings, 1);
  assert.equal(all.conversion["electrical graph different"].cases, 1);
  assert.equal(all.conversion["re-export identical"].cases, 3);
  // Human from the drawing report, drawing input, netlist input.
  assert.deepEqual(
    { ...all.table.crossings, netlistVsDrawing: undefined },
    { human: 2, drawing: 3, netlist: 4, netlistVsDrawing: undefined },
  );
  assert.deepEqual(all.table.crossings.netlistVsDrawing, {
    better: 1,
    equal: 1,
    worse: 1,
  });
  assert.equal(all.table.bends.netlist, 7);
  assert.deepEqual(all.table.bends.netlistVsDrawing, {
    better: 1,
    equal: 1,
    worse: 1,
  });
  assert.equal(all.table.wire.drawing, 270);
  assert.equal(all.byNetKind.netlist.railCrossings, 4);
  assert.equal(all.byNetKind.drawing.bends.rail, 8);
  assert.equal(all.byNetKind.netlist.wire.rail, 155);
  assert.equal(all.readability.netlist.signalDirection.violations, 3);
  assert.equal(splits.dev.paired.pairs, 2);
  assert.equal(splits.val.paired.pairs, 1);
  assert.equal(splits.val.paired.table.bends.netlist, 2);
  assert.equal(splits.dev.paired.table.wire.netlist, 220);
  // Coverage counts every meta in the split, converted or not.
  assert.equal(splits.all.coverage.cases, 4);
  assert.deepEqual(splits.all.coverage.exportBlockedCodes, {
    MISSING_MODEL_TARGET: 1,
  });
  assert.deepEqual(splits.all.coverage.converted.electricalGraph, {
    equal: 2,
    different: 1,
  });
  // One pair had a single ground marker in its drawing.
  assert.equal(
    all.conversion["drawing has more than one ground marker"].cases,
    2,
  );
  assert.match(
    formatComparison(compareReports(netlistReport, drawingReport, metas)),
    /== val/u,
  );
});

test("aspect and long-narrow compare with the human drawing", () => {
  const box = (width, height) => ({ layoutWidth: width, layoutHeight: height });
  assert.equal(aspect(box(300, 100)), 3);
  assert.equal(aspect(box(100, 300)), 3);
  assert.equal(longNarrow(box(199, 100)), false);
  assert.equal(longNarrow(box(200, 100)), true);
  // At least 2 and at least 1.5 times the human aspect.
  assert.equal(longNarrowVsHuman(box(300, 100), box(100, 100)), true);
  assert.equal(longNarrowVsHuman(box(200, 100), box(150, 100)), false);
  const { splits } = compareReports(netlistReport, drawingReport, metas);
  assert.deepEqual(splits.dev.paired.table.longNarrow, {
    human: 0,
    drawing: 1,
    netlist: 1,
  });
  assert.deepEqual(splits.dev.paired.table.longNarrowVsHuman, {
    human: 0,
    drawing: 0,
    netlist: 1,
  });
});

test("a floating pin without an R14 warning fails, classified by the conversion", () => {
  const floating = completed(devA, {}, {}, { conversion: conversion() });
  floating.result.floatingPins = [{ instanceId: "X1", pinName: "VDD" }];
  const [failure] = failingCriteria(floating);
  assert.equal(failure.criterion, "floating-pin-without-R14");
  const instances = [{ id: "X1", reference: "X1", symbolId: "opamp" }];
  assert.equal(
    failureClass(failure, floating.conversion, instances),
    "hidden supply or control pin made explicit",
  );
  assert.equal(
    failureClass(failure, { pinsNettedOnlyInImport: [] }, instances),
    "other",
  );
  floating.diagnostics = [
    {
      rule: "R14",
      severity: "warning",
      code: "AUTO_LAYOUT_NET_UNROUTED",
      message: "pin is not visible: X1.VDD; pins: X1.VDD",
    },
  ];
  assert.deepEqual(failingCriteria(floating), []);
  assert.deepEqual(
    failingCriteria({ ...floating, equivalent: false })[0].criterion,
    "not-equivalent",
  );
});

test("crossings involving a rail come from netBreakdown without netKindDetail", () => {
  const old = structuredClone(drawingReport);
  for (const m of old.cases) {
    if (m.human) delete m.human.netKindDetail;
    if (m.result) delete m.result.netKindDetail;
  }
  const { byNetKind } = compareReports(netlistReport, old, metas).splits.all
    .paired;
  assert.equal(byNetKind.drawing.railCrossings, 3);
  assert.equal(byNetKind.human.railCrossings, 2);
  assert.equal(byNetKind.drawing.bends.rail, null);
});

test("a case unequal to the baseline fails, completed or refused", () => {
  const changed = { ...completed(devA, {}, {}), baselineEqual: false };
  assert.deepEqual(
    failingCriteria(changed).map((f) => f.criterion),
    ["baseline-differs"],
  );
  assert.deepEqual(
    failingCriteria({ id: devA, status: "refused", baselineEqual: false }).map(
      (f) => f.criterion,
    ),
    ["baseline-differs"],
  );
});
