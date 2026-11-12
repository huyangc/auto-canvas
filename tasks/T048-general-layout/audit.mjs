import fs from "node:fs";
import assert from "node:assert/strict";
import path from "node:path";
import crypto from "node:crypto";
import { parseProject } from "../../packages/project-protocol/dist/index.js";
import { electricalInput } from "../../tasks/T048-general-layout/bench.mjs";
const [root, dir] = process.argv.slice(2);
if (!dir) throw Error("Usage: node audit.mjs <by-size> <run-directory>");
const manifest = JSON.parse(
  fs.readFileSync(new URL("./split.json", import.meta.url)),
);
const digest = (s) => crypto.createHash("sha256").update(s).digest("hex");
// Name-insensitive bipartite graph refinement catches isomorphic circuits, including a copy with renamed devices and nets.
function fingerprint(d) {
  const devices = d.instances.map((i) => i.id),
    parts = devices.length;
  const labels = [
    ...d.instances.map((i) => i.symbolId),
    ...d.nets.map(() => "net"),
  ];
  const edges = labels.map(() => []);
  d.nets.forEach((n, j) =>
    n.terminals.forEach((t) => {
      const i = devices.indexOf(t.instanceId);
      edges[i].push([t.pinName, parts + j]);
      edges[parts + j].push([t.pinName, i]);
    }),
  );
  let colors = labels.map(digest);
  for (let i = 0; i < labels.length; i++)
    colors = labels.map((_, j) =>
      digest(
        JSON.stringify([
          colors[j],
          edges[j].map(([pin, k]) => [pin, colors[k]]).sort(),
        ]),
      ),
    );
  return digest(JSON.stringify(colors.sort()));
}
const hashes = { train: new Set(), validation: new Set() };
for (const x of manifest) {
  const p = parseProject(
      fs.readFileSync(path.join(root, x.bucket, x.id + ".json"), "utf8"),
    ),
    d = p.documents.find((d) => d.id === p.topDocumentId),
    a = electricalInput(d),
    scrambled = structuredClone(d);
  for (const [j, i] of scrambled.instances.entries())
    i.placement = {
      position: { x: j * 300, y: 400 - j * 200 },
      rotation: 90,
      mirror: "horizontal",
    };
  scrambled.routes = [];
  scrambled.junctions = [];
  scrambled.drafting = undefined;
  scrambled.layoutGroups = [];
  scrambled.constraints = [];
  assert.deepEqual(electricalInput(scrambled), a);
  hashes[x.set].add(fingerprint(a));
}
assert.ok([...hashes.train].every((h) => !hashes.validation.has(h)));
const keys = ["wireLength", "bends", "crossings"];
let data = {};
for (const subset of ["train", "validation"]) {
  const rows = JSON.parse(fs.readFileSync(path.join(dir, subset + ".json")));
  assert.deepEqual(
    rows.map((r) => r.id).sort(),
    manifest
      .filter((x) => x.set === subset)
      .map((x) => x.id)
      .sort(),
  );
  assert.ok(rows.every((r) => r.valid));
  const total = (k) =>
    Object.fromEntries(
      keys.map((metric) => [
        metric,
        rows.reduce((s, r) => s + r[k][metric], 0),
      ]),
    );
  const human = total("reference"),
    auto = total("auto");
  const each = rows.filter((r) =>
    keys.every((k) => r.auto[k] <= 1.1 * r.reference[k] + 1e-8),
  ).length;
  data[subset] = {
    count: rows.length,
    graphReady: rows.filter((r) => r.graph === "ready").length,
    human,
    auto,
    each,
    passed: keys.every((k) => auto[k] <= 1.1 * human[k] + 1e-8),
  };
  console.log(subset, data[subset]);
}
assert.ok(data.validation.passed);
fs.writeFileSync(path.join(dir, "summary.json"), JSON.stringify(data, null, 2));
