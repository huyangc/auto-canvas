/** Run after reopening/exporting projects:
 * node tasks/T047-safe-pin-contacts/compare.mjs <by-size> <previous eval> <current eval>
 */
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { parseProject } from "../../packages/project-protocol/dist/index.js";
import {
  builtInSymbols,
  createProjectSymbolResolver,
} from "../../packages/symbols/dist/index.js";
import {
  deriveElectricalTopologyProjection,
  endpointKey,
} from "../../packages/derived/dist/index.js";
import { pinPoints } from "../../packages/auto-layout/dist/geometry.js";
import { freezePinGroups } from "../../packages/auto-layout/dist/route.js";
import { terminalPartition } from "../../packages/auto-layout/dist/transaction.js";
import {
  missingConnections,
  floatingPins,
  auditRouting,
} from "../../packages/auto-layout/dist/routing-audit.js";
const [gallery, previous, current] = process.argv.slice(2);
const read = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const terminal = (p) =>
  endpointKey({
    kind: "terminal",
    instanceId: p.instanceId,
    pinName: p.pinName,
  });
function load(file) {
  const p = parseProject(fs.readFileSync(file, "utf8")),
    d = p.documents.find((d) => d.id === p.topDocumentId),
    r = createProjectSymbolResolver(p, builtInSymbols),
    topology = deriveElectricalTopologyProjection(d, r);
  const ps = new Map(pinPoints(d, r).map((p) => [terminal(p), p.point]));
  const groups = freezePinGroups(d, r);
  const span = groups.reduce(
    (s, g) =>
      s +
      ["x", "y"].reduce((sum, axis) => {
        const coords = g.pins.map((p) => ps.get(terminal(p))[axis]);
        return sum + Math.max(...coords) - Math.min(...coords);
      }, 0),
    0,
  );
  const { wireLength, bends, crossings, unsafeProblems } = auditRouting(d, r);
  return {
    d,
    r,
    topology,
    groups,
    metrics: {
      span,
      wireLength,
      bends,
      crossings,
      contacts: groups.flatMap((g) => g.contacts).length,
      missing: missingConnections(d, r),
      floating: floatingPins(d, r).length,
      unsafe: unsafeProblems.length,
    },
  };
}
const rows = [],
  catalog = new Map(
    read(path.join(gallery, "../catalog.json")).map((c) => [c.id, c]),
  );
for (const bucket of ["0-4", "5-10"]) {
  const cases = read(path.join(current, bucket, "report.json")).cases;
  assert.equal(cases.length, bucket === "0-4" ? 13 : 17);
  for (const c of cases) {
    const { id } = c,
      source = load(path.join(gallery, bucket, id + ".json"));
    const [old, now] = [previous, current].map((base) =>
      load(path.join(base, bucket, "projects", id + ".icproj.json")),
    );
    assert.equal(c.status, "completed");
    assert.equal(c.equivalent, true);
    assert.equal(
      terminalPartition(source.d, source.r),
      terminalPartition(now.d, now.r),
      id,
    );
    // An actual physical component must not collect terminals from distinct source nets.
    const compNets = new Map();
    for (const [k, component] of now.topology.endpointToPhysicalComponent) {
      if (!k.startsWith("terminal:")) continue;
      const owner = source.topology.endpointToBaseNet.get(k) ?? k;
      if (compNets.has(component))
        assert.equal(
          compNets.get(component),
          owner,
          id + " physical short at " + k,
        );
      compNets.set(component, owner);
    }
    // Check direct pairs independently against explicit source declarations.
    for (const [a, b] of now.groups.flatMap((g) => g.contacts)) {
      const nets = (p) =>
        source.d.nets
          .filter((n) =>
            n.terminals.some(
              (t) =>
                !t.memberId &&
                t.instanceId === p.instanceId &&
                t.pinName === p.pinName,
            ),
          )
          .map((n) => n.id);
      assert.equal(nets(a).length, 1, id);
      assert.deepEqual(nets(a), nets(b), id);
      assert.ok(now.topology.endpointToPhysicalComponent.get(terminal(a)));
      assert.equal(
        now.topology.endpointToPhysicalComponent.get(terminal(a)),
        now.topology.endpointToPhysicalComponent.get(terminal(b)),
      );
    }
    for (const k of ["missing", "floating", "unsafe"])
      assert.equal(now.metrics[k], 0, id + " " + k);
    for (const k of ["span", "wireLength", "bends", "crossings"])
      assert.ok(now.metrics[k] <= old.metrics[k] + 1e-6, id + " " + k);
    const info = catalog.get(id);
    rows.push({
      id,
      bucket,
      title: info.title,
      provenance: info.provenance,
      original: source.metrics,
      previous: old.metrics,
      current: now.metrics,
    });
  }
}
fs.writeFileSync(
  path.join(current, "comparisons.json"),
  JSON.stringify(rows, null, 2),
);
for (const bucket of ["0-4", "5-10", "all"]) {
  const group = rows.filter((r) => bucket === "all" || r.bucket === bucket);
  console.log(
    bucket,
    ["original", "previous", "current"].map((phase) =>
      ["span", "wireLength", "bends", "crossings", "contacts"].map((k) =>
        group.reduce((s, r) => s + r[phase][k], 0),
      ),
    ),
    "improved",
    group.filter((r) => r.current.wireLength < r.previous.wireLength).length,
  );
}
