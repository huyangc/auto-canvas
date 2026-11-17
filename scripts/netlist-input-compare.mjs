#!/usr/bin/env node
/**
 * Netlist input against drawing input (T128): pairs the cases of a
 * netlist-input evaluation (`auto-layout-eval.mjs <netlist-input> --reference
 * <corpus>`) with a drawing-input evaluation of the same corpus by file id and
 * reports, per split, conversion coverage, planner outcome and the paired
 * human / drawing input / netlist input metrics.
 *
 *   node scripts/netlist-input-compare.mjs <netlist-report> <drawing-report>
 *
 * Writes `compare.json` beside the netlist report. Conversion coverage reads
 * the `<id>.meta.json` files of the netlist-input folder the report names.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";

const SPLITS = ["dev", "val", "all"];
const NET_KINDS = ["rail", "port", "signal"];
const SYMMETRY_KEYS = [
  "pairs",
  "mirrored",
  "level",
  "orientationMirrored",
  "axisDevices",
  "onAxis",
];

/** The evaluation's split: `sha256(id) % 3 == 0` is val. */
export const splitOf = (id) =>
  BigInt(`0x${createHash("sha256").update(id).digest("hex")}`) % 3n === 0n
    ? "val"
    : "dev";

const inSplit = (split) => (item) =>
  split === "all" || splitOf(item.id) === split;
const sum = (items, value) =>
  items.reduce((total, item) => total + (value(item) ?? 0), 0);
const tally = (values) => {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return Object.fromEntries(
    [...counts].sort(
      (a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])),
    ),
  );
};

const area = (m) => m.layoutWidth * m.layoutHeight;
export const aspect = (m) =>
  Math.max(m.layoutWidth, m.layoutHeight) /
  Math.max(1, Math.min(m.layoutWidth, m.layoutHeight));
/** Long and narrow: aspect at least 2. */
export const longNarrow = (m) => aspect(m) >= 2;
/** Long and narrow where the human drawing is not: also ≥ 1.5 × its aspect. */
export const longNarrowVsHuman = (m, human) =>
  longNarrow(m) && aspect(m) >= 1.5 * aspect(human);

const PAIRED_METRICS = {
  crossings: (m) => m.crossings,
  bends: (m) => m.bends,
  wire: (m) => m.wireLength,
  area,
  aspect,
};
const TOLERANCE = 1e-9;

// A pin as the conversion meta names it: `<device>.<PIN>`, the device by its
// lower-case name without the X prefix the export gives subcircuit calls.
const deviceKey = (instance, pinName) =>
  `${String(instance?.reference ?? instance?.id ?? "")
    .toLowerCase()
    .replace(/^x(?=[a-z])/u, "")}.${String(pinName).toUpperCase()}`;

/**
 * Every exit criterion of auto-layout-eval.mjs a case fails, by name, with
 * the pins it concerns where there are any.
 */
export function failingCriteria(m) {
  if (m.status === "threw") return [{ criterion: "threw", pins: [] }];
  if (m.status !== "completed") return [];
  const failures = [];
  if (!m.equivalent) failures.push({ criterion: "not-equivalent", pins: [] });
  if (m.result.unsafeProblems.length)
    failures.push({ criterion: "unsafe-routing", pins: [] });
  for (const key of [
    "danglingWires",
    "unconnectedPins",
    "touchingNotConnected",
  ])
    if (m.integrity.introduced[key].length)
      failures.push({
        criterion: `introduced-${key}`,
        pins: m.integrity.introduced[key].flatMap((f) =>
          f.instanceId
            ? [{ instanceId: f.instanceId, pinName: f.pinName }]
            : [],
        ),
      });
  const unexplained = m.result.floatingPins.filter(
    (pin) =>
      !m.diagnostics.some(
        (d) =>
          d.rule === "R14" &&
          d.severity === "warning" &&
          d.message.includes(`${pin.instanceId}.${pin.pinName}`),
      ),
  );
  if (unexplained.length)
    failures.push({ criterion: "floating-pin-without-R14", pins: unexplained });
  return failures;
}

