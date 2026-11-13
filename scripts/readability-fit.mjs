import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

const ratio = (result, human) => (human ? result / human : result ? null : 1);
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length
    ? (sorted[Math.floor((sorted.length - 1) / 2)] +
        sorted[Math.floor(sorted.length / 2)]) /
        2
    : null;
};
const discrimination = (differences) => {
  const n = differences.length;
  return {
    pairs: n,
    humanBetter: n ? differences.filter((d) => d > 1e-10).length / n : null,
    humanWorse: n ? differences.filter((d) => d < -1e-10).length / n : null,
    equal: n
      ? differences.filter((d) => Math.abs(d) <= 1e-10).length / n
      : null,
  };
};

/** Non-negative pairwise logistic regression, fitted exclusively on dev pairs.
 * Use dev RMS differences to put counts and continuous masses on equal scales.
 * Fixed iteration count/order and L2 regularization make the fit reproducible.
 */
export function fitReadability(cases) {
  const paired = cases.filter(
    (c) =>
      c.status === "completed" &&
      c.human?.readabilityMetrics &&
      c.result?.readabilityMetrics,
  );
  const dev = paired.filter((c) => c.split === "dev");
  const keys = Object.keys(paired[0]?.human.readabilityMetrics ?? {}).sort();
  const value = (c, side, key) => c[side].readabilityMetrics[key].violations;
  for (const c of paired)
    for (const side of ["human", "result"])
      for (const key of keys)
        if (!Number.isFinite(value(c, side, key)) || value(c, side, key) < 0)
          throw new Error(`Invalid readability value: ${c.id}/${side}/${key}`);
  const scales = keys.map(
    (key) =>
      Math.sqrt(
        dev.reduce(
          (sum, c) =>
            sum + (value(c, "result", key) - value(c, "human", key)) ** 2,
          0,
        ) / dev.length,
      ) || 1,
  );
  const differences = dev.map((c) =>
    keys.map(
      (key, i) =>
        (value(c, "result", key) - value(c, "human", key)) / scales[i],
    ),
  );
  const weights = keys.map(() => 0);
  const iterations = 2000,
    regularization = 0.01,
    learningRate = 0.1;
  for (let step = 0; step < iterations && dev.length; step++) {
    const gradient = weights.map((w) => regularization * w);
    for (const row of differences) {
      const margin = row.reduce((sum, v, i) => sum + v * weights[i], 0);
      const error = 1 / (1 + Math.exp(Math.min(700, margin)));
      row.forEach((v, i) => {
        gradient[i] -= (error * v) / dev.length;
      });
    }
    weights.forEach((w, i) => {
      weights[i] = Math.max(0, w - learningRate * gradient[i]);
    });
  }
  const sum = weights.reduce((s, w) => s + w, 0);
  const normalized = weights.map((w) => (sum ? w / sum : 0));
  const fittedWeights = Object.fromEntries(
    keys.map((key, i) => [key, { weight: normalized[i], scale: scales[i] }]),
  );
  const score = dev.length
    ? (metrics) =>
        keys.reduce(
          (sum, key, i) =>
            sum + (normalized[i] * metrics[key].violations) / scales[i],
          0,
        )
    : null;
  return {
    fit: {
      available: dev.length > 0,
      trainingPairs: dev.length,
      iterations,
      regularization,
      learningRate,
      normalization: "dev RMS paired differences",
      weights: fittedWeights,
    },
    ...summarizeReadability(cases, fittedWeights, score),
  };
}

/** Summarize a fixed scoring model; never learn from the evaluated cases.
 * A null scorer is used only by the fitting diagnostic when dev is absent.
 */
