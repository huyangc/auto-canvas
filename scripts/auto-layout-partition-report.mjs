import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { cachedSamples } from "./auto-layout-llm-partition.mjs";
import {
  reconcilePartition,
  partitionInvariantErrors,
} from "../packages/auto-layout/dist/partition-reconcile.js";
import { partitionMetrics } from "../packages/auto-layout/dist/partition-metrics.js";
import { partitionFromLoadbench } from "../packages/auto-layout/dist/partition-from-loadbench.js";
import { partitionBounds } from "../packages/auto-layout/dist/partition-geometry.js";
import { validatePartition } from "../packages/auto-layout/dist/partition.js";
import { isMarker } from "../packages/auto-layout/dist/placement-connectivity.js";
import { parseProject } from "../packages/project-protocol/dist/index.js";
import {
  builtInSymbols,
  createProjectSymbolResolver,
} from "../packages/symbols/dist/index.js";
import {
  buildSvgScene,
  renderDocumentSvg,
} from "../packages/render-svg/dist/index.js";

const [folder, ...args] = process.argv.slice(2);
if (!folder || (args.length && (args.length !== 2 || args[0] !== "--samples")))
  throw new Error(
    "Usage: auto-layout-partition-report.mjs <folder> [--samples k]",
  );
const samples = Number(args[1] ?? 3);
if (!Number.isSafeInteger(samples) || samples < 0)
  throw new Error("Invalid samples count");
const output = "tmp/auto-layout-partition";
mkdirSync(output, { recursive: true });
const escape = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
const cases = [],
  sections = [];