/** "hidden supply or control pin made explicit" when every pin concerned is one. */
export function failureClass(failure, conversion, instances) {
  const explicit = new Set(conversion?.pinsNettedOnlyInImport ?? []);
  const byId = new Map(instances.map((i) => [i.id, i]));
  return failure.pins.length &&
    failure.pins.every((p) =>
      explicit.has(deviceKey(byId.get(p.instanceId), p.pinName)),
    )
    ? "hidden supply or control pin made explicit"
    : "other";
}

const coverage = (metas) => ({
  cases: metas.length,
  stage: tally(metas.map((m) => m.stage)),
  exportBlockedCodes: tally(
    metas
      .filter((m) => m.stage === "export-blocked")
      .flatMap((m) => m.errorCodes),
  ),
  importFailedCodes: tally(
    metas
      .filter((m) => m.stage === "import-failed")
      .flatMap((m) => m.errorCodes),
  ),
  converted: (() => {
    const converted = metas.filter((m) => m.stage === "converted");
    return {
      electricalGraph: tally(converted.map((m) => m.electricalGraph)),
      reexport: tally(converted.map((m) => m.reexport)),
      groundClaim: converted.filter((m) => m.import.groundClaim).length,
      supplyNamedTerminal: converted.filter((m) => m.import.supplyTerminals)
        .length,
      groundNamedTerminal: converted.filter((m) => m.import.groundTerminals)
        .length,
      hiddenPinsExplicit: converted.filter((m) => m.import.hiddenPinsExplicit)
        .length,
    };
  })(),
});

const planner = (cases) => {
  const completed = cases.filter((m) => m.status === "completed");
  return {
    cases: cases.length,
    status: tally(cases.map((m) => m.status)),
    equivalent: completed.filter((m) => m.equivalent === true).length,
    casesWithFloatingPins: completed.filter((m) => m.result.floatingPins.length)
      .length,
    floatingPins: sum(completed, (m) => m.result.floatingPins.length),
    casesWithMissingConnections: completed.filter(
      (m) => m.result.missingConnections,
    ).length,
    missingConnections: sum(completed, (m) => m.result.missingConnections),
    // Cases per warning code.
    warningCodes: tally(
      completed.flatMap((m) => [
        ...new Set(
          m.diagnostics
            .filter((d) => d.severity === "warning")
            .map((d) => d.code),
        ),
      ]),
    ),
    // R14 unrouted Nets whose explicit pin is hidden: cases and pin names.
    hiddenPinWarnings: (() => {
      const pins = completed.map((m) =>
        m.diagnostics
          .filter(
            (d) =>
              d.code === "AUTO_LAYOUT_NET_UNROUTED" &&
              /pin is not visible/u.test(d.message),
          )
          .flatMap((d) =>
            [...d.message.matchAll(/not visible: ([^;]+);/gu)].map((x) =>
              x[1].split(".").pop(),
            ),
          ),
      );
      return {
        cases: pins.filter((list) => list.length).length,
        warnings: sum(pins, (list) => list.length),
        pinNames: tally(pins.flat()),
      };
    })(),
  };
};

const sides = (pair) => ({
  human: pair.drawing.human,
  drawing: pair.drawing.result,
  netlist: pair.netlist.result,
});

