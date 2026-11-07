import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { planAutoLayout } from "../packages/auto-layout/dist/index.js";
import {
  auditRouting,
  floatingPins,
} from "../packages/auto-layout/dist/routing-audit.js";
import { terminalPartition } from "../packages/auto-layout/dist/transaction.js";
import { refinementMetrics } from "../packages/auto-layout/dist/refine.js";
import { executeTransaction } from "../packages/edit-engine/dist/index.js";
import {
  compareElectricalGraphs,
  projectElectricalGraph,
} from "../packages/netlist/dist/index.js";
import { parseProject } from "../packages/project-protocol/dist/index.js";
import {
  buildSvgScene,
  renderDocumentSvg,
} from "../packages/render-svg/dist/index.js";
import {
  builtInSymbols,
  createProjectSymbolResolver,
} from "../packages/symbols/dist/index.js";

const [folder, ...args] = process.argv.slice(2);
if (!folder || (args.length && (args.length !== 2 || args[0] !== "--baseline")))
  throw new Error(
    "Usage: auto-layout-eval.mjs <folder> [--baseline <report.json>]",
  );
const baseline = args.length
  ? JSON.parse(readFileSync(args[1], "utf8"))
  : undefined;
const output = "tmp/auto-layout-eval";
mkdirSync(output, { recursive: true });
const escape = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
const measurements = [];
const sections = [];
const metrics = (document, resolver) => {
  const audit = auditRouting(document, resolver);
  return {
    crossings: audit.crossings,
    bends: audit.bends,
    wireLength: audit.wireLength,
    unsafeProblems: audit.unsafeProblems,
    floatingPins: floatingPins(document, resolver),
  };
};
for (const file of readdirSync(folder)
  .filter((f) => f.endsWith(".json") && !f.endsWith(".meta.json"))
  .sort()) {
  const id = file.slice(0, -5);
  const split =
    BigInt(`0x${createHash("sha256").update(id).digest("hex")}`) % 3n === 0n
      ? "val"
      : "dev";
  const measurement = {
    id,
    split,
    status: "threw",
    milliseconds: null,
    instances: null,
    human: null,
    result: null,
    equivalent: null,
    diagnostics: [],
  };
  try {
    const project = parseProject(readFileSync(join(folder, file), "utf8"));
    const document = project.documents.find(
      (d) => d.id === project.topDocumentId,
    );
    if (!document) throw new Error("Top Document missing");
    const resolver = createProjectSymbolResolver(project, builtInSymbols);
    measurement.instances = document.instances.length;
    measurement.human = {
      ...metrics(document, resolver),
      equivalent: true,
      milliseconds: 0,
      status: "original",
    };
    const start = performance.now();
    let plan;
    try {
      plan = planAutoLayout(document, resolver);
    } finally {
      measurement.milliseconds = performance.now() - start;
    }
    measurement.candidates = refinementMetrics(plan)?.candidates ?? 0;
    measurement.diagnostics = [...plan.diagnostics];
    const transaction = plan.diagnostics.some((d) => d.severity === "error")
      ? undefined
      : executeTransaction(
          document,
          {
            transactionId: `eval-${id}`,
            documentId: document.id,
            expectedRevision: document.revision,
            actor: { kind: "agent", id: "auto-layout-eval" },
            edits: plan.edits,
          },
          { symbolResolver: resolver },
        );
    measurement.diagnostics.push(...(transaction?.diagnostics ?? []));
    const completed = transaction?.ok && transaction.applied;
    const after = completed ? transaction.document : document;
    measurement.status = completed ? "completed" : "refused";
    if (completed) {
      measurement.result = metrics(after, resolver);
      const beforeGraph = projectElectricalGraph(project);
      const afterGraph = projectElectricalGraph({
        ...project,
        documents: project.documents.map((d) =>
          d.id === document.id ? after : d,
        ),
      });
      measurement.equivalent =
        terminalPartition(document, resolver) ===
          terminalPartition(after, resolver) &&
        (beforeGraph.status !== "ready" ||
          (afterGraph.status === "ready" &&
            compareElectricalGraphs(beforeGraph.graph, afterGraph.graph) ===
              "equal"));
    }
    const render = (d) => {
      const box = buildSvgScene(d, resolver).viewBox;
      const x = Math.floor(box.x),
        y = Math.floor(box.y);
      return renderDocumentSvg(d, resolver, {
        bounds: {
          x,
          y,
          width: Math.ceil(box.x + box.width) - x,
          height: Math.ceil(box.y + box.height) - y,
        },
      });
    };
    const humanSvg = render(document),
      resultSvg = render(after);
    writeFileSync(`${output}/${id}-human.svg`, humanSvg);
    writeFileSync(`${output}/${id}-result.svg`, resultSvg);
    sections.push(
      `<section id="${escape(id)}"><h2>${escape(id)} (${split}, ${measurement.instances} instances)</h2><p>${measurement.status}; ${measurement.milliseconds.toFixed(1)} ms</p><pre>${escape(JSON.stringify(measurement, null, 2))}</pre><div class="pair"><figure><figcaption>Human</figcaption>${humanSvg}</figure><figure><figcaption>Auto (${measurement.status})</figcaption>${resultSvg}</figure></div></section>`,
    );
  } catch (error) {
    measurement.status = "threw";
    measurement.error = String(error?.stack ?? error);
  }
  measurements.push(measurement);
  console.log(
    `${id}: ${measurement.status}; ${measurement.instances} instances; ${measurement.milliseconds?.toFixed(1) ?? "—"} ms`,
  );
}
const totals = [];
const metricText = (m) =>
  m ? `${m.crossings}/${m.bends}/${Math.round(m.wireLength)}` : "—";
