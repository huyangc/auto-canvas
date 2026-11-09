import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import {
  isMainThread,
  parentPort,
  Worker,
  workerData,
} from "node:worker_threads";
import { planAutoLayout } from "../packages/auto-layout/dist/index.js";
import {
  auditRouting,
  floatingPins,
  missingConnections,
} from "../packages/auto-layout/dist/routing-audit.js";
import { terminalPartition } from "../packages/auto-layout/dist/transaction.js";
import { enclosingBox } from "../packages/auto-layout/dist/geometry.js";
import { readabilityCounts } from "../packages/auto-layout/dist/readability.js";
import { planningTiming } from "../packages/auto-layout/dist/timing.js";
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
const flags = new Map();
for (let i = 0; i < args.length; i += 2) {
  if (
    !["--baseline", "--search", "--seed", "--jobs"].includes(args[i]) ||
    args[i + 1] === undefined
  )
    throw new Error(
      "Usage: auto-layout-eval.mjs <folder> [--baseline <report.json>] [--search <seconds>] [--seed <n>] [--jobs <n>]",
    );
  flags.set(args[i], args[i + 1]);
}
if (!folder) throw new Error("A document folder is required");
const seconds = Number(flags.get("--search") ?? 0);
const seed = Number(flags.get("--seed") ?? 1);
const jobs = Number(flags.get("--jobs") ?? 1);
if (
  !Number.isFinite(seconds) ||
  seconds < 0 ||
  !Number.isFinite(seed) ||
  !Number.isSafeInteger(jobs) ||
  jobs < 1
)
  throw new Error("Invalid search duration, seed or worker count");