const pairedTable = (pairs) => {
  const rows = {};
  for (const [name, value] of Object.entries(PAIRED_METRICS)) {
    const diffs = pairs.map(
      (p) => value(p.netlist.result) - value(p.drawing.result),
    );
    const total = (side) => sum(pairs, (p) => value(sides(p)[side]));
    rows[name] = {
      // Aspect is a mean, the others are totals.
      ...Object.fromEntries(
        ["human", "drawing", "netlist"].map((side) => [
          side,
          name === "aspect" && pairs.length
            ? total(side) / pairs.length
            : total(side),
        ]),
      ),
      netlistVsDrawing: {
        better: diffs.filter((d) => d < -TOLERANCE).length,
        equal: diffs.filter((d) => Math.abs(d) <= TOLERANCE).length,
        worse: diffs.filter((d) => d > TOLERANCE).length,
      },
    };
  }
  const count = (test) =>
    Object.fromEntries(
      ["human", "drawing", "netlist"].map((side) => [
        side,
        pairs.filter((p) => test(sides(p)[side], p.drawing.human)).length,
      ]),
    );
  rows.longNarrow = count((m) => longNarrow(m));
  rows.longNarrowVsHuman = count((m, human) => longNarrowVsHuman(m, human));
  return rows;
};

// A drawing report from before T128 has no netKindDetail: those totals are null.
const detailTotal = (pairs, side, value) =>
  pairs.every((p) => sides(p)[side].netKindDetail)
    ? sum(pairs, (p) => value(sides(p)[side].netKindDetail))
    : null;

const byNetKind = (pairs) =>
  Object.fromEntries(
    ["human", "drawing", "netlist"].map((side) => [
      side,
      {
        wire: Object.fromEntries(
          NET_KINDS.map((k) => [
            k,
            sum(
              pairs,
              (p) => sides(p)[side].netBreakdown.wireLengthByNetKind[k],
            ),
          ]),
        ),
        bends: Object.fromEntries(
          NET_KINDS.map((k) => [
            k,
            detailTotal(pairs, side, (d) => d.bendsByNetKind[k]),
          ]),
        ),
        crossingsByKindPair: Object.fromEntries(
          Object.keys(
            pairs[0]?.drawing.result.netBreakdown.crossingsByKindPair ?? {},
          ).map((k) => [
            k,
            sum(
              pairs,
              (p) => sides(p)[side].netBreakdown.crossingsByKindPair[k],
            ),
          ]),
        ),
        railCrossings: detailTotal(pairs, side, (d) => d.railCrossings),
      },
    ]),
  );

const readabilityTotals = (pairs) =>
  Object.fromEntries(
    ["human", "drawing", "netlist"].map((side) => [
      side,
      {
        ...Object.fromEntries(
          ["symmetry", "symmetryStage"].map((metric) => [
            metric,
            Object.fromEntries(
              SYMMETRY_KEYS.map((key) => [
                key,
                sum(pairs, (p) => sides(p)[side][metric]?.[key]),
              ]),
            ),
          ]),
        ),
        ...Object.fromEntries(
          ["signalDirection", "netlistSymmetry"].map((metric) => [
            metric,
            {
              violations: sum(
                pairs,
                (p) => sides(p)[side].readabilityMetrics?.[metric]?.violations,
              ),
              opportunities: sum(
                pairs,
                (p) =>
                  sides(p)[side].readabilityMetrics?.[metric]?.opportunities,
              ),
            },
          ]),
        ),
      },
    ]),
  );

const CONVERSION_GROUPS = {
  "drawing has more than one ground marker": (c) => c.source.ground > 1,
  "drawing has a supply marker": (c) => c.source.supply > 0,
  "drawing has label-joined Nets": (c) => c.source.labelJoinedNets > 0,
  "hidden pins made explicit": (c) => c.import.hiddenPinsExplicit > 0,
  "drawing has pin contacts": (c) => c.source.pinContacts > 0,
};

const conversionBreakdown = (pairs) => {
  const groups = {
    ...CONVERSION_GROUPS,
    "none of these": (c) =>
      Object.values(CONVERSION_GROUPS).every((test) => !test(c)),
  };
  return Object.fromEntries(
    Object.entries(groups).map(([name, test]) => {
      const members = pairs.filter(
        (p) => p.netlist.conversion && test(p.netlist.conversion),
      );
      const bends = members.map(
        (p) => p.netlist.result.bends - p.drawing.result.bends,
      );
      return [
        name,
        {
          cases: members.length,
          ...Object.fromEntries(
            ["crossings", "bends", "wireLength"].map((key) => [
              key,
              Object.fromEntries(
                ["human", "drawing", "netlist"].map((side) => [
                  side,
                  sum(members, (p) => sides(p)[side][key]),
                ]),
              ),
            ]),
          ),
          bendsNetlistVsDrawing: {
            better: bends.filter((d) => d < 0).length,
            equal: bends.filter((d) => d === 0).length,
            worse: bends.filter((d) => d > 0).length,
          },
        },
      ];
    }),
  );
};