export function summarizeReadability(cases, weights, score) {
  const paired = cases.filter(
    (c) =>
      c.status === "completed" &&
      c.human?.readabilityMetrics &&
      c.result?.readabilityMetrics,
  );
  const keys = Object.keys(weights).sort();
  const value = (c, side, key) => c[side].readabilityMetrics[key].violations;
  const splits = Object.fromEntries(
    ["dev", "val", "all"].map((split) => {
      const selected = paired.filter(
        (c) => split === "all" || c.split === split,
      );
      const metrics = Object.fromEntries(
        keys.map((key) => {
          const human = selected.reduce(
            (sum, c) => sum + value(c, "human", key),
            0,
          );
          const result = selected.reduce(
            (sum, c) => sum + value(c, "result", key),
            0,
          );
          return [
            key,
            {
              diagnostic: weights[key].weight === 0,
              human,
              result,
              ratio: ratio(result, human),
              humanOpportunities: selected.reduce(
                (sum, c) => sum + c.human.readabilityMetrics[key].opportunities,
                0,
              ),
              resultOpportunities: selected.reduce(
                (sum, c) =>
                  sum + c.result.readabilityMetrics[key].opportunities,
                0,
              ),
              humanZeroShare: selected.length
                ? selected.filter((c) => value(c, "human", key) === 0).length /
                  selected.length
                : null,
              ...discrimination(
                selected.map(
                  (c) => value(c, "result", key) - value(c, "human", key),
                ),
              ),
              ...(key === "area"
                ? {
                    humanMedian: median(
                      selected.map((c) => value(c, "human", key)),
                    ),
                    resultMedian: median(
                      selected.map((c) => value(c, "result", key)),
                    ),
                  }
                : {}),
            },
          ];
        }),
      );
      const human =
        score &&
        selected.reduce((sum, c) => sum + score(c.human.readabilityMetrics), 0);
      const result =
        score &&
        selected.reduce(
          (sum, c) => sum + score(c.result.readabilityMetrics),
          0,
        );
      return [
        split,
        {
          metrics,
          targets: Object.fromEntries([
            ...keys
              .filter((key) => weights[key].weight > 0)
              .map((key) => {
                const { human, result, ratio } = metrics[key];
                return [
                  key,
                  {
                    human,
                    result,
                    ratio,
                    withinTarget:
                      human < 10 ? result <= human + 2 : result <= human * 1.2,
                  },
                ];
              }),
            [
              "composite",
              score
                ? {
                    human,
                    result,
                    ratio: ratio(result, human),
                    withinTarget: result <= human * 1.2,
                  }
                : null,
            ],
          ]),
          composite: !score
            ? null
            : {
                human,
                result,
                ratio: ratio(result, human),
                ...discrimination(
                  selected.map(
                    (c) =>
                      score(c.result.readabilityMetrics) -
                      score(c.human.readabilityMetrics),
                  ),
                ),
              },
        },
      ];
    }),
  );
  return {
    splits,
    scores: Object.fromEntries(
      (score ? paired : []).map((c) => [
        c.id,
        {
          human: score(c.human.readabilityMetrics),
          result: score(c.result.readabilityMetrics),
        },
      ]),
    ),
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const [reportPath, ...args] = process.argv.slice(2);
  const write = args.includes("--write");
  const commitIndex = args.indexOf("--source-commit");
  const sourceCommit = commitIndex >= 0 ? args[commitIndex + 1] : undefined;
  if (
    !reportPath ||
    args.some(
      (arg, i) =>
        arg !== "--write" &&
        arg !== "--source-commit" &&
        !(commitIndex >= 0 && i === commitIndex + 1),
    )
  )
    throw new Error(
      "Usage: readability-fit.mjs <report.json> [--write --source-commit <full SHA>]",
    );
  if (write && !/^[a-f0-9]{40}$/.test(sourceCommit ?? ""))
    throw new Error(
      "--write requires --source-commit <full SHA> identifying the source planner",
    );
  const reportBytes = readFileSync(reportPath);
  const report = JSON.parse(reportBytes);
  if (
    !report.cases?.some(
      (c) =>
        c.split === "dev" &&
        c.status === "completed" &&
        c.human?.readabilityMetrics &&
        c.result?.readabilityMetrics,
    )
  )
    throw new Error("No completed dev readability pairs to fit");
  const fitted = fitReadability(report.cases);
  if (write) {
    const { weights, ...fit } = fitted.fit;
    const command = `node scripts/readability-fit.mjs ${JSON.stringify(reportPath)} --write --source-commit ${sourceCommit}`;
    const calibration = {
      sourceCommit,
      report: reportPath,
      reportSha256: createHash("sha256").update(reportBytes).digest("hex"),
      command,
      ...fit,
    };
    const destination = new URL(
      "../packages/auto-layout/src/readability-weights.ts",
      import.meta.url,
    );
    const { format, resolveConfig } = await import("prettier");
    const source = `// Generated by scripts/readability-fit.mjs; do not edit.
// Source commit: ${sourceCommit}
// Report: ${JSON.stringify(reportPath)}
// Command: ${command}
export const readabilityCalibration = ${JSON.stringify(calibration, null, 2)} as const;
export const readabilityWeights = ${JSON.stringify(weights, null, 2)} as const;
`;
    writeFileSync(
      destination,
      await format(source, {
        ...(await resolveConfig(destination.pathname)),
        filepath: destination.pathname,
      }),
    );
  }
  console.log(JSON.stringify(fitted, null, 2));
}
