#!/usr/bin/env node
// Repeatable integration check for serving auto-canvas under silicon-notebook's
// Next.js server at /canvas. Run on demand; never part of CI.
//
//   node scripts/notebook-integration-check.mjs --stage <T|A|S|M|L|P> --notebook <dir>
//     [--ref <git ref>] [--base <commit>] [--python <interpreter>] [--keep]
//
// Everything it builds or starts lives in a temporary directory it creates;
// the notebook checkout is only read. See docs/testing/README.md.
import path from "node:path";

import {
  createSandbox,
  PathRefused,
  UsageError,
} from "./lib/notebook-integration/sandbox.mjs";
import { stageA } from "./lib/notebook-integration/stage-a.mjs";
import { managedPrerequisites } from "./lib/notebook-integration/managed-clone.mjs";
import {
  stageL,
  stageLPrerequisites,
} from "./lib/notebook-integration/stage-l.mjs";
import { stageP } from "./lib/notebook-integration/stage-p.mjs";
import { stageM } from "./lib/notebook-integration/stage-m.mjs";
import { stageS } from "./lib/notebook-integration/self-check.mjs";
import { stageT } from "./lib/notebook-integration/stage-t.mjs";
import {
  offlineControl,
  offlineVerdict,
  observeSource,
  StageAborted,
} from "./lib/notebook-integration/steps.mjs";
import { createReporter } from "./lib/notebook-integration/transport.mjs";

const USAGE =
  "usage: node scripts/notebook-integration-check.mjs --stage <T|A|S|M|L|P> --notebook <dir>\n" +
  "         [--ref <git ref>] [--base <commit>] [--python <interpreter>] [--keep]\n" +
  "         [--package-python <wheel builder>] [--cache <directory>] (stage P)\n" +
  "  stage A needs --ref, --base and --python; stages M, L and P need --ref and\n" +
  "  --python (and the canvas builds of this checkout); stage S runs the\n" +
  "  script's own refusal self-checks on throwaway material";

function parseArgs(argv) {
  const options = { keep: false };
  const valued = new Set([
    "stage",
    "notebook",
    "ref",
    "base",
    "python",
    "package-python",
    "cache",
  ]);
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
  if (!["T", "A", "S", "M", "L", "P"].includes(options.stage))
    throw new UsageError("--stage must be T, A, S, M, L or P");
  if (!options.notebook) throw new UsageError("--notebook is required");
  if (options.stage === "A")
    for (const name of ["ref", "base", "python"])
      if (!options[name]) throw new UsageError(`stage A needs --${name}`);
  if (["M", "L", "P"].includes(options.stage)) {
    for (const name of ["ref", "python"])
      if (!options[name])
        throw new UsageError(`stage ${options.stage} needs --${name}`);
    if (options.base)
      throw new UsageError(`stage ${options.stage} takes no --base`);
  }
  if (options.stage !== "P" && (options["package-python"] || options.cache))
    throw new UsageError("--package-python and --cache are stage P options");
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

// Stages M and L run this checkout's canvas: its builds (and, for stage L,
// the UI package and Playwright) must exist before anything is allocated.
if (["M", "L", "P"].includes(options.stage)) {
  const problems = [
    ...managedPrerequisites(options.stage),
    ...(options.stage !== "M" ? stageLPrerequisites(options.stage) : []),
  ];
  if (problems.length) {
    console.error(problems.join("\n"));
    process.exit(2);
  }
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
// The handlers stay installed (R10-2): a further signal while that shutdown
// runs is a no-op, never Node's default termination, which would skip the
// summary line and leave the temporary directory behind. The 60-second hard
// stop still ends a shutdown that does not finish.
let shuttingDown = false;
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    if (shuttingDown) {
      console.log(`interrupted (${signal}) again; cleanup is already running`);
      return;
    }
    shuttingDown = true;
    interrupted = true;
    console.log(`interrupted (${signal}); cleaning up`);
    const cleanup = sandbox.dispose();
    if (options.stage === "P") {
      // A readiness probe or browser waiter may still be waiting on a dead
      // service. Once every resource is disposed it cannot advance the site.
      void cleanup.then(
        (left) => {
          for (const pgid of left)
            report.fail(
              "P",
              `process group ${pgid} still present after cleanup`,
            );
          finish();
        },
        (error) => {
          report.fail("P", `cleanup failed: ${error.message}`);
          finish();
        },
      );
    } else void cleanup.catch(() => {});
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
    else if (options.stage === "M") await stageM(context);
    else if (options.stage === "L") await stageL(context);
    else if (options.stage === "P") await stageP(context);
    else await stageA(context);
    if (options.stage !== "P") offlineVerdict(sandbox, report);
  }
  // The scan compares against the marker inside the sandbox, which an
  // interrupt has already removed. Stage S reads nothing from the notebook,
  // so it does not scan it (the directory need not even have modules).
  if (["S", "P"].includes(options.stage)) {
    // P clones from git and never needs the source working tree.
  } else if (interrupted)
    report.note("source-checkout observation skipped: interrupted");
  else observeSource(sandbox, report, notebook);
} catch (error) {
  // A refused file operation is the check's own refusal (validate, then act),
  // never a stack trace: reported once, and the run ends with exit status 2.
  if (error instanceof PathRefused) {
    context.refused = true;
    report.fail(
      "the script's own file operations stay in the sandbox",
      error.message,
    );
  } else if (error instanceof StageAborted) {
    // A shutdown left a process group present (R9-1), or the private modules
    // copy failed validation (R10-1). That step's FAIL is the report; the
    // stage stops here so no later step reads or writes beside a live process
    // of the revision, or runs from an unvalidated copy. The final disposal
    // retries the groups.
    report.note(`the stage stopped: ${error.message}`);
  } else if (!interrupted)
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
