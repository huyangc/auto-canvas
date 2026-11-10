import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { createEmptyProject } from "@icm/model";
import { serializeProject } from "@icm/project-protocol";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { recognitionUnits } from "../src/units.js";
import { describeCircuit } from "../src/partition-prompt.js";
import { reconcilePartition } from "../src/partition-reconcile.js";
import { circuit } from "./document-fixture.js";
// @ts-expect-error Standalone CLI has no TypeScript declarations.
import * as mining from "../../../scripts/auto-layout-fingerprint-mine.mjs";
const { aggregateFingerprints, promoteFingerprints } = mining;
// @ts-expect-error Standalone CLI has no TypeScript declarations.
import { cacheKey } from "../../../scripts/auto-layout-llm-partition.mjs";
vi.mock("../dist/fingerprint.js", () => import("../src/fingerprint.js"));
vi.mock(
  "../dist/partition-prompt.js",
  () => import("../src/partition-prompt.js"),
);
vi.mock(
  "../dist/partition-reconcile.js",
  () => import("../src/partition-reconcile.js"),
);
const resolver = new InMemorySymbolResolver(builtInSymbols);
const directories: string[] = [];
afterEach(() => {
  directories
    .splice(0)
    .forEach((dir) => rmSync(dir, { recursive: true, force: true }));
});
function directory() {
  const dir = mkdtempSync(join(tmpdir(), "t030-mining-"));
  directories.push(dir);
  return dir;
}
function record(documentKey: string, role: "gain" | "other" = "gain") {
  const document = circuit(
    { a: "resistor", b: "capacitor" },
    { link: ["a.2", "b.1"], left: ["a.1"], right: ["b.2"] },
  );
  const sample = {
    blocks: [
      {
        id: "b",
        title: "Synthetic <filter>",
        role,
        units: recognitionUnits(document, resolver).map((u) => u.id),
        reason: "connected",
      },
    ],
    uncertain: [],
  };
  return {
    documentKey,
    document,
    resolver,
    sample,
    ...reconcilePartition(document, resolver, [sample]),
  };
}
function nestedRecord(documentKey: string, largerBlock: boolean) {
  const document = circuit(
    { a: "resistor", b: "capacitor", x: "inductor" },
    {
      left: ["x.2", "a.1"],
      link: ["a.2", "b.1"],
      right: ["b.2"],
      end: ["x.1"],
    },
  );
  for (const device of document.instances)
    device.id = `${documentKey}-${device.id}`;
  for (const net of document.nets)
    for (const terminal of net.terminals)
      terminal.instanceId = `${documentKey}-${terminal.instanceId}`;
  const units = recognitionUnits(document, resolver);
  const groups = (largerBlock ? [["a", "b", "x"]] : [["a", "b"], ["x"]]).map(
    (members) => members.map((id) => `${documentKey}-${id}`),
  );
  const sample = {
    blocks: groups.map((members, n) => ({
      id: `block-${n}`,
      title: largerBlock ? "Larger filter" : "Small filter",
      role: "gain" as const,
      units: units
        .filter((u) => members.includes(u.members[0]!.id))
        .map((u) => u.id),
      reason: "connected",
    })),
    uncertain: [],
  };
  return {
    documentKey,
    document,
    resolver,
    sample,
    ...reconcilePartition(document, resolver, [sample]),
  };
}
it("aggregates distinct documents and role frequencies at the thresholds, excluding ineligible blocks", () => {
  const records = [
    record("one"),
    record("one"),
    record("two"),
    record("three", "other"),
    record("four", "other"),
  ];
  const result = aggregateFingerprints(records);
  expect(result.candidates).toHaveLength(1);
  expect(result.candidates[0]).toMatchObject({
    documents: 4,
    occurrences: 5,
    matchedDocuments: 4,
    matchedOccurrences: 4,
    matchedAsBlock: 4,
    matchedIntact: 4,
    precision: 1,
    budgetExhaustedDocuments: [],
    role: "gain",
    roleShare: 0.6,
    roles: { gain: 3, other: 2 },
    titles: { "Synthetic <filter>": 5 },
  });
  expect(
    aggregateFingerprints([record("one"), record("one")]).candidates,
  ).toEqual([]);
  expect(
    aggregateFingerprints([record("one"), record("two", "other")]).candidates,
  ).toEqual([]);
  for (const change of [
    { confidence: 0.59 },
    { provenance: "rule" },
    { provenance: "attached" },
    { provenance: "template" },
    { unitIds: ["U1"] },
    { members: ["a"] },
    { members: Array(17).fill("a") },
  ]) {
    const input = record("one");
    Object.assign(input.partition.blocks[0]!, change);
    expect(aggregateFingerprints([input]).fingerprints).toEqual([]);
  }
  const boundary = record("one");
  boundary.partition.blocks[0]!.confidence = 0.6;
  expect(aggregateFingerprints([boundary]).fingerprints).toHaveLength(1);
});
it("promotes only selected valid candidates, with aggregate sources and no private examples", async () => {
  const dir = directory(),
    candidatePath = join(dir, "candidates.json"),
    libraryPath = join(dir, "library.json");
  const result = aggregateFingerprints([
    record("private-file-one"),
    record("private-file-two"),
  ]);
  writeFileSync(candidatePath, JSON.stringify(result));
  writeFileSync(libraryPath, '{ "version": 1, "entries": [] }\n');
  const hash = result.candidates[0].hash;
  await expect(
    promoteFingerprints([hash], "", candidatePath, libraryPath),
  ).rejects.toThrow();
  await expect(
    promoteFingerprints(["missing"], "Reviewer", candidatePath, libraryPath),
  ).rejects.toThrow();
  expect(JSON.parse(readFileSync(libraryPath, "utf8")).entries).toEqual([]);
  await promoteFingerprints([hash], "Reviewer", candidatePath, libraryPath);
  const written = readFileSync(libraryPath, "utf8");
  expect(written.endsWith("\n")).toBe(true);
  const library = JSON.parse(written);
  expect(library.entries[0]).toMatchObject({
    approvedBy: "Reviewer",
    sources: { documents: 2, occurrences: 2, roles: { gain: 2 } },
  });
  expect(JSON.stringify(library.entries[0].sources)).not.toMatch(
    /private-file|Synthetic|examples|members/,
  );
  expect(written).not.toContain("private-file");
  await expect(
    promoteFingerprints([hash], "Reviewer", candidatePath, libraryPath),
  ).rejects.toThrow(/Duplicate/);
  expect(readFileSync(libraryPath, "utf8")).toBe(written);
});
it("refuses to promote a candidate with a project-local symbol, without naming it", async () => {
  const dir = directory(),
    candidatePath = join(dir, "candidates.json"),
    libraryPath = join(dir, "library.json");
  const result = aggregateFingerprints([record("one"), record("two")]);
  const candidate = result.candidates[0];
  const graph = JSON.parse(candidate.canonical);
  const device = graph.nodes.findIndex((n: string[]) => n[0] === "device");
  graph.nodes[device] = ["device", "unknown", "", "case-local-filter"];
  candidate.canonical = JSON.stringify(graph);
  writeFileSync(candidatePath, JSON.stringify(result));
  writeFileSync(libraryPath, '{ "version": 1, "entries": [] }\n');
  const refusal = promoteFingerprints(
    [candidate.hash],
    "Reviewer",
    candidatePath,
    libraryPath,
  );
  await expect(refusal).rejects.toThrow(/project-local symbol/);
  await expect(refusal).rejects.not.toThrow(/case-local-filter/);
  expect(JSON.parse(readFileSync(libraryPath, "utf8")).entries).toEqual([]);
});
it("mines real synthetic caches offline, renders highlights, and runs explicit CLI promotion", () => {
  const dir = directory(),
    folder = join(dir, "cases"),
    cache = join(dir, "tmp/llm-partition");
  mkdirSync(folder);
  mkdirSync(cache, { recursive: true });
  const input = record("synthetic");
  input.document.instances.forEach((i, n) => {
    i.placement = {
      position: { x: n * 400, y: 0 },
      rotation: 0,
      mirror: "none",
    };
  });
  for (const [name, fixture] of [
    ["one", input],
    ["two", input],
    ["small-one", nestedRecord("small-one", false)],
    ["small-two", nestedRecord("small-two", false)],
    ["larger", nestedRecord("larger", true)],
  ] as const) {
    const project = createEmptyProject(
      "synthetic",
      "Synthetic",
      fixture.document.id,
    );
    project.documents = [fixture.document];
    writeFileSync(join(folder, `${name}.json`), serializeProject(project));
    const payload = describeCircuit(fixture.document, resolver);
    writeFileSync(
      join(cache, `${cacheKey(payload)}.json`),
      JSON.stringify({ status: "valid-first-try", output: fixture.sample }),
    );
  }
  const library = join(dir, "experimental-library.json");
  writeFileSync(library, '{ "version": 1, "entries": [] }\n');
  const cli = (args: string[]) =>
    spawnSync(
      process.execPath,
      [
        resolve("scripts/auto-layout-fingerprint-mine.mjs"),
        ...args,
        "--library",
        library,
      ],
      {
        cwd: dir,
        encoding: "utf8",
        env: {
          ...process.env,
          HTTP_PROXY: "http://127.0.0.1:1",
          HTTPS_PROXY: "http://127.0.0.1:1",
        },
      },
    );
  const zero = cli([folder, "--samples", "0"]);
  expect(zero.status, zero.stderr).toBe(0);
  const output = join(dir, "tmp/fingerprints/candidates.json");
  expect(JSON.parse(readFileSync(output, "utf8")).candidates).toEqual([]);
  const mined = cli([folder, folder, "--samples", "1"]);
  expect(mined.status, mined.stderr).toBe(0);
  const result = JSON.parse(readFileSync(output, "utf8"));
  expect(result).toMatchObject({
    documents: 5,
    failures: [],
    candidates: [
      {
        documents: 2,
        occurrences: 2,
        role: "gain",
        matchedDocuments: 2,
        matchedOccurrences: 2,
        matchedAsBlock: 2,
        matchedIntact: 2,
        precision: 1,
        budgetExhaustedDocuments: [],
      },
    ],
  });
  expect(result.rejected).toHaveLength(1);
  expect(result.rejected[0]).toMatchObject({
    documents: 2,
    matchedOccurrences: 3,
    matchedAsBlock: 2,
    matchedIntact: 3,
    precision: 2 / 3,
  });
  const html = readFileSync(join(dir, "tmp/fingerprints/index.html"), "utf8");
  expect(html).toContain("Synthetic &lt;filter&gt;");
  expect(html).toContain("matcher: 2 documents, 2 occurrences");
  expect(html).toContain('fill-opacity="0.12"');
  const rejectedHtml = html.split("<h1>Rejected: precision below 80%</h1>")[1]!;
  expect(rejectedHtml).toContain("Small filter");
  expect(rejectedHtml).toContain("precision 66.7%");
  expect(rejectedHtml).not.toContain("<svg");
  const rejectedPromotion = cli([
    "--promote",
    result.rejected[0].hash,
    "--approved-by",
    "Synthetic Reviewer",
  ]);
  expect(rejectedPromotion.status).toBe(1);
  expect(rejectedPromotion.stderr).toContain("Not a qualifying candidate");
  expect(JSON.parse(readFileSync(library, "utf8")).entries).toEqual([]);
  const promoted = cli([
    "--promote",
    result.candidates[0].hash,
    "--approved-by",
    "Synthetic Reviewer",
  ]);
  expect(promoted.status, promoted.stderr).toBe(0);
  expect(JSON.parse(readFileSync(library, "utf8")).entries).toHaveLength(1);
  const withLibrary = cli([folder, "--samples", "1"]);
  expect(withLibrary.status, withLibrary.stderr).toBe(0);
  expect(JSON.parse(readFileSync(output, "utf8"))).toEqual(result);
});

