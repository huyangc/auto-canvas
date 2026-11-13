import {
  diagnoseVisualQuality,
  diagnoseLabelClearance,
} from "../packages/derived/dist/index.js";
import { branchVerticality } from "../packages/auto-layout/dist/branch-verticality.js";
import { stageComponents } from "../packages/auto-layout/dist/stage-symmetry.js";
import { reconcilePartition } from "../packages/auto-layout/dist/partition-reconcile.js";
import { partitionMetrics } from "../packages/auto-layout/dist/partition-metrics.js";
import {
  cachedSamples,
  createPartitioner,
} from "./auto-layout-llm-partition.mjs";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import {
  isMainThread,
  parentPort,
  Worker,
  workerData,
} from "node:worker_threads";
import {
  detectSymmetry,
  symmetryCounts,
} from "../packages/auto-layout/dist/symmetry.js";
import { classifyNets } from "../packages/auto-layout/dist/net-roles.js";
import { isMarker } from "../packages/auto-layout/dist/placement-connectivity.js";
import { partitionFromPlacement } from "../packages/auto-layout/dist/partition-from-placement.js";
import { partitionFromLoadbench } from "../packages/auto-layout/dist/partition-from-loadbench.js";
import {
  partitionSymmetry,
  validatePartition,
} from "../packages/auto-layout/dist/partition.js";
import {
  blockIntrusion,
  partitionBounds,
} from "../packages/auto-layout/dist/partition-geometry.js";
import {
  defaultLayoutSearch,
  llmPartition,
  planAutoLayout,
} from "../packages/auto-layout/dist/index.js";
import {
  auditRouting,
  floatingPins,
  missingConnections,
} from "../packages/auto-layout/dist/routing-audit.js";
import { terminalPartition } from "../packages/auto-layout/dist/transaction.js";
import { enclosingBox } from "../packages/auto-layout/dist/geometry.js";
import { readabilityCounts } from "../packages/auto-layout/dist/readability.js";
import { planningTiming } from "../packages/auto-layout/dist/timing.js";
import {
  refinementMetrics,
  routedScore,
} from "../packages/auto-layout/dist/refine.js";
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
    ["--quick", "--fixed-human", "--anonymize", "--optimized"].includes(args[i])
  ) {
    flags.set(args[i], true);
    i--;
    continue;
  }
  if (
    ![
      "--samples",
      "--block-boxes",
      "--baseline",
      "--search",
      "--seed",
      "--jobs",
      "--partition",
      "--variant",
      "--threshold",
      "--split",
    ].includes(args[i]) ||
    args[i + 1] === undefined
  )
    throw new Error(
      "Usage: auto-layout-eval.mjs <folder> [--baseline <report.json>] [--quick | --search <seconds>] [--seed <n>] [--jobs <n>] [--partition human|loadbench|llm --variant v1|v2] [--fixed-human] [--optimized] [--threshold <n>] [--split dev|val] [--samples k] [--anonymize] [--block-boxes on|off]",
    );
  flags.set(args[i], args[i + 1]);
}
if (!folder) throw new Error("A document folder is required");
const seconds = Number(flags.get("--search") ?? 0);
const seed = Number(flags.get("--seed") ?? 1);
const jobs = Number(flags.get("--jobs") ?? 1);
if (
  (flags.has("--quick") && flags.has("--search")) ||
  !Number.isFinite(seconds) ||
  seconds < 0 ||
  !Number.isFinite(seed) ||
  !Number.isSafeInteger(jobs) ||
  jobs < 1
)
  throw new Error("Invalid search duration, seed or worker count");
const partitionSource = flags.get("--partition");
const variant = flags.get("--variant") ?? "v1";
const threshold = Number(flags.get("--threshold") ?? 3);
const samples = Number(flags.get("--samples") ?? 3);
const anonymize = flags.has("--anonymize");
const blockBoxes = flags.get("--block-boxes") ?? "on";
const fixedHuman = flags.has("--fixed-human");
if (
  !Number.isSafeInteger(samples) ||
  samples < 0 ||
  !["on", "off"].includes(blockBoxes) ||
  ((flags.has("--samples") || anonymize) && partitionSource !== "llm") ||
  (partitionSource &&
    !["human", "loadbench", "llm"].includes(partitionSource)) ||
  !["v1", "v2"].includes(variant) ||
  (flags.has("--variant") && !partitionSource) ||
  (fixedHuman && (partitionSource || seconds)) ||
  !(threshold > 0 && Number.isFinite(threshold)) ||
  (flags.has("--split") && !["dev", "val"].includes(flags.get("--split")))
)
  throw new Error(
    "Invalid partition, variant, threshold, split or quick-mode combination",
  );
