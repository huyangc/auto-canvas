import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  serializeProject,
  parseProject,
} from "../../packages/project-protocol/dist/index.js";
import {
  builtInSymbols,
  createProjectSymbolResolver,
} from "../../packages/symbols/dist/index.js";
import {
  projectElectricalGraph,
  compareElectricalGraphs,
} from "../../packages/netlist/dist/index.js";
import { pinLayoutMetrics } from "../../packages/auto-layout/dist/pin-portfolio.js";
import {
  renderDocumentSvg,
  buildSvgScene,
} from "../../packages/render-svg/dist/index.js";
import { deriveElectricalTopologyProjection } from "../../packages/derived/dist/index.js";
import { executeTransaction } from "../../packages/edit-engine/dist/index.js";
import { planAutoLayout } from "../../packages/auto-layout/dist/index.js";
import { terminalPartition } from "../../packages/auto-layout/dist/transaction.js";
import {
  auditRouting,
  floatingPins,
  missingConnections,
} from "../../packages/auto-layout/dist/routing-audit.js";

export function electricalInput(source) {
  const ids = new Set(source.instances.map((i) => i.id));
  // Preserve electrical annotation owners (cell interfaces and power claims).
  const owners = new Set([
    ...(source.netlist?.terminals ?? []).map((t) => t.interfaceAnnotationId),
    ...source.connectivityEvidence
      .filter((e) => e.kind === "name-claim" && e.owner.kind === "net-label")
      .map((e) => e.owner.annotationId),
  ]);
  for (const e of source.connectivityEvidence)
    if (
      e.kind === "name-claim" &&
      e.owner.kind === "power-marker" &&
      source.annotations.some((a) => a.id === e.owner.objectId)
    )
      owners.add(e.owner.objectId);
  // Seed text seats solely from electrical owners. The actual planner arranges labels.
  const annotations = source.annotations.flatMap((a) => {
    const bound =
      a.anchor.kind === "object" && ids.has(a.anchor.objectId)
        ? a.anchor.objectId
        : null;
    if (!bound && !owners.has(a.id)) return [];
    const target =
      bound ??
      source.nets.find((n) => n.id === a.netId)?.terminals[0]?.instanceId;
    const p = { x: 20, y: a.kind === "instance-value" ? 20 : 0 };
    return [
      {
        ...a,
        alignment: "start",
        rotation: 0,
        anchor: target
          ? {
              kind: "object",
              objectId: target,
              localOffset: p,
              fallbackPosition: p,
            }
          : { kind: "free", position: { x: 0, y: 0 } },
      },
    ];
  });
  const evidence = source.connectivityEvidence.flatMap((e) => {
    if (
      e.kind !== "name-claim" ||
      e.owner.kind !== "power-marker" ||
      ids.has(e.owner.objectId) ||
      owners.has(e.owner.objectId)
    )
      return [e];
    return [
      {
        kind: "spice-source",
        id: "electrical-owner-" + e.id,
        netId: e.netId,
        sourceNetId: e.netId,
      },
      { ...e, owner: { kind: "global-declaration", sourceNetId: e.netId } },
    ];
  });
  return {
    ...source,
    instances: source.instances.map((i) => ({ ...i, placement: null })),
    routes: [],
    junctions: [],
    layoutGroups: [],
    constraints: [],
    drafting: undefined,
    annotations,
    connectivityEvidence: evidence,
  };
}
export function check(row, root, options, folder) {
  const bytes = fs.readFileSync(path.join(root, row.bucket, row.id + ".json"));
  assert.equal(createHash("sha256").update(bytes).digest("hex"), row.sha256);
  const project = parseProject(bytes.toString()),
    original = project.documents.find((d) => d.id === project.topDocumentId),
    r = createProjectSymbolResolver(project, builtInSymbols);
  const d = electricalInput(original);
  assert.equal(
    terminalPartition(d, r),
    terminalPartition(original, r),
    "electrical input",
  );
  const result = planAutoLayout(d, r, options),
    tx = executeTransaction(
      d,
      {
        transactionId: "benchmark",
        documentId: d.id,
        expectedRevision: d.revision,
        actor: { kind: "agent", id: "benchmark" },
        edits: result.edits,
      },
      { symbolResolver: r },
    );
  if (
    !tx.ok ||
    !tx.applied ||
    !result.edits.length ||
    result.diagnostics.some((m) => m.severity === "error")
  )
    throw Error(
      row.id + " " + JSON.stringify([...result.diagnostics, ...tx.diagnostics]),
    );
  const saved = serializeProject({
    ...project,
    documents: project.documents.map((doc) =>
      doc.id === d.id ? tx.document : doc,
    ),
  });
  const restored = parseProject(saved);
  const out = restored.documents.find((doc) => doc.id === d.id);
  const originalTopology = deriveElectricalTopologyProjection(original, r);
  const sourceNetByComponent = new Map();
  for (const [pin, component] of deriveElectricalTopologyProjection(out, r)
    .endpointToPhysicalComponent) {
    if (!pin.startsWith("terminal:")) continue;
    const sourceNet = originalTopology.endpointToBaseNet.get(pin) ?? pin;
    if (sourceNetByComponent.has(component))
      assert.equal(
        sourceNetByComponent.get(component),
        sourceNet,
        "physical short",
      );
    sourceNetByComponent.set(component, sourceNet);
  }
  if (folder) {
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, row.id + ".icproj.json"), saved);
    for (const [suffix, doc] of [
      ["human", original],
      ["optimized", out],
    ]) {
      const box = buildSvgScene(doc, r).viewBox;
      fs.writeFileSync(
        path.join(folder, row.id + "-" + suffix + ".svg"),
        renderDocumentSvg(doc, r, { viewBox: box }),
      );
    }
  }
  const metric = (doc) => {
    const { wireLength, bends, crossings } = auditRouting(doc, r);
    return { wireLength, bends, crossings };
  };
  const originalGraph = projectElectricalGraph(project);
  const after = projectElectricalGraph({
    ...project,
    documents: project.documents.map((p) => (p.id === d.id ? out : p)),
  });
  const valid =
    terminalPartition(out, r) === terminalPartition(original, r) &&
    auditRouting(out, r).unsafeProblems.length === 0 &&
    missingConnections(out, r) === 0 &&
    floatingPins(out, r).length === 0 &&
    out.instances.every((i) => i.placement) &&
    (originalGraph.status !== "ready" ||
      (after.status === "ready" &&
        compareElectricalGraphs(originalGraph.graph, after.graph) === "equal"));
  return {
    id: row.id,
    bucket: row.bucket,
    portfolio: row.set === "train" ? pinLayoutMetrics(result) : undefined,
    grid: d.presentation.grid,
    reference: metric(original),
    auto: metric(out),
    valid,
    graph: originalGraph.status,
    diagnostics: result.diagnostics,
  };
}
const [root, subset, dest, algorithm = "baseline", only] =
  process.argv.slice(2);
if (import.meta.main && root) {
  const split = JSON.parse(
    fs.readFileSync(new URL("./split.json", import.meta.url)),
  );
  assert.ok(["train", "validation"].includes(subset));
  assert.ok(["optimized", "baseline"].includes(algorithm));
  const rows = [];
  for (const row of split.filter(
    (c) => c.set === subset && (!only || c.id === only),
  )) {
    try {
      const t = Date.now(),
        v = check(
          row,
          root,
          algorithm === "baseline" ? {} : { quality: "optimized" },
          path.join(path.dirname(dest), subset + "-" + algorithm),
        );
      v.ms = Date.now() - t;
      rows.push(v);
      console.log(v.id, v.valid, v.auto, v.reference, v.ms);
    } catch (e) {
      console.log(String(e));
      rows.push({ id: row.id, valid: false, error: String(e) });
    }
    fs.writeFileSync(dest, JSON.stringify(rows, null, 2) + "\n");
  }
  if (!rows.length || !rows.every((row) => row.valid)) process.exitCode = 1;
}
