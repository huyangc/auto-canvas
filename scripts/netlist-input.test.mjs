import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { beforeAll, test } from "vitest";

import { createEmptyProject } from "../packages/model/dist/index.js";
import { parseProject } from "../packages/project-protocol/dist/index.js";
import { bundleImportDisplay } from "./lib/import-display-bundle.mjs";
import { convertProject } from "./netlist-input.mjs";

const root = resolve(import.meta.dirname, "..");
let importStep;
beforeAll(async () => {
  importStep = await import(await bundleImportDisplay());
}, 120_000);

const at = (x, y) => ({ position: { x, y }, rotation: 0, mirror: "none" });
const pin = (instanceId, pinName) => ({ instanceId, pinName });

/**
 * A drawn diode-connected NMOS with a resistor load: the source on a ground
 * marker, the load on a `vdd-port` that is the Cell terminal VDD.
 */
function drawing({ resistorValue = "1k" } = {}) {
  const project = createEmptyProject("fixture", "Fixture", "top");
  const document = project.documents[0];
  document.instances.push(
    {
      id: "M1",
      reference: "M1",
      symbolId: "nmos",
      placement: at(0, 100),
      netlist: {
        binding: { kind: "model", deviceClass: "mos", name: "NMOS" },
        parameters: { w: "1u", l: "150n" },
      },
    },
    {
      id: "R1",
      reference: "R1",
      symbolId: "resistor",
      placement: at(0, 0),
      netlist: {
        binding: { kind: "primitive", deviceClass: "resistor" },
        parameters: resistorValue ? { value: resistorValue } : {},
      },
    },
    { id: "GND1", symbolId: "ground", placement: at(0, 200) },
    { id: "VDD1", symbolId: "vdd-port", placement: at(0, -100) },
  );
  document.nets.push(
    { id: "vdd", terminals: [pin("VDD1", "P"), pin("R1", "1")] },
    { id: "out", terminals: [pin("R1", "2"), pin("M1", "D"), pin("M1", "G")] },
    { id: "gnd", terminals: [pin("M1", "S"), pin("GND1", "0")] },
  );
  document.netlist.terminals.push({
    id: "terminal-vdd",
    name: "VDD",
    netId: "vdd",
    direction: "passive",
    interfaceInstanceIds: ["VDD1"],
  });
  return parseProject(JSON.stringify(project));
}

const top = (text) => {
  const project = JSON.parse(text);
  return project.documents.find((d) => d.id === project.topDocumentId);
};
const groundClaims = (document) =>
  document.connectivityEvidence.filter(
    (e) => e.kind === "name-claim" && e.powerDomain === "ground",
  );
const vssPorts = (document) =>
  document.netlist.terminals.filter(
    (t) =>
      t.name === "VSS" &&
      t.interfaceInstanceIds.some(
        (id) =>
          document.instances.find((i) => i.id === id)?.symbolId === "port",
      ),
  );

test("the VSS form imports ground as a VSS port without a ground claim", async () => {
  const { meta, netlist, project } = await convertProject(
    drawing(),
    "fixture",
    "vss",
    importStep,
  );
  assert.equal(meta.stage, "converted");
  assert.match(netlist, /^\.subckt \S+ VDD VSS$/mu);
  const document = top(project);
  assert.equal(vssPorts(document).length, 1);
  assert.deepEqual(groundClaims(document), []);
  assert.equal(meta.import.groundClaim, false);
  assert.equal(meta.import.groundTerminals, 1);
  assert.deepEqual(meta.terminals, { added: ["VSS"], lost: [] });
  assert.equal(meta.electricalGraph, "equal");
  assert.equal(meta.reexport, "identical");
  // The drawing's markers do not come back; the MOS bulk is netted now.
  assert.equal(meta.source.ground, 1);
  assert.equal(meta.source.supply, 1);
  assert.equal(meta.import.ground + meta.import.supply, 0);
  assert.deepEqual(meta.pinsNettedOnlyInImport, ["m1.B"]);
});

test("the global form imports ground as node 0 with a ground claim and no VSS port", async () => {
  const { meta, netlist, project } = await convertProject(
    drawing(),
    "fixture",
    "global",
    importStep,
  );
  assert.equal(meta.stage, "converted");
  assert.match(netlist, /^M1 \S+ \S+ 0 0 NMOS/mu);
  const document = top(project);
  assert.equal(vssPorts(document).length, 0);
  assert.equal(groundClaims(document).length, 1);
  assert.equal(meta.import.groundClaim, true);
  assert.deepEqual(meta.terminals, { added: [], lost: [] });
  assert.equal(meta.electricalGraph, "equal");
  assert.equal(meta.reexport, "identical");
});

test("a drawing the exporter blocks gets an export-blocked meta", async () => {
  const { meta, netlist, project } = await convertProject(
    drawing({ resistorValue: null }),
    "blocked",
    "vss",
    importStep,
  );
  assert.equal(meta.stage, "export-blocked");
  assert.ok(meta.errorCodes.includes("MISSING_REQUIRED_PARAMETER"));
  assert.equal(typeof meta.message, "string");
  assert.equal(netlist, undefined);
  assert.equal(project, undefined);
});

test("two runs with different job counts write identical bytes", () => {
  const scratch = mkdtempSync(join(tmpdir(), "netlist-input-"));
  const corpus = join(scratch, "corpus");
  mkdirSync(corpus);
  writeFileSync(join(corpus, "a.json"), JSON.stringify(drawing()));
  writeFileSync(
    join(corpus, "b.json"),
    JSON.stringify(drawing({ resistorValue: null })),
  );
  const run = (jobs) => {
    const out = join(scratch, `out-${jobs}`);
    execFileSync(
      process.execPath,
      [
        "scripts/netlist-input.mjs",
        corpus,
        "--form",
        "vss",
        "--out",
        out,
        "--jobs",
        String(jobs),
      ],
      { cwd: root, stdio: "pipe" },
    );
    return Object.fromEntries(
      readdirSync(out)
        .sort()
        .map((f) => [f, readFileSync(join(out, f), "utf8")]),
    );
  };
  const first = run(1);
  assert.deepEqual(Object.keys(first), [
    "a.json",
    "a.meta.json",
    "a.sp",
    "b.meta.json",
  ]);
  assert.deepEqual(run(2), first);
}, 120_000);