it("counts matcher support beyond mined blocks and reports exhausted budgets", () => {
  const unseen = record("unmined");
  unseen.partition.blocks = [];
  const duplicate = structuredClone(unseen.document);
  for (const device of duplicate.instances) device.id += "-copy";
  for (const net of duplicate.nets) {
    net.id += "-copy";
    for (const terminal of net.terminals) terminal.instanceId += "-copy";
  }
  unseen.document.instances.push(...duplicate.instances);
  unseen.document.nets.push(...duplicate.nets);
  const records = [record("one"), record("two"), unseen];
  expect(aggregateFingerprints(records).rejected[0]).toMatchObject({
    documents: 2,
    matchedDocuments: 3,
    matchedOccurrences: 4,
    matchedAsBlock: 2,
    matchedIntact: 2,
    precision: 0.5,
    budgetExhaustedDocuments: [],
  });
  expect(
    aggregateFingerprints(records, { nodeBudget: 0 }).rejected[0],
  ).toMatchObject({
    matchedDocuments: 0,
    matchedOccurrences: 0,
    precision: 0,
    budgetExhaustedDocuments: ["one", "two", "unmined"],
  });
});

it("ranks equal-precision candidates by matcher support before mining support", () => {
  const other = ["other-one", "other-two", "other-three"].map((key) => {
    const input = record(key);
    input.document.instances.find((i) => i.id === "b")!.symbolId = "inductor";
    return input;
  });
  const unmined = ["unmined-one", "unmined-two"].map((key) => {
    const input = record(key);
    input.partition.blocks[0]!.provenance = "attached";
    return input;
  });
  const records = [record("one"), record("two"), ...other];
  expect(
    aggregateFingerprints([...records, unmined[0]]).candidates.map(
      (c: { documents: number }) => c.documents,
    ),
  ).toEqual([3, 2]);
  expect(
    aggregateFingerprints([...records, ...unmined]).candidates.map(
      (c: { documents: number }) => c.documents,
    ),
  ).toEqual([2, 3]);
});