const baseline = flags.has("--baseline")
  ? JSON.parse(readFileSync(flags.get("--baseline"), "utf8"))
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
  const bounds = buildSvgScene(document, resolver).viewBox;
  const instances = enclosingBox(document, resolver);
  return {
    ...readabilityCounts(document, resolver),
    crossings: audit.crossings,
    bends: audit.bends,
    wireLength: audit.wireLength,
    layoutWidth: Math.ceil(bounds.x + bounds.width) - Math.floor(bounds.x),
    layoutHeight: Math.ceil(bounds.y + bounds.height) - Math.floor(bounds.y),
    instanceWidth: instances.width,
    instanceHeight: instances.height,
    unsafeProblems: audit.unsafeProblems,
    floatingPins: floatingPins(document, resolver),
    missingConnections: missingConnections(document, resolver),
  };
};
const largestRatio = (items, key) => {
  const values = items.map((item) => item[key]).filter(Number.isFinite);
  return values.length ? Math.max(...values) : null;
};
function evaluateFile(file) {
  let section = "";
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
    const apply = (plan) =>
      plan.diagnostics.some((d) => d.severity === "error")
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
    // Measure ratios against this document's actual quick result, even when
    // no baseline file was supplied. Keep this reference run outside timing.
    const quickPlan = planAutoLayout(document, resolver);
    const quickTransaction = apply(quickPlan);
    measurement.quick =
      quickTransaction?.ok && quickTransaction.applied
        ? metrics(quickTransaction.document, resolver)
        : null;
    const start = performance.now();
    let plan;
    try {
      const curve = [];
      let evaluations = 0;
      plan = planAutoLayout(
        document,
        resolver,
        seconds
          ? {
              search: {
                seed,
                evaluations: 1_000_000_000,
                deadline: Date.now() + seconds * 1000,
                onProgress: (p) => {
                  evaluations = p.evaluations;
                  if (!curve.length || p.best < curve.at(-1).best)
                    curve.push({
                      ...p,
                      milliseconds: performance.now() - start,
                    });
                },
              },
            }
          : {},
      );
      measurement.evaluations = evaluations;
      measurement.bestScoreCurve = curve;
    } finally {
      measurement.milliseconds = performance.now() - start;
    }
    measurement.timing = planningTiming(plan);
    measurement.strategy = refinementMetrics(plan)?.strategy ?? null;
    measurement.candidates = refinementMetrics(plan)?.candidates ?? 0;
    measurement.diagnostics = [...plan.diagnostics];
    const transaction = apply(plan);
    measurement.diagnostics.push(...(transaction?.diagnostics ?? []));
    const completed = transaction?.ok && transaction.applied;
    const after = completed ? transaction.document : document;
    measurement.status = completed ? "completed" : "refused";
    if (completed) {
      measurement.result = metrics(after, resolver);
      const ratio = (value, reference) =>
        reference ? value / reference : value === 0 ? 1 : null;
      measurement.widthRatio = measurement.quick
        ? ratio(measurement.result.layoutWidth, measurement.quick.layoutWidth)
        : null;
      measurement.heightRatio = measurement.quick
        ? ratio(measurement.result.layoutHeight, measurement.quick.layoutHeight)
        : null;
      measurement.largestSpanRatio = measurement.quick
        ? Math.max(measurement.widthRatio, measurement.heightRatio)
        : null;
      measurement.instanceWidthRatio = measurement.quick
        ? ratio(
            measurement.result.instanceWidth,
            measurement.quick.instanceWidth,
          )
        : null;
      measurement.instanceHeightRatio = measurement.quick
        ? ratio(
            measurement.result.instanceHeight,
            measurement.quick.instanceHeight,
          )
        : null;
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
    section = `<section id="${escape(id)}"><h2>${escape(id)} (${split}, ${measurement.instances} instances)</h2><p>${measurement.status}; ${measurement.milliseconds.toFixed(1)} ms</p><pre>${escape(JSON.stringify(measurement, null, 2))}</pre><div class="pair"><figure><figcaption>Human</figcaption>${humanSvg}</figure><figure><figcaption>Auto (${measurement.status})</figcaption>${resultSvg}</figure></div></section>`;
  } catch (error) {
    measurement.status = "threw";
    measurement.error = String(error?.stack ?? error);
  }
  return { measurement, section };
}
if (!isMainThread) {
  parentPort.postMessage(evaluateFile(workerData.file));
} else {
  const files = readdirSync(folder)
    .filter((f) => f.endsWith(".json") && !f.endsWith(".meta.json"))
    .sort();
  const results = new Array(files.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(jobs, files.length) }, async () => {
      while (next < files.length) {
        const index = next++;
        results[index] = await new Promise((resolve, reject) => {
          const worker = new Worker(new URL(import.meta.url), {
            workerData: { file: files[index] },
            argv: process.argv.slice(2),
          });
          let result;
          worker.once("message", (message) => {
            result = message;
          });
          worker.once("error", reject);
          worker.once("exit", (code) => {
            if (code || !result)
              reject(new Error(`Evaluation worker exited ${code}`));
            else resolve(result);
          });
        });
        const m = results[index].measurement;
        console.log(
          `${m.id}: ${m.status}; ${m.instances} instances; ${m.milliseconds?.toFixed(1) ?? "—"} ms; ${m.evaluations ?? 0} search evaluations`,
        );
      }
    }),
  );
  for (const result of results) {
    measurements.push(result.measurement);
    sections.push(result.section);
  }
  const totals = [];
  const metricText = (m) =>
    m ? `${m.crossings}/${m.bends}/${Math.round(m.wireLength)}` : "—";
  const sum = (items) => ({
    ...Object.fromEntries(
      [
        "labelOverlaps",
        "labelClearance",
        "terminalDepartures",
        "missingConnections",
      ].map((key) => [
        key,
        items.every((m) => Number.isFinite(m[key]))
          ? items.reduce((sum, m) => sum + m[key], 0)
          : null,
      ]),
    ),
    crossings: items.reduce((s, m) => s + m.crossings, 0),
    bends: items.reduce((s, m) => s + m.bends, 0),
    wireLength: items.reduce((s, m) => s + m.wireLength, 0),
    layoutWidth: items.every((m) => Number.isFinite(m.layoutWidth))
      ? items.reduce((s, m) => s + m.layoutWidth, 0)
      : null,
    layoutHeight: items.every((m) => Number.isFinite(m.layoutHeight))
      ? items.reduce((s, m) => s + m.layoutHeight, 0)
      : null,
    floatingPins: items.every((m) => Array.isArray(m.floatingPins))
      ? items.reduce((s, m) => s + m.floatingPins.length, 0)
      : null,
  });
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
        strategy: m.strategy,
        human: metricText(m.human),
        ...(baseline
          ? {
              before: metricText(
                baseline.cases.find((b) => b.id === m.id)?.result,
              ),
            }
          : {}),
        after: metricText(m.result),
        humanReadability: m.human
          ? `${m.human.labelOverlaps}/${m.human.labelClearance}/${m.human.terminalDepartures}`
          : "—",
        resultReadability: m.result
          ? `${m.result.labelOverlaps}/${m.result.labelClearance}/${m.result.terminalDepartures}`
          : "—",
        humanFloating: m.human?.floatingPins.length ?? "—",
        resultFloating: m.result?.floatingPins.length ?? "—",
        humanMissing: m.human?.missingConnections ?? "—",
        resultMissing: m.result?.missingConnections ?? "—",
        ms: m.milliseconds?.toFixed(1),
        layoutWidth: m.result?.layoutWidth,
        layoutHeight: m.result?.layoutHeight,
        widthRatio: m.widthRatio,
        heightRatio: m.heightRatio,
        largestSpanRatio: m.largestSpanRatio,
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
          baseline.cases.some(
            (b) => b.id === m.id && b.status === "completed",
          )),
    );
    const total = {
      split,
      documents: cases.length,
      completed: cases.filter((m) => m.status === "completed").length,
      common: common.length,
      human: sum(common.map((m) => m.human)),
      before: baseline
        ? sum(
            common.map((m) => baseline.cases.find((b) => b.id === m.id).result),
          )
        : null,
      after: sum(common.map((m) => m.result)),
      allHuman: sum(cases.filter((m) => m.human).map((m) => m.human)),
      allCompleted: sum(cases.filter((m) => m.result).map((m) => m.result)),
      quick: sum(cases.filter((m) => m.quick).map((m) => m.quick)),
      largestWidthRatio: largestRatio(cases, "widthRatio"),
      largestHeightRatio: largestRatio(cases, "heightRatio"),
      largestInstanceWidthRatio: largestRatio(cases, "instanceWidthRatio"),
      largestInstanceHeightRatio: largestRatio(cases, "instanceHeightRatio"),
    };
    totals.push(total);
    console.log(JSON.stringify(total));
  }
  writeFileSync(
    `${output}/report.json`,
    JSON.stringify(
      {
        cases: measurements,
        totals,
        summary: {
          completed: measurements.filter((m) => m.result).length,
          result: sum(
            measurements.filter((m) => m.result).map((m) => m.result),
          ),
          quick: sum(measurements.filter((m) => m.quick).map((m) => m.quick)),
          largestWidthRatio: largestRatio(measurements, "widthRatio"),
          largestHeightRatio: largestRatio(measurements, "heightRatio"),
          largestSpanRatio: largestRatio(measurements, "largestSpanRatio"),
        },
      },
      null,
      2,
    ),
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
}