for (const split of ["dev", "val"]) {
  const cases = measurements.filter((m) => m.split === split);
  console.log(
    `\n${split}: crossings / bends / wire length; floating pin counts`,
  );
  console.table(
    cases.map((m) => ({
      id: m.id,
      instances: m.instances,
      status: m.status,
      human: metricText(m.human),
      ...(baseline
        ? {
            before: metricText(
              baseline.cases.find((b) => b.id === m.id)?.result,
            ),
          }
        : {}),
      after: metricText(m.result),
      humanFloating: m.human?.floatingPins.length ?? "—",
      resultFloating: m.result?.floatingPins.length ?? "—",
      ms: m.milliseconds?.toFixed(1),
      equivalent: m.equivalent,
      unsafe: m.result?.unsafeProblems.length ?? "—",
      reason:
        m.error ??
        m.diagnostics
          .filter((d) => d.severity === "error")
          .map((d) => d.message)
          .join("; "),
    })),
  );
  const common = cases.filter(
    (m) =>
      m.status === "completed" &&
      (!baseline ||
        baseline.cases.some((b) => b.id === m.id && b.status === "completed")),
  );
  const sum = (items) => ({
    crossings: items.reduce((s, m) => s + m.crossings, 0),
    bends: items.reduce((s, m) => s + m.bends, 0),
    wireLength: items.reduce((s, m) => s + m.wireLength, 0),
    floatingPins: items.every((m) => Array.isArray(m.floatingPins))
      ? items.reduce((s, m) => s + m.floatingPins.length, 0)
      : null,
  });
  const total = {
    split,
    documents: cases.length,
    completed: cases.filter((m) => m.status === "completed").length,
    common: common.length,
    human: sum(common.map((m) => m.human)),
    before: baseline
      ? sum(common.map((m) => baseline.cases.find((b) => b.id === m.id).result))
      : null,
    after: sum(common.map((m) => m.result)),
    allHuman: sum(cases.filter((m) => m.human).map((m) => m.human)),
    allCompleted: sum(cases.filter((m) => m.result).map((m) => m.result)),
  };
  totals.push(total);
  console.log(JSON.stringify(total));
}
writeFileSync(
  `${output}/report.json`,
  JSON.stringify({ cases: measurements, totals }, null, 2),
);
writeFileSync(
  `${output}/index.html`,
  `<!doctype html><html lang="en"><meta charset="utf-8"><title>Auto-layout evaluation</title><style>body{font:15px system-ui;background:#f1f4f7;margin:24px}section{background:white;padding:20px;margin:20px 0}pre{white-space:pre-wrap;font-size:12px}.pair{display:grid;grid-template-columns:1fr 1fr;gap:20px}figure{margin:0;min-width:0}svg{width:100%;height:650px;border:1px solid #ddd}</style><h1>Human / auto-layout pairs</h1>${sections.join("\n")}</html>`,
);
console.log(`Wrote ${output}/report.json and index.html`);
if (
  measurements.some(
    (m) =>
      m.status === "threw" ||
      (m.status === "completed" &&
        (!m.equivalent ||
          m.result.unsafeProblems.length ||
          m.result.floatingPins.some(
            (pin) =>
              !m.diagnostics.some(
                (d) =>
                  d.rule === "R14" &&
                  d.severity === "warning" &&
                  d.message.includes(`${pin.instanceId}.${pin.pinName}`),
              ),
          ))),
  )
)
  process.exitCode = 1;