if (partitionSource === "llm" && variant === "v2")
  throw new Error("LLM partitions have no floorplan; use v1");
if (partitionSource === "loadbench" && variant === "v2")
  throw new Error("LOADBench has no oracle arrangement; use v1");
const baseline = flags.has("--baseline")
  ? JSON.parse(readFileSync(flags.get("--baseline"), "utf8"))
  : undefined;
const output =
  partitionSource || fixedHuman
    ? `tmp/auto-layout-eval/${fixedHuman ? "v3" : `${variant}-${partitionSource}-${threshold}${partitionSource === "llm" ? `-samples-${samples}${anonymize ? "-anon" : ""}` : ""}`}`
    : "tmp/auto-layout-eval";
mkdirSync(output, { recursive: true });
const escape = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
const measurements = [];
const sections = [];
// Include zero totals, including diagnostics absent from the entire corpus.
const visualCodes = [
  "VISUAL_AMBIGUOUS_JUNCTION",
  "VISUAL_CONSTRAINT_VIOLATION",
  "VISUAL_LABEL_CLEARANCE",
  "VISUAL_LABEL_OVERLAP",
  "VISUAL_LABEL_OWNER_DISTANCE",
  "VISUAL_LABEL_RUN_ON",
  "VISUAL_OUTSIDE_PAGE",
  "VISUAL_ROUTE_OVERLAP",
  "VISUAL_SHORT_SEGMENT",
  "VISUAL_SYMBOL_OVERLAP",
  "VISUAL_TERMINAL_DEPARTURE",
  "VISUAL_TERMINAL_ON_FOREIGN_ROUTE",
  "VISUAL_UNPLACED_INSTANCE",
  "VISUAL_UNRESOLVED_SYMBOL",
  "VISUAL_WIRE_THROUGH_SYMBOL",
];
function visualCounts(document, resolver) {
  const counts = Object.fromEntries(visualCodes.map((code) => [code, 0]));
  for (const diagnostic of [
    ...diagnoseVisualQuality(document, resolver),
    ...diagnoseLabelClearance(document, resolver),
  ]) {
    if (diagnostic.code.startsWith("VISUAL_"))
      counts[diagnostic.code] = (counts[diagnostic.code] ?? 0) + 1;
  }
  return counts;
}
const netKinds = ["rail", "port", "signal"];
const crossingKindPairs = netKinds.flatMap((kind, index) =>
  netKinds.slice(index).map((other) => [kind, other].sort().join("-")),
);
const portHostCounts = ["noHost", "singleHost", "multiHost"];
function netBreakdown(document, resolver) {
  const { rails } = classifyNets(document, resolver);
  const instances = new Map(document.instances.map((i) => [i.id, i]));
  const ports = new Map();
  for (const net of document.nets) {
    const terminals = net.terminals ?? [];
    if (
      !terminals.some((t) =>
        ["port", "port-filled"].includes(instances.get(t.instanceId)?.symbolId),
      )
    )
      continue;
    // Count device pins, not distinct devices or port markers. Keep zero-host
    // nets explicit so the host buckets always sum to the port-kind length.
    const hosts = new Set(
      terminals
        .filter((t) => {
          const instance = instances.get(t.instanceId);
          return instance && !isMarker(instance);
        })
        .map((t) => JSON.stringify([t.instanceId, t.pinName])),
    ).size;
    ports.set(net.id, hosts);
  }
  // Rail takes precedence when a rail also has a port terminal.
  const kind = (netId) =>
    rails.has(netId) ? "rail" : ports.has(netId) ? "port" : "signal";
  const routesByNet = new Map();
  for (const route of document.routes) {
    const routes = routesByNet.get(route.netId) ?? [];
    routes.push(route);
    routesByNet.set(route.netId, routes);
  }
  const wireLengthByNetKind = Object.fromEntries(netKinds.map((k) => [k, 0]));
  const crossingsByKindPair = Object.fromEntries(
    crossingKindPairs.map((k) => [k, 0]),
  );
  const portWireLengthByHostCount = Object.fromEntries(
    portHostCounts.map((k) => [k, 0]),
  );
  const nets = [...routesByNet];
  for (const [index, [netId, routes]] of nets.entries()) {
    const { wireLength } = auditRouting({ ...document, routes }, resolver);
    wireLengthByNetKind[kind(netId)] += wireLength;
    if (kind(netId) === "port") {
      const hosts = ports.get(netId);
      portWireLengthByHostCount[
        hosts === 0 ? "noHost" : hosts === 1 ? "singleHost" : "multiHost"
      ] += wireLength;
    }
    for (const [otherId, otherRoutes] of nets.slice(index + 1)) {
      // Reuse the audit's proper-crossing and point-deduplication rules across
      // all routes of each unordered Net pair. A multi-Net intersection can
      // contribute to multiple pairs; the primary audit counts its point once.
      const { crossings } = auditRouting(
        { ...document, routes: [...routes, ...otherRoutes] },
        resolver,
      );
      crossingsByKindPair[[kind(netId), kind(otherId)].sort().join("-")] +=
        crossings;
    }
  }
  return {
    wireLengthByNetKind,
    crossingsByKindPair,
    portWireLengthByHostCount,
  };
}
const metrics = (document, resolver, components, stages) => {
  const audit = auditRouting(document, resolver);
  const bounds = buildSvgScene(document, resolver).viewBox;
  const instances = enclosingBox(document, resolver);
  return {
    ...readabilityCounts(document, resolver),
    visual: visualCounts(document, resolver),
    netBreakdown: netBreakdown(document, resolver),
    branchVerticality: branchVerticality(document, resolver),
    legacyScore: routedScore(
      { final: document, result: { diagnostics: [] } },
      resolver,
    ),
    symmetry: symmetryCounts(document, resolver, components),
    symmetryStage: symmetryCounts(document, resolver, stages),
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
const median = (values) => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
};
const largestRatio = (items, key) => {
  const values = items.map((item) => item[key]).filter(Number.isFinite);
  return values.length ? Math.max(...values) : null;
};
function blockMetrics(document, resolver, partition, human) {
  if (!partition)
    return {
      blockIntrusion: null,
      blockOverlap: null,
      arrangementAgreement: null,
      arrangementMatches: 0,
      arrangementRelations: 0,
    };
  const boxes = partitionBounds(document, resolver, partition);
  let overlap = 0,
    matches = 0,
    relations = 0;
  const centres = (d) =>
    Object.fromEntries(
      partition.blocks.map((b) => {
        const points = d.instances
          .filter((i) => b.members.includes(i.id))
          .map((i) => i.placement?.position);
        return [
          b.id,
          points.every(Boolean)
            ? {
                x: points.reduce((s, p) => s + p.x, 0) / points.length,
                y: points.reduce((s, p) => s + p.y, 0) / points.length,
              }
            : null,
        ];
      }),
    );
  const actual = centres(document),
    reference = human ? centres(human) : {};
  for (let i = 0; i < boxes.length; i++)
    for (const b of boxes.slice(i + 1)) {
      const a = boxes[i];
      overlap +=
        Math.max(
          0,
          Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x),
        ) *
        Math.max(
          0,
          Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y),
        );
      if (reference[a.id] && reference[b.id]) {
        const axes = ["x", "y"].filter(
          (axis) => reference[a.id][axis] !== reference[b.id][axis],
        );
        // A pair agrees only when both non-tied human directions agree.
        if (!axes.length) continue;
        relations++;
        if (
          axes.every(
            (axis) =>
              Math.sign(actual[a.id][axis] - actual[b.id][axis]) ===
              Math.sign(reference[a.id][axis] - reference[b.id][axis]),
          )
        )
          matches++;
      }
    }
  return {
    blockIntrusion: blockIntrusion(document, resolver, partition),
    blockOverlap: overlap,
    arrangementAgreement: relations ? matches / relations : null,
    arrangementMatches: matches,
    arrangementRelations: relations,
  };
}
async function evaluateFile(file) {
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
    const roles = classifyNets(document, resolver);
    const components = detectSymmetry(document, resolver, roles);
    const stages = stageComponents(document, resolver, roles, components);
    measurement.instances = document.instances.length;
    // Oracle extraction is required only for partitioned runs. Default and
    // search evaluations proceed without block metrics when it fails, for
    // example on a document with unplaced devices.
    let partition;
    let partitionDiagnostics = [];
    // An LLM run uses the reference only for comparison metrics: LOADBench
    // labels when the folder has them, otherwise the human-drawing oracle.
    const loadbenchXml = join(folder, `${id}.partitioning.xml`);
    const loadbenchReference =
      partitionSource === "loadbench" ||
      (partitionSource === "llm" && existsSync(loadbenchXml));
    // A LOADBench document's positions come from the importer, not a person:
    // never report them as a human drawing or measure arrangement against them.
    const hasHuman = !loadbenchReference;
    try {
      const oracle = loadbenchReference
        ? partitionFromLoadbench(document, readFileSync(loadbenchXml, "utf8"))
        : partitionFromPlacement(document, resolver, threshold);
      const validated = validatePartition(document, resolver, oracle);
      partitionDiagnostics = validated.diagnostics;
      if (validated.diagnostics.some((d) => d.severity === "error"))
        throw new Error(JSON.stringify(validated.diagnostics));
      partition = validated.partition;
    } catch (error) {
      if (partitionSource && partitionSource !== "llm") throw error;
      partitionDiagnostics = [
        {
          severity: "warning",
          code: "ORACLE_UNAVAILABLE",
          message: String(error),
        },
      ];
    }
    if (partitionSource === "llm") {
      const cached = cachedSamples(document, resolver, samples, anonymize);
      const proposed = await llmPartition(document, resolver, {
        partitioner: createPartitioner(),
        samples,
        anonymize,
      });
      const validated = proposed.partition
        ? proposed
        : reconcilePartition(document, resolver, []);
      measurement.partitionValidity = {
        status: proposed.partition ? "reconciled" : "rule-only",
        l0Merges: 0,
        entries: cached.entries,
      };
      measurement.partitionStatistics = validated.statistics;
      partitionDiagnostics.push(...validated.diagnostics);
      // Without a reference (e.g. unplaced devices), the layout still runs.
      measurement.partitionMetrics = partition
        ? partitionMetrics(document, resolver, validated.partition, partition)
        : null;
      // Position-based metrics need a human drawing; ARI only needs the reference.
      if (measurement.partitionMetrics && !hasHuman)
        Object.assign(measurement.partitionMetrics, {
          humanOverlap: null,
          floorplanAgreement: null,
          floorplanMatches: null,
          floorplanRelations: null,
        });
      partition = validated.partition;
    } else if (partitionSource === "human") {
      measurement.partitionMetrics = partitionMetrics(
        document,
        resolver,
        partition,
        partition,
      );
    }
    measurement.partition = partition;
    measurement.partitionDiagnostics = partitionDiagnostics;
    measurement.hasHuman = hasHuman;
    measurement.human = hasHuman
      ? {
          ...metrics(document, resolver, components, stages),
          ...blockMetrics(
            document,
            resolver,
            partition,
            hasHuman ? document : null,
          ),
          equivalent: true,
          milliseconds: 0,
          status: "original",
        }
      : null;
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
    const quickPlan = planAutoLayout(document, resolver, {
      search: { seed, evaluations: 0 },
    });
    const quickTransaction = apply(quickPlan);
    measurement.quick =
      quickTransaction?.ok && quickTransaction.applied
        ? {
            ...metrics(quickTransaction.document, resolver, components, stages),
            ...blockMetrics(
              quickTransaction.document,
              resolver,
              partition,
              hasHuman ? document : null,
            ),
          }
        : null;
    const layoutOptions = fixedHuman
      ? { fixedInstanceIds: new Set(document.instances.map((i) => i.id)) }
      : partitionSource
        ? {
            partition:
              variant === "v2"
                ? partition
                : {
                    blocks: partition.blocks,
                    ...(partition.flow ? { flow: partition.flow } : {}),
                  },
          }
        : {};
    const start = performance.now();
    let plan;
    try {
      const curve = [];
      let evaluations = 0;
      const quickMode =
        fixedHuman ||
        flags.has("--quick") ||
        (flags.has("--search") && !seconds);
      const budget = seconds
        ? 1_000_000_000
        : quickMode
          ? 0
          : defaultLayoutSearch(document, layoutOptions).evaluations;
      measurement.searchMode = seconds
        ? "deadline"
        : quickMode
          ? "quick"
          : "bounded";
      measurement.evaluationBudget = budget;
      plan = planAutoLayout(document, resolver, {
        ...layoutOptions,
        ...(flags.has("--optimized") ? { quality: "optimized" } : {}),
        search: {
          seed,
          evaluations: budget,
          ...(seconds ? { deadline: Date.now() + seconds * 1000 } : {}),
          onProgress: (p) => {
            evaluations = p.evaluations;
            if (!curve.length || p.best < curve.at(-1).best)
              curve.push({ ...p, milliseconds: performance.now() - start });
          },
        },
      });
      measurement.evaluations = evaluations;
      measurement.bestScoreCurve = curve;
    } finally {
      measurement.milliseconds = performance.now() - start;
    }
    measurement.planHash = createHash("sha256")
      .update(JSON.stringify(plan))
      .digest("hex");
    measurement.timing = planningTiming(plan);
    measurement.strategy = refinementMetrics(plan)?.strategy ?? null;
    measurement.candidates = refinementMetrics(plan)?.candidates ?? 0;
    measurement.partitionFallback = plan.diagnostics.some(
      (d) => d.code === "AUTO_LAYOUT_PARTITION_FALLBACK",
    );
    measurement.diagnostics = [...plan.diagnostics];
    const transaction = apply(plan);
    measurement.diagnostics.push(...(transaction?.diagnostics ?? []));
    const completed = transaction?.ok && transaction.applied;
    const after = completed ? transaction.document : document;
    measurement.status = completed ? "completed" : "refused";
    if (!completed && baseline && !partitionSource && !fixedHuman && !seconds) {
      // Losing a layout the baseline had is a regression, not a skipped check.
      const before = baseline.cases.find((b) => b.id === id);
      if (before?.status === "completed") measurement.baselineEqual = false;
    }
    if (completed) {
      measurement.result = {
        ...metrics(after, resolver, components, stages),
        ...(partitionSource
          ? {
              blockSymmetry: symmetryCounts(
                after,
                resolver,
                partitionSymmetry(components, partition),
              ),
            }
          : {}),
        ...blockMetrics(after, resolver, partition, hasHuman ? document : null),
      };
      measurement.result.areaRatio =
        hasHuman &&
        measurement.human.layoutWidth * measurement.human.layoutHeight
          ? (measurement.result.layoutWidth * measurement.result.layoutHeight) /
            (measurement.human.layoutWidth * measurement.human.layoutHeight)
          : null;
      measurement.result.instanceAreaRatio =
        hasHuman &&
        measurement.human.instanceWidth * measurement.human.instanceHeight
          ? (measurement.result.instanceWidth *
              measurement.result.instanceHeight) /
            (measurement.human.instanceWidth * measurement.human.instanceHeight)
          : null;
      if (baseline && !partitionSource && !fixedHuman && !seconds) {
        const before = baseline.cases.find((b) => b.id === id);
        measurement.baselineEqual =
          before?.status === "completed" &&
          Object.entries(before.result).every(
            ([key, value]) =>
              JSON.stringify(measurement.result[key]) === JSON.stringify(value),
          ) &&
          (!before.planHash || before.planHash === measurement.planHash);
      }
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
      const svg = renderDocumentSvg(d, resolver, {
        bounds: {
          x,
          y,
          width: Math.ceil(box.x + box.width) - x,
          height: Math.ceil(box.y + box.height) - y,
        },
      });
      // No overlay when the oracle was unavailable, as blockMetrics does.
      if (!partition || blockBoxes === "off") return svg;
      const overlays = partitionBounds(d, resolver, partition)
        .filter((b) => Number.isFinite(b.x))
        .map((b) => {
          const block = partition.blocks.find((block) => block.id === b.id);
          const color =
            { llm: "#7c3aed", attached: "#2563eb", rule: "#6b7280" }[
              block?.provenance
            ] ?? "#7c3aed";
          return `<g stroke="${color}" fill="none"><rect x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}" stroke-dasharray="8 5"/><text x="${b.x + 3}" y="${b.y + 12}" stroke="none" fill="${color}" font-size="12">${escape([block?.title, b.role].filter(Boolean).join(" · ") || "unlabeled")}</text></g>`;
        })
        .join("");
      return svg.replace("</svg>", `${overlays}</svg>`);
    };
    const humanSvg = hasHuman ? render(document) : "",
      resultSvg = render(after);
    if (hasHuman) writeFileSync(`${output}/${id}-human.svg`, humanSvg);
    writeFileSync(`${output}/${id}-result.svg`, resultSvg);
    section = `<section id="${escape(id)}"><h2>${escape(id)} (${split}, ${measurement.instances} instances)</h2><p>${measurement.status}; ${measurement.milliseconds.toFixed(1)} ms</p><pre>${escape(JSON.stringify(measurement, null, 2))}</pre><div class="pair"><figure><figcaption>${hasHuman ? "Human" : "No human reference"}</figcaption>${humanSvg}</figure><figure><figcaption>Auto (${measurement.status})</figcaption>${resultSvg}</figure></div></section>`;
  } catch (error) {
    measurement.status = "threw";
    if (partitionSource === "llm")
      measurement.partitionValidity = {
        ...measurement.partitionValidity,
        status: "failed",
      };
    measurement.error = String(error?.stack ?? error);
  }
  return { measurement, section };
}
if (!isMainThread) {
  parentPort.postMessage(await evaluateFile(workerData.file));
} else {
  const files = readdirSync(folder)
    .filter((f) => f.endsWith(".json") && !f.endsWith(".meta.json"))
    .sort()
    .filter(
      (f) =>
        !flags.has("--split") ||
        (BigInt(
          `0x${createHash("sha256").update(f.slice(0, -5)).digest("hex")}`,
        ) %
          3n ===
        0n
          ? "val"
          : "dev") === flags.get("--split"),
    );
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
  const symmetryKeys = [
    "pairs",
    "mirrored",
    "level",
    "orientationMirrored",
    "axisDevices",
    "onAxis",
  ];
  const symmetryText = (m) =>
    m?.symmetry ? symmetryKeys.map((key) => m.symmetry[key]).join("/") : "—";
  const sum = (items) => ({
    ...Object.fromEntries(
      [
        "symmetry",
        "symmetryStage",
        ...(partitionSource ? ["blockSymmetry"] : []),
      ].map((metric) => [
        metric,
        Object.fromEntries(
          symmetryKeys.map((key) => [
            key,
            items.every((m) => Number.isFinite(m[metric]?.[key]))
              ? items.reduce((total, m) => total + m[metric][key], 0)
              : null,
          ]),
        ),
      ]),
    ),
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
    blockIntrusion: items.reduce((s, m) => s + (m.blockIntrusion ?? 0), 0),
    blockOverlap: items.reduce((s, m) => s + (m.blockOverlap ?? 0), 0),
    meanAreaRatio: items.filter((m) => Number.isFinite(m.areaRatio)).length
      ? items.reduce((s, m) => s + (m.areaRatio ?? 0), 0) /
        items.filter((m) => Number.isFinite(m.areaRatio)).length
      : null,
    medianAreaRatio: median(items.map((m) => m.areaRatio)),
    medianInstanceAreaRatio: median(items.map((m) => m.instanceAreaRatio)),
    arrangementAgreement: items.reduce(
      (s, m) => s + (m.arrangementRelations ?? 0),
      0,
    )
      ? items.reduce((s, m) => s + (m.arrangementMatches ?? 0), 0) /
        items.reduce((s, m) => s + (m.arrangementRelations ?? 0), 0)
      : null,
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
        humanSymmetry: symmetryText(m.human),
        resultSymmetry: symmetryText(m.result),
        humanSymmetryStage: symmetryText({ symmetry: m.human?.symmetryStage }),
        resultSymmetryStage: symmetryText({
          symmetry: m.result?.symmetryStage,
        }),
        ...(partitionSource
          ? {
              blockSymmetry: symmetryText({
                symmetry: m.result?.blockSymmetry,
              }),
              partitionFallback: m.partitionFallback,
            }
          : {}),
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
      partitionFallback: cases.filter((m) => m.partitionFallback).length,
      common: common.length,
      // Totals cover human drawings only; imported LOADBench layouts have none.
      human: common.some((m) => m.human)
        ? sum(common.filter((m) => m.human).map((m) => m.human))
        : null,
      before: baseline
        ? sum(
            common.map((m) => baseline.cases.find((b) => b.id === m.id).result),
          )
        : null,
      after: sum(common.map((m) => m.result)),
      allHuman: cases.some((m) => m.human)
        ? sum(cases.filter((m) => m.human).map((m) => m.human))
        : null,
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
  const scoreboard = Object.fromEntries(
    ["dev", "val", "all"].map((split) => {
      const cases = measurements.filter(
        (m) => split === "all" || m.split === split,
      );
      const completed = cases.filter((m) => m.status === "completed");
      const paired = completed.filter((m) => m.human);
      const keys = ["crossings", "bends", "wireLength"];
      const primary = Object.fromEntries(
        keys.map((key) => {
          const human = paired.reduce((s, m) => s + m.human[key], 0);
          const result = paired.reduce((s, m) => s + m.result[key], 0);
          return [
            key,
            {
              human,
              result,
              ratio: human ? result / human : result ? null : 1,
            },
          ];
        }),
      );
      const guards = (items) => ({
        visual: Object.fromEntries(
          [
            ...new Set([
              ...visualCodes,
              ...items.flatMap((m) => Object.keys(m.visual)),
            ]),
          ]
            .sort()
            .map((code) => [
              code,
              items.reduce((s, m) => s + (m.visual[code] ?? 0), 0),
            ]),
        ),
        floatingPins: items.reduce((s, m) => s + m.floatingPins.length, 0),
        missingConnections: items.reduce((s, m) => s + m.missingConnections, 0),
      });
      const breakdown = (side) =>
        Object.fromEntries(
          [
            ["wireLengthByNetKind", netKinds],
            ["crossingsByKindPair", crossingKindPairs],
            ["portWireLengthByHostCount", portHostCounts],
          ].map(([metric, buckets]) => [
            metric,
            Object.fromEntries(
              buckets.map((bucket) => [
                bucket,
                paired.reduce(
                  (sum, m) => sum + m[side].netBreakdown[metric][bucket],
                  0,
                ),
              ]),
            ),
          ]),
        );
      const verticality = (side) => {
        const connections = paired.reduce(
          (sum, m) => sum + m[side].branchVerticality.connections,
          0,
        );
        const vertical = paired.reduce(
          (sum, m) => sum + m[side].branchVerticality.vertical,
          0,
        );
        return {
          connections,
          vertical,
          share: connections ? vertical / connections : null,
        };
      };
      const times = cases
        .map((m) => m.milliseconds)
        .filter(Number.isFinite)
        .sort((a, b) => a - b);
      return [
        split,
        {
          documents: cases.length,
          completed: completed.length,
          paired: paired.length,
          nonEquivalent: completed.filter((m) => m.equivalent !== true).length,
          primary: {
            ...primary,
            medianAreaRatio: median(paired.map((m) => m.result.areaRatio)),
          },
          branchVerticality: {
            human: verticality("human"),
            result: verticality("result"),
          },
          // Like primary ratios, breakdowns compare the same completed pairs.
          netBreakdown: {
            human: breakdown("human"),
            result: breakdown("result"),
          },
          // Guard totals cover all available references/results, including unpaired cases.
          human: guards(cases.filter((m) => m.human).map((m) => m.human)),
          result: guards(completed.map((m) => m.result)),
          planningMilliseconds: {
            median: median(times),
            p95: times[Math.max(0, Math.ceil(times.length * 0.95) - 1)] ?? null,
          },
        },
      ];
    }),
  );
  console.log("Scoreboard:", JSON.stringify(scoreboard, null, 2));
  writeFileSync(
    `${output}/report.json`,
    JSON.stringify(
      {
        scoreboard,
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
        m.baselineEqual === false ||
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