const failures = (cases, instancesById) => {
  const list = cases.flatMap((m) =>
    failingCriteria(m).map((failure) => ({
      id: m.id,
      criterion: failure.criterion,
      class: failureClass(failure, m.conversion, instancesById.get(m.id) ?? []),
    })),
  );
  return {
    cases: new Set(list.map((f) => f.id)).size,
    byCriterionAndClass: tally(list.map((f) => `${f.criterion}: ${f.class}`)),
    list,
  };
};

const NOT_COMPARABLE = {
  labelOverlaps:
    "the netlist input has the importer's default labels, not the drawing's label set",
  labelClearance: "same reason as label overlap: different label sets",
  labelOwnership:
    "the netlist input draws no Net or power labels, so there is nothing to own",
  drafting: "drafting objects do not survive a netlist",
  railMarkers:
    "the netlist input has no rail markers; the reference's counts are in railMarkersReference",
  sourceDefects: "measured against the netlist-input Document, not the drawing",
  refusalStatus:
    "a refusal on a drawing (for example drafting frames, R161) has no netlist counterpart",
};

/**
 * The comparison object. `instancesById` maps a netlist case id to its input
 * Document's instances (to name a failing pin by device); optional.
 */
export function compareReports(
  netlistReport,
  drawingReport,
  metas,
  instancesById = new Map(),
) {
  const drawing = new Map(drawingReport.cases.map((m) => [m.id, m]));
  const netlistCases = netlistReport.cases;
  const pairs = netlistCases
    .filter((m) => m.status === "completed" && m.result)
    .flatMap((m) => {
      const other = drawing.get(m.id);
      return other?.status === "completed" && other.human
        ? [{ id: m.id, netlist: m, drawing: other }]
        : [];
    });
  return {
    netlistReport: netlistReport.netlistInput ?? null,
    splits: Object.fromEntries(
      SPLITS.map((split) => {
        const own = pairs.filter(inSplit(split));
        const cases = netlistCases.filter(inSplit(split));
        return [
          split,
          {
            coverage: coverage(metas.filter(inSplit(split))),
            planner: planner(cases),
            paired: {
              pairs: own.length,
              drawingCompletedNetlistNot: drawingReport.cases
                .filter(inSplit(split))
                .filter(
                  (d) =>
                    d.status === "completed" &&
                    cases.some(
                      (m) => m.id === d.id && m.status !== "completed",
                    ),
                ).length,
              netlistCompletedDrawingNot: cases.filter(
                (m) =>
                  m.status === "completed" &&
                  drawing.get(m.id)?.status !== "completed",
              ).length,
              table: pairedTable(own),
              byNetKind: byNetKind(own),
              readability: readabilityTotals(own),
              conversion: conversionBreakdown(own),
            },
            failures: failures(cases, instancesById),
          },
        ];
      }),
    ),
    notComparable: NOT_COMPARABLE,
  };
}

const number = (value) =>
  value === null || value === undefined
    ? "n/a"
    : Number.isInteger(value)
      ? String(value)
      : value.toFixed(2);