for (const file of readdirSync(folder)
  .filter((f) => f.endsWith(".json") && !f.endsWith(".meta.json"))
  .sort()) {
  const id = file.slice(0, -5);
  const split =
    BigInt(`0x${createHash("sha256").update(id).digest("hex")}`) % 3n === 0n
      ? "val"
      : "dev";
  try {
    const project = parseProject(readFileSync(join(folder, file), "utf8"));
    const document = project.documents.find(
      (d) => d.id === project.topDocumentId,
    );
    if (!document) throw new Error("Top Document missing");
    const resolver = createProjectSymbolResolver(project, builtInSymbols);
    const cached = cachedSamples(document, resolver, samples);
    const result = reconcilePartition(document, resolver, cached.samples);
    const validation = validatePartition(document, resolver, result.partition);
    const invariantErrors = partitionInvariantErrors(
      document,
      resolver,
      result.partition,
    );
    const plannerErrors = validation.diagnostics.filter(
      (d) => d.severity === "error",
    );
    if (invariantErrors.length || plannerErrors.length)
      throw new Error(JSON.stringify({ invariantErrors, plannerErrors }));
    const plannerMerges = validation.diagnostics.filter(
      (d) =>
        d.severity === "warning" &&
        /^L0 structure split .+; merged into .+$/.test(d.message),
    ).length;
    const xml = join(folder, `${id}.partitioning.xml`);
    const loadbench = existsSync(xml);
    const hasHuman =
      !loadbench &&
      document.instances.filter((i) => !isMarker(i)).every((i) => i.placement);
    // Keep the XML labels as the independent reference; do not merge L0 splits
    // into the answer being scored or manufacture labels for omitted devices.
    const reference = loadbench
      ? partitionFromLoadbench(document, readFileSync(xml, "utf8"))
      : result.partition;
    const measured = partitionMetrics(
      document,
      resolver,
      result.partition,
      reference,
    );
    const metrics = {
      ari: loadbench ? measured.ari : null,
      blockRecall: loadbench ? measured.blockRecall : null,
      roleMatch: loadbench ? measured.roleMatch : null,
      humanOverlap: hasHuman ? measured.humanOverlap : null,
    };
    const record = {
      id,
      split,
      status: "completed",
      devices: result.partition.blocks.reduce(
        (s, b) => s + b.members.length,
        0,
      ),
      hasHuman,
      loadbench,
      ...result,
      plannerMerges,
      plannerDiagnostics: validation.diagnostics,
      entries: cached.entries,
      metrics,
    };
    let drawing = "<p>No human drawing available.</p>";
    if (hasHuman) {
      const box = buildSvgScene(document, resolver).viewBox;
      const x = Math.floor(box.x),
        y = Math.floor(box.y);
      drawing = renderDocumentSvg(document, resolver, {
        bounds: {
          x,
          y,
          width: Math.ceil(box.x + box.width) - x,
          height: Math.ceil(box.y + box.height) - y,
        },
      });
      const overlays = partitionBounds(document, resolver, result.partition)
        .filter((b) => Number.isFinite(b.x))
        .map((b) => {
          const block = result.partition.blocks.find(
            (block) => block.id === b.id,
          );
          const color = {
            llm: "#7c3aed",
            attached: "#2563eb",
            rule: "#6b7280",
          }[block.provenance];
          return `<g fill="none" stroke="${color}"><rect x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}" stroke-dasharray="8 5"/><text x="${b.x + 3}" y="${b.y + 12}" fill="${color}" stroke="none" font-size="12">${escape(`${block.title} · ${block.role}`)}</text></g>`;
        })
        .join("");
      drawing = drawing.replace("</svg>", `${overlays}</svg>`);
    }
    cases.push(record);
    sections.push(
      `<section><h2>${escape(id)} (${split})</h2>${drawing}<pre>${escape(JSON.stringify(record, null, 2))}</pre></section>`,
    );
  } catch (error) {
    cases.push({ id, split, status: "failed", error: String(error) });
    sections.push(
      `<section><h2>${escape(id)}</h2><pre>${escape(String(error))}</pre></section>`,
    );
  }
}
const mean = (values) => {
  const finite = values.filter((v) => v !== null && Number.isFinite(v));
  return finite.length
    ? finite.reduce((a, b) => a + b, 0) / finite.length
    : null;
};
const totals = Object.fromEntries(
  ["dev", "val"].map((split) => {
    const all = cases.filter((c) => c.split === split),
      completed = all.filter((c) => c.status === "completed");
    const sumCounts = (field) =>
      Object.fromEntries(
        [
          ...new Set(
            completed.flatMap((c) => Object.keys(c.statistics[field])),
          ),
        ].map((key) => [
          key,
          completed.reduce((s, c) => s + c.statistics[field][key], 0),
        ]),
      );
    const devices = completed.reduce((s, c) => s + c.devices, 0);
    return [
      split,
      {
        documents: all.length,
        completed: completed.length,
        failed: all.length - completed.length,
        plannerMerges: completed.reduce((sum, c) => sum + c.plannerMerges, 0),
        ruleOnly: completed.filter((c) => c.statistics.ruleOnly).length,
        llmCoverage: devices
          ? completed.reduce(
              (s, c) => s + c.statistics.llmCoverage * c.devices,
              0,
            ) / devices
          : null,
        checks: sumCounts("checks"),
        blocksByProvenance: sumCounts("blocksByProvenance"),
        pairwiseSampleAri: mean(
          completed.flatMap((c) =>
            c.statistics.pairwiseSampleAri.map((p) => p.ari),
          ),
        ),
        consensusToSampleAri: mean(
          completed.flatMap((c) => c.statistics.consensusToSampleAri),
        ),
        ...Object.fromEntries(
          ["ari", "blockRecall", "roleMatch", "humanOverlap"].map((key) => [
            key,
            mean(completed.map((c) => c.metrics[key])),
          ]),
        ),
      },
    ];
  }),
);
writeFileSync(
  join(output, "report.json"),
  JSON.stringify(
    {
      samples,
      cases,
      totals,
      plannerMerges: cases.reduce((sum, c) => sum + (c.plannerMerges ?? 0), 0),
    },
    null,
    2,
  ),
);
writeFileSync(
  join(output, "index.html"),
  `<!doctype html><html><head><meta charset="utf-8"><title>Functional partitions</title><style>body{font:14px system-ui;margin:24px}svg{max-width:100%;height:auto}pre{white-space:pre-wrap}section{border-top:1px solid #ccc;margin-top:24px}</style></head><body><h1>Functional partitions</h1><p>Purple: LLM; blue: attached; grey: rule.</p><pre>${escape(JSON.stringify(totals, null, 2))}</pre>${sections.join("")}</body></html>`,
);
console.log(
  JSON.stringify({ documents: cases.length, totals, output }, null, 2),
);
if (cases.some((c) => c.status === "failed")) process.exitCode = 1;
