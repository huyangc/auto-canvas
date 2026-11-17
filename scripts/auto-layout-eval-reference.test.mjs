import assert from "node:assert/strict";
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
import { test } from "vitest";

import { createEmptyProject } from "../packages/model/dist/index.js";

const root = resolve(import.meta.dirname, "..");
const at = (x, y) => ({ position: { x, y }, rotation: 0, mirror: "none" });
const pin = (instanceId, pinName) => ({ instanceId, pinName });
const resistor = (id, x, y) => ({
  id,
  reference: id,
  symbolId: "resistor",
  placement: at(x, y),
  netlist: {
    binding: { kind: "primitive", deviceClass: "resistor" },
    parameters: { value: "1k" },
  },
});

/**
 * Two resistors, each on its own Net. The drawing puts R9's pin 1 on R1's pin
 * 2 (a touching-not-connected source defect) and draws a ground marker on
 * R9's Net; the netlist input has neither.
 */
function circuit({ drawing }) {
  const project = createEmptyProject("reference", "Reference", "top");
  const document = project.documents[0];
  document.instances.push(
    resistor("R1", 0, 0),
    resistor("R9", drawing ? 0 : 200, 40),
  );
  if (drawing)
    document.instances.push({
      id: "GND1",
      symbolId: "ground",
      placement: at(100, 100),
    });
  document.nets.push(
    { id: "a", terminals: [pin("R1", "1"), pin("R1", "2")] },
    {
      id: "b",
      terminals: [
        pin("R9", "1"),
        pin("R9", "2"),
        ...(drawing ? [pin("GND1", "0")] : []),
      ],
    },
  );
  return project;
}

test("--reference measures the human side on the reference drawing", () => {
  const scratch = mkdtempSync(join(tmpdir(), "eval-reference-"));
  try {
    const [input, reference, out] = ["input", "reference", "out"].map((name) =>
      join(scratch, name),
    );
    mkdirSync(input);
    mkdirSync(reference);
    writeFileSync(
      join(input, "case.json"),
      JSON.stringify(circuit({ drawing: false })),
    );
    writeFileSync(
      join(input, "case.meta.json"),
      JSON.stringify({ id: "case", stage: "converted" }),
    );
    writeFileSync(
      join(reference, "case.json"),
      JSON.stringify(circuit({ drawing: true })),
    );
    const run = spawnSync(
      process.execPath,
      [
        "scripts/auto-layout-eval.mjs",
        input,
        "--reference",
        reference,
        "--out",
        out,
        "--quick",
      ],
      { cwd: root, encoding: "utf8" },
    );
    assert.equal(run.status, 0, run.stderr);
    const report = JSON.parse(readFileSync(join(out, "report.json"), "utf8"));
    assert.deepEqual(report.netlistInput, { folder: input, reference });
    const [m] = report.cases;
    assert.equal(m.status, "completed");
    assert.equal(m.equivalent, true);
    assert.deepEqual(m.reference, { folder: reference, id: "case" });
    assert.deepEqual(m.conversion, { id: "case", stage: "converted" });
    // Human metrics come from the reference; the quick run plans the input.
    assert.equal(m.human.netKindDetail.presentation.ground, 1);
    assert.equal(m.quick.netKindDetail.presentation.ground, 0);
    assert.deepEqual(m.railMarkersReference, { ground: 1, supply: 0 });
    assert.equal(m.human.visibleIntegrity.erc.touchingNotConnected.length, 1);
    // The integrity baseline is the input, which has no source defect.
    assert.deepEqual(m.integrity.sourceDefects, []);
    // No partition oracle on netlist input, so no block metrics.
    assert.equal(m.partitionDiagnostics[0].code, "ORACLE_UNAVAILABLE");
    assert.equal(m.partition, undefined);
    for (const side of [m.human, m.result]) {
      assert.equal(side.blockIntrusion, null);
      assert.equal(side.arrangementAgreement, null);
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}, 120_000);