/** The printed comparison. */
export function formatComparison(comparison) {
  const lines = [];
  const line = (...parts) => lines.push(parts.join(" "));
  for (const [split, s] of Object.entries(comparison.splits)) {
    line(`== ${split}`);
    line("coverage:", JSON.stringify(s.coverage));
    line("planner:", JSON.stringify(s.planner));
    const p = s.paired;
    line(
      `pairs ${p.pairs}; drawing completed, netlist not: ${p.drawingCompletedNetlistNot}; netlist completed, drawing not: ${p.netlistCompletedDrawingNot}`,
    );
    line(
      "metric".padEnd(18),
      "human".padStart(12),
      "drawing-in".padStart(12),
      "netlist-in".padStart(12),
      "netlist vs drawing b/e/w".padStart(26),
    );
    for (const [name, row] of Object.entries(p.table))
      line(
        name.padEnd(18),
        number(row.human).padStart(12),
        number(row.drawing).padStart(12),
        number(row.netlist).padStart(12),
        (row.netlistVsDrawing
          ? `${row.netlistVsDrawing.better}/${row.netlistVsDrawing.equal}/${row.netlistVsDrawing.worse}`
          : ""
        ).padStart(26),
      );
    for (const [side, kinds] of Object.entries(p.byNetKind))
      line(
        `${side}: wire rail/port/signal ${NET_KINDS.map((k) => number(kinds.wire[k])).join("/")}; bends ${NET_KINDS.map((k) => number(kinds.bends[k])).join("/")}; crossings involving a rail ${number(kinds.railCrossings)}; crossings by kind pair ${JSON.stringify(kinds.crossingsByKindPair)}`,
      );
    line("readability:", JSON.stringify(p.readability));
    for (const [group, g] of Object.entries(p.conversion))
      line(
        `${group}: n ${g.cases}; crossings h/d/n ${g.crossings.human}/${g.crossings.drawing}/${g.crossings.netlist}; bends ${g.bends.human}/${g.bends.drawing}/${g.bends.netlist}; wire ${number(g.wireLength.human)}/${number(g.wireLength.drawing)}/${number(g.wireLength.netlist)}; bends netlist vs drawing b/e/w ${g.bendsNetlistVsDrawing.better}/${g.bendsNetlistVsDrawing.equal}/${g.bendsNetlistVsDrawing.worse}`,
      );
    line(
      `failing cases ${s.failures.cases}:`,
      JSON.stringify(s.failures.byCriterionAndClass),
    );
    line("");
  }
  line("not comparable:");
  for (const [metric, reason] of Object.entries(comparison.notComparable))
    line(`  ${metric}: ${reason}`);
  return lines.join("\n");
}

function readMetas(folder) {
  return readdirSync(folder)
    .filter((f) => f.endsWith(".meta.json"))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(folder, f), "utf8")));
}

/** Input instances of each case, to name a failing pin by its device. */
function readInstances(folder, cases) {
  const instances = new Map();
  for (const m of cases) {
    if (!failingCriteria(m).length) continue;
    const file = join(folder, `${m.id}.json`);
    if (!existsSync(file)) continue;
    const project = JSON.parse(readFileSync(file, "utf8"));
    instances.set(
      m.id,
      project.documents.find((d) => d.id === project.topDocumentId)
        ?.instances ?? [],
    );
  }
  return instances;
}

function main() {
  const [netlistPath, drawingPath, ...rest] = process.argv.slice(2);
  if (!netlistPath || !drawingPath || rest.length)
    throw new Error(
      "Usage: netlist-input-compare.mjs <netlist-report> <drawing-report>",
    );
  const netlistReport = JSON.parse(readFileSync(netlistPath, "utf8"));
  const drawingReport = JSON.parse(readFileSync(drawingPath, "utf8"));
  const folder = netlistReport.netlistInput?.folder;
  if (!folder)
    throw new Error(
      `${netlistPath} is not a netlist-input evaluation (run it with --reference)`,
    );
  const comparison = compareReports(
    netlistReport,
    drawingReport,
    readMetas(folder),
    readInstances(folder, netlistReport.cases),
  );
  const out = join(dirname(resolve(netlistPath)), "compare.json");
  writeFileSync(out, `${JSON.stringify(comparison, null, 2)}\n`);
  console.log(formatComparison(comparison));
  console.log(`Wrote ${out}`);
}

if (
  process.argv[1] &&
  existsSync(process.argv[1]) &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  main();
