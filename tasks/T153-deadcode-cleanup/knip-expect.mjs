#!/usr/bin/env node
// T153 acceptance: each Knip pass must exit 1 with exactly the findings T154
// owns, and nothing else (no unused file, no hint, no extra or missing item).
//
//   node tasks/T153-deadcode-cleanup/knip-expect.mjs          check both passes
//   node tasks/T153-deadcode-cleanup/knip-expect.mjs --print  print what Knip found
//
// The same file is the Knip reporter the check runs with: it prints one line
// with every finding as sorted [kind, path, symbol] triples, plus all hints.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { fileURLToPath } from "node:url";

const MARK = "KNIP_EXPECT ";

/** Knip reporter: one machine-readable line, nothing else. */
export default function reporter({
  report,
  issues,
  configurationHints,
  tagHints,
  cwd,
}) {
  const findings = [];
  for (const [kind, enabled] of Object.entries(report)) {
    if (!enabled) continue;
    for (const [file, bySymbol] of Object.entries(issues[kind] ?? {}))
      for (const symbol of Object.keys(bySymbol))
        findings.push([
          kind,
          relative(cwd, file),
          kind === "files" ? relative(cwd, symbol) : symbol,
        ]);
  }
  const hints = [
    ...(configurationHints ?? []).map((h) => [
      "configuration",
      h.type,
      String(h.identifier),
    ]),
    ...[...(tagHints ?? [])].map((h) => [
      "tag",
      relative(cwd, h.filePath),
      `${h.identifier} ${h.tagName}`,
    ]),
  ];
  console.log(
    MARK +
      JSON.stringify({
        findings: sortTriples(findings),
        hints: sortTriples(hints),
      }),
  );
}

function sortTriples(list) {
  return list
    .map((t) => t.map(String))
    .sort((a, b) => a.join("\0").localeCompare(b.join("\0")));
}

function runPass(name) {
  const self = fileURLToPath(import.meta.url);
  const args = ["exec", "knip", "--no-progress", "--reporter", self];
  if (name === "production") args.push("--production");
  const run = spawnSync("pnpm", args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  // Exactly one report line on stdout and nothing else on either stream: a
  // Knip warning (an unknown issue type it drops from `include`, say) would
  // otherwise switch a check off while the expected findings still match.
  const lines = (text) => text.split("\n").filter((l) => l.trim());
  const reports = lines(run.stdout).filter((l) => l.startsWith(MARK));
  const noise = [
    ...lines(run.stdout).filter((l) => !l.startsWith(MARK)),
    ...lines(run.stderr),
  ];
  return {
    status: run.status,
    stdout: run.stdout,
    stderr: run.stderr,
    reports: reports.length,
    noise,
    result:
      reports.length === 1 ? JSON.parse(reports[0].slice(MARK.length)) : null,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const expected = JSON.parse(
    readFileSync(new URL("./knip-expected.json", import.meta.url), "utf8"),
  );
  const print = process.argv.includes("--print");
  let failures = 0;
  const fail = (message) => {
    failures += 1;
    console.error(message);
  };
  for (const pass of ["default", "production"]) {
    const before = failures;
    const { status, stdout, stderr, reports, noise, result } = runPass(pass);
    if (print) {
      console.log(JSON.stringify({ pass, status, ...result }, null, 2));
      continue;
    }
    if (!result) {
      fail(
        `${pass}: expected one Knip report, found ${reports} (exit ${status})\n${stdout}${stderr}`,
      );
      continue;
    }
    for (const line of noise) fail(`${pass}: unexpected output: ${line}`);
    if (status !== 1)
      fail(`${pass}: Knip exited ${status}, expected exactly 1`);
    for (const hint of result.hints)
      fail(`${pass}: unexpected hint ${hint.join(" ")}`);
    const key = (triple) => JSON.stringify(triple);
    const want = new Set(sortTriples(expected[pass]).map(key));
    const got = new Set(result.findings.map(key));
    for (const item of got)
      if (!want.has(item)) fail(`${pass}: unexpected finding ${item}`);
    for (const item of want)
      if (!got.has(item)) fail(`${pass}: missing finding ${item}`);
    if (failures === before)
      console.log(
        `${pass}: exit 1 with exactly the ${want.size} expected findings, no hints`,
      );
  }
  process.exitCode = failures ? 1 : 0;
}
