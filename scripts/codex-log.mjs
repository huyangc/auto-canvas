// Read a Codex round's event log without reading the whole file.
//
//   node scripts/codex-log.mjs tasks/T001-<slug>                timeline, latest round
//   node scripts/codex-log.mjs tasks/T001-<slug> --round 2      timeline of round 2
//   node scripts/codex-log.mjs tasks/T001-<slug> --show 12      output of command #12
//   node scripts/codex-log.mjs tasks/T001-<slug> --round 2 --follow
//
// --follow prints only Codex's messages, turn results and errors as they happen,
// and exits once scripts/codex-task.sh records the round's exit status.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

import {
  buildTimeline,
  findCommand,
  followRound,
  formatTimeline,
  parseEvents,
} from "./lib/codex-log.mjs";

function fail(message) {
  console.error(message);
  process.exit(2);
}

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    round: { type: "string" },
    show: { type: "string" },
    follow: { type: "boolean", default: false },
  },
});

const task = positionals[0]?.replace(/\/$/u, "");
if (!task) {
  fail(
    "Usage: node scripts/codex-log.mjs tasks/<id>-<slug> [--round N] [--show N | --follow]",
  );
}
const logs = join(task, "logs");

if (values.follow) {
  // The latest round on disk may be the previous one, already finished, when a
  // watcher starts right after dispatch, so the round must be named.
  if (!values.round) fail("--follow needs --round N");
  await followRound({
    logs,
    round: values.round,
    emit: (line) => console.log(line),
  });
} else {
  let round = values.round;
  if (!round) {
    let names = [];
    try {
      names = readdirSync(logs);
    } catch {
      fail(`No logs in ${logs}`);
    }
    const rounds = names
      .map((name) => /^round-(\d+)\.jsonl$/u.exec(name)?.[1])
      .filter(Boolean)
      .map(Number);
    if (rounds.length === 0) fail(`No round logs in ${logs}`);
    round = String(Math.max(...rounds));
  }

  let text;
  try {
    text = readFileSync(join(logs, `round-${round}.jsonl`), "utf8");
  } catch {
    fail(`No log for round ${round} in ${logs}`);
  }
  const timeline = buildTimeline(parseEvents(text));

  if (values.show) {
    const entry = findCommand(timeline, Number(values.show));
    if (!entry) fail(`No command #${values.show} in round ${round}`);
    console.log(`$ ${entry.command}\n[exit ${entry.exitCode ?? "?"}]`);
    console.log(entry.output);
  } else {
    console.log(`round ${round}`);
    console.log(formatTimeline(timeline));
  }
}
