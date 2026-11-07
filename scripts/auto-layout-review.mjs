import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { auditRouting } from "../packages/auto-layout/dist/routing-audit.js";
import { refinementMetrics } from "../packages/auto-layout/dist/refine.js";
import { terminalPartition } from "../packages/auto-layout/dist/transaction.js";
import {
  compareElectricalGraphs,
  projectElectricalGraph,
} from "../packages/netlist/dist/index.js";
import { planAutoLayout } from "../packages/auto-layout/dist/index.js";
import { executeTransaction } from "../packages/edit-engine/dist/index.js";
import { parseProject } from "../packages/project-protocol/dist/index.js";
import {
  buildSvgScene,
  renderDocumentSvg,
} from "../packages/render-svg/dist/index.js";
import {
  builtInSymbols,
  createProjectSymbolResolver,
} from "../packages/symbols/dist/index.js";

const cases = JSON.parse(
  readFileSync("packages/auto-layout/test/corpus-cases.json", "utf8"),
);
const heldOut = JSON.parse(
  readFileSync("packages/auto-layout/test/held-out-cases.json", "utf8"),
);
const baseline = JSON.parse(
  readFileSync("packages/auto-layout/test/baseline-metrics.json", "utf8"),
);
const output = "tmp/auto-layout-review";
mkdirSync(output, { recursive: true });
const escape = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
const sections = [];
const measurements = [];
let failures = 0;
for (const fixture of [...cases, ...heldOut]) {
  const held = heldOut.includes(fixture);
  if (fixture === cases[0]) sections.push("<h2>Corpus</h2>");
  if (fixture === heldOut[0]) sections.push("<h2>Held-out circuits</h2>");
  const project = parseProject(readFileSync(fixture.file, "utf8"));
  const document = project.documents.find(
    (d) => d.id === (fixture.documentId ?? project.topDocumentId),
  );
  if (!document) throw new Error(`Missing Document for ${fixture.id}`);
  const resolver = createProjectSymbolResolver(project, builtInSymbols);
  const start = performance.now();
  const plan = planAutoLayout(document, resolver);
  const milliseconds = performance.now() - start;
  const result = plan.diagnostics.some((d) => d.severity === "error")
    ? undefined
    : executeTransaction(
        document,
        {
          transactionId: `review-${fixture.id}`,
          documentId: document.id,
          expectedRevision: document.revision,
          actor: { kind: "agent", id: "auto-layout-review" },
          edits: plan.edits,
        },
        { symbolResolver: resolver },
      );
  const committed = result?.ok && result.applied;
  const diagnostics = [...plan.diagnostics, ...(result?.diagnostics ?? [])];
  const mustCommit =
    !held || ["fd-two-stage", "common-source-ac", "skew"].includes(fixture.id);
  if (!committed && mustCommit) failures++;
  const after = committed ? result.document : document;
  const audit = committed ? auditRouting(after, resolver) : undefined;
  const beforeGraph = projectElectricalGraph(project);
  if (committed) {
    const afterGraph = projectElectricalGraph({
      ...project,
      documents: project.documents.map((d) =>
        d.id === document.id ? after : d,
      ),
    });
    const equivalent =
      beforeGraph.status === "ready"
        ? afterGraph.status === "ready" &&
          compareElectricalGraphs(beforeGraph.graph, afterGraph.graph) ===
            "equal"
        : terminalPartition(document, resolver) ===
          terminalPartition(after, resolver);
    const problems = [
      ...audit.unsafeProblems,
      ...(!equivalent ? ["Electrical equivalence failed"] : []),
    ];
    for (const message of problems)
      diagnostics.push({
        severity: "error",
        code: "AUTO_LAYOUT_REVIEW_INVALID_RESULT",
        rule: "R10",
        message,
      });
    if (problems.length) failures++;
  }
  const refinement = refinementMetrics(plan);
  measurements.push({
    section: held ? "held-out" : "corpus",
    baseline: baseline.cases.find((c) => c.id === fixture.id),
    candidates: refinement?.candidates ?? 0,
    score: Number.isFinite(refinement?.score) ? refinement.score : null,
    id: fixture.id,
    milliseconds,
    committed,
    routes: committed ? after.routes.length : null,
    crossings: audit?.crossings ?? null,
    bends: audit?.bends ?? null,
    wireLength: audit?.wireLength ?? null,
    diagnostics,
  });
  const boxes = [document, after].map(
    (d) => buildSvgScene(d, resolver).viewBox,
  );
  const grid = document.presentation.grid;
  const x = Math.floor(Math.min(...boxes.map((b) => b.x)) / grid) * grid;
  const y = Math.floor(Math.min(...boxes.map((b) => b.y)) / grid) * grid;
  const bounds = {
    x,
    y,
    width:
      Math.ceil(Math.max(...boxes.map((b) => b.x + b.width)) / grid) * grid - x,
    height:
      Math.ceil(Math.max(...boxes.map((b) => b.y + b.height)) / grid) * grid -
      y,
  };
  const originalSvg = renderDocumentSvg(document, resolver, { bounds });
  const resultSvg = renderDocumentSvg(after, resolver, { bounds });
  writeFileSync(`${output}/${fixture.id}.svg`, resultSvg);
  const status = committed
    ? diagnostics.some((d) => d.severity === "error")
      ? "Committed — contract violation"
      : diagnostics.length
        ? "Committed with warnings"
        : "Committed"
    : "Blocked — original retained";
  console.log(
    `${fixture.id}: ${milliseconds.toFixed(3)} ms; ${refinement?.candidates ?? 0} candidates; score ${refinement?.score ?? "—"}; ${status}; ${after.routes.length} Routes; ${audit?.crossings ?? "—"} crossings; ${audit?.bends ?? "—"} bends; ${audit?.wireLength.toFixed(1) ?? "—"} wire units; ${diagnostics.map((d) => d.message).join("; ")}`,
  );
  sections.push(
    `<section><h2>${escape(fixture.id)}</h2><p>${escape(status)} · ${milliseconds.toFixed(3)} ms</p><pre>${escape(JSON.stringify({ groups: plan.groups, diagnostics, metrics: audit, refinement }, null, 2))}</pre><div class="pair"><figure><figcaption>Original</figcaption>${originalSvg}</figure><figure><figcaption>${escape(status)}</figcaption>${resultSvg}</figure></div></section>`,
  );
}
writeFileSync(`${output}/metrics.json`, JSON.stringify(measurements, null, 2));
writeFileSync(
  `${output}/index.html`,
  `<!doctype html><html lang="en"><meta charset="utf-8"><title>Auto-layout review</title><style>body{font:15px system-ui;margin:24px;color:#18212b;background:#f1f4f7}section{background:white;padding:20px;margin:20px 0;border:1px solid #cbd5df}pre{white-space:pre-wrap;font-size:12px}.pair{display:grid;grid-template-columns:1fr 1fr;gap:20px}figure{margin:0;min-width:0}figcaption{font-weight:bold;margin:8px 0}svg{width:100%;height:auto;max-height:720px;border:1px solid #ddd}</style><h1>Auto-layout corpus review</h1><p>Blocked cases retain their original drawing. Diagnostics explain why no result was committed.</p>${sections.join("\n")}</html>`,
);
console.log(`Before (${baseline.commit}) and after; — means safely refused:`);
console.table(
  measurements.map((m) => ({
    id: m.id,
    "before crossings/bends/length":
      m.baseline?.crossings == null
        ? "—"
        : `${m.baseline.crossings}/${m.baseline.bends}/${m.baseline.wireLength}`,
    "after crossings/bends/length":
      m.crossings == null ? "—" : `${m.crossings}/${m.bends}/${m.wireLength}`,
    score: m.score ?? "—",
    candidates: m.candidates,
    ms: m.milliseconds.toFixed(1),
  })),
);
console.log(
  `Wrote ${cases.length} corpus and ${heldOut.length} held-out SVGs and ${output}/index.html`,
);
if (failures) process.exitCode = 1;