it("ranks precision before matcher support and accepts the 80% boundary", async () => {
  const records = Array.from({ length: 5 }, (_, n) => {
    const input = record(`rc-${n}`);
    if (n === 4) input.partition.blocks[0]!.provenance = "rule";
    return input;
  });
  const other = ["rl-one", "rl-two"].map((key) => {
    const input = record(key);
    input.document.instances.find((i) => i.id === "b")!.symbolId = "inductor";
    return input;
  });
  const result = aggregateFingerprints([...records, ...other]);
  expect(
    result.candidates.map((c: { precision: number }) => c.precision),
  ).toEqual([1, 0.8]);
  expect(result.candidates[1]).toMatchObject({
    matchedOccurrences: 5,
    matchedAsBlock: 4,
    matchedIntact: 5,
  });
  const dir = directory(),
    candidatePath = join(dir, "candidates.json"),
    libraryPath = join(dir, "library.json");
  writeFileSync(libraryPath, '{ "version": 1, "entries": [] }\n');
  writeFileSync(candidatePath, JSON.stringify(result));
  const hash = result.candidates[1].hash;
  await promoteFingerprints([hash], "Reviewer", candidatePath, libraryPath);
  for (const precision of [0.79, undefined]) {
    result.candidates[1].precision = precision;
    writeFileSync(candidatePath, JSON.stringify(result));
    const before = readFileSync(libraryPath, "utf8");
    await expect(
      promoteFingerprints([hash], "Reviewer", candidatePath, libraryPath),
    ).rejects.toThrow(/Not a qualifying candidate/);
    expect(readFileSync(libraryPath, "utf8")).toBe(before);
  }
});
