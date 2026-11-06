import { appendFile } from "node:fs/promises";

import {
  collectChangedPaths,
  formatGatePlan,
  formatGatePlanMarkdown,
  loadGateCatalog,
  planValidation,
} from "./lib/validation-gates.mjs";

function valuesAfter(args, flag) {
  return args.flatMap((value, index) =>
    value === flag && args[index + 1] ? [args[index + 1]] : [],
  );
}

const args = process.argv.slice(2).filter((value) => value !== "--");
const base = valuesAfter(args, "--base")[0] ?? "origin/main";
const explicitPaths = valuesAfter(args, "--path");
const json = args.includes("--json");
const githubSummary = args.includes("--github-summary");
const catalog = await loadGateCatalog();
const paths =
  explicitPaths.length > 0
    ? explicitPaths
    : collectChangedPaths(base, { ignoredPaths: catalog.ignoredPaths });
const plan = planValidation(paths, catalog);

if (json) {
  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
} else {
  process.stdout.write(formatGatePlan(plan, { base }));
}

if (githubSummary && process.env.GITHUB_STEP_SUMMARY) {
  await appendFile(
    process.env.GITHUB_STEP_SUMMARY,
    formatGatePlanMarkdown(plan, { base }),
  );
}
