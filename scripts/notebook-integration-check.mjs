#!/usr/bin/env node
// Repeatable integration check for serving auto-canvas under silicon-notebook's
// Next.js server at /canvas. Run on demand; never part of CI.
//
//   node scripts/notebook-integration-check.mjs --stage <T|A> --notebook <dir>
//     [--ref <git ref>] [--base <commit>] [--python <interpreter>] [--keep]
//
// Everything it builds or starts lives in a temporary directory it creates;
// the notebook checkout is only read. See docs/testing/README.md.
import path from "node:path";

import {
  createSandbox,
  UsageError,
} from "./lib/notebook-integration/sandbox.mjs";
import { stageA } from "./lib/notebook-integration/stage-a.mjs";
import { stageS } from "./lib/notebook-integration/self-check.mjs";
import { stageT } from "./lib/notebook-integration/stage-t.mjs";
import {
  offlineControl,
  offlineVerdict,
  observeSource,
} from "./lib/notebook-integration/steps.mjs";
import { createReporter } from "./lib/notebook-integration/transport.mjs";

const USAGE =
  "usage: node scripts/notebook-integration-check.mjs --stage <T|A|S> --notebook <dir>\n" +
  "         [--ref <git ref>] [--base <commit>] [--python <interpreter>] [--keep]\n" +
  "  stage A needs --ref, --base and --python; stage S runs the script's own\n" +
  "  refusal self-checks on throwaway material";

function parseArgs(argv) {
  const options = { keep: false };
  const valued = new Set(["stage", "notebook", "ref", "base", "python"]);
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--keep") options.keep = true;
    else if (flag.startsWith("--") && valued.has(flag.slice(2))) {
      const value = argv[(index += 1)];
      if (value === undefined || value.startsWith("--"))
        throw new UsageError(`${flag} needs a value`);
      options[flag.slice(2)] = value;
    } else throw new UsageError(`unknown argument ${flag}`);
  }
  if (!["T", "A", "S"].includes(options.stage))
    throw new UsageError("--stage must be T, A or S");
  if (!options.notebook) throw new UsageError("--notebook is required");
  if (options.stage === "A")
    for (const name of ["ref", "base", "python"])
      if (!options[name]) throw new UsageError(`stage A needs --${name}`);
  return options;
}

let options;
try {
  options = parseArgs(process.argv.slice(2));
} catch (error) {
  if (!(error instanceof UsageError)) throw error;
  console.error(`${error.message}\n${USAGE}`);
  process.exit(2);
}

const notebook = path.resolve(options.notebook);
let sandbox;
try {
  sandbox = createSandbox(notebook, { keep: options.keep });
} catch (error) {
  if (!(error instanceof UsageError)) throw error;
  console.error(error.message);
  process.exit(2);
}

const report = createReporter();
let interrupted = false;
let finished = false;

// The one final reporting path: the summary line is printed exactly once, after
// cleanup, and the exit status follows from it (130 after an interrupt, 2
// after a refusal of the revision under test).
function finish(context) {
  if (finished) return;
  finished = true;
  const failures = report.summary(options.stage);
  process.exit(
    interrupted ? 130 : context?.refused ? 2 : failures === 0 ? 0 : 1,
  );
}

// An interrupt only starts the shutdown. The running stage ends because its
// processes stop and the sandbox refuses new ones; cleanup runs exactly once
// (the shared disposal) and then the normal path below reports and exits.
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => {
    interrupted = true;
    console.log(`interrupted (${signal}); cleaning up`);
    void sandbox.dispose().catch(() => {});
    setTimeout(() => {
      report.fail(
        options.stage,
        "the stage did not stop within 60 s of the interrupt",
      );
      finish();
    }, 60_000).unref();
  });

const context = { sandbox, report, notebook, options };
try {
  console.log(`temporary root: ${sandbox.root}`);
  if (await offlineControl(sandbox, report)) {
    if (options.stage === "T") await stageT(context);
    else if (options.stage === "S") await stageS(context);
    else await stageA(context);
    offlineVerdict(sandbox, report);
  }
  // The scan compares against the marker inside the sandbox, which an
  // interrupt has already removed.
  if (interrupted)
    report.note("source-checkout observation skipped: interrupted");
  else observeSource(sandbox, report, notebook);
} catch (error) {
  if (!interrupted)
    report.fail(options.stage, `unexpected error: ${error.stack ?? error}`);
  else report.note(`stage stopped after the interrupt: ${error.message}`);
} finally {
  // Cleanup failures count like any other: the summary comes after them.
  try {
    for (const pgid of await sandbox.dispose())
      report.fail(
        options.stage,
        `process group ${pgid} still present after cleanup`,
      );
  } catch (error) {
    report.fail(options.stage, `cleanup failed: ${error.stack ?? error}`);
  }
  if (options.keep) console.log(`kept ${sandbox.root}`);
}
finish(context);
