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
import { stageT } from "./lib/notebook-integration/stage-t.mjs";
import {
  offlineControl,
  offlineVerdict,
  observeSource,
} from "./lib/notebook-integration/steps.mjs";
import { createReporter } from "./lib/notebook-integration/transport.mjs";

const USAGE =
  "usage: node scripts/notebook-integration-check.mjs --stage <T|A> --notebook <dir>\n" +
  "         [--ref <git ref>] [--base <commit>] [--python <interpreter>] [--keep]\n" +
  "  stage A needs --ref, --base and --python";

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
  if (!["T", "A"].includes(options.stage))
    throw new UsageError("--stage must be T or A");
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

let interrupted = false;
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => {
    interrupted = true;
    console.log(`interrupted (${signal}); cleaning up`);
    void sandbox
      .dispose()
      .then((left) => {
        for (const pgid of left)
          console.log(
            `FAIL ${options.stage}: process group ${pgid} still present`,
          );
      })
      .finally(() => process.exit(130));
  });

const report = createReporter();
try {
  console.log(`temporary root: ${sandbox.root}`);
  if (await offlineControl(sandbox, report)) {
    const context = { sandbox, report, notebook, options };
    if (options.stage === "T") await stageT(context);
    else await stageA(context);
    offlineVerdict(sandbox, report);
  }
  observeSource(sandbox, report, notebook);
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
// Printed last, after disposal, so it always agrees with the exit status.
const failures = report.summary(options.stage);
process.exit(interrupted ? 130 : failures === 0 ? 0 : 1);
