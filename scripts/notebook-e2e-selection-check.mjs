#!/usr/bin/env node
// Asserts which browser tests each Playwright run collects. Reads the JSON a
// `playwright test --list --reporter=json` (or a run's JSON report) writes.
// A test's identity is `<project>\t<file>\t<full title path>`: the file
// relative to apps/editor/e2e, the title path every enclosing describe title
// and the test title joined by " › " (the file suite itself excluded).
//
//   --standard <listing.json> --baseline <file>  identities equal the baseline
//   --prefix <listing.json>                       only the base-path case
//   --notebook <listing.json>                     exactly the notebook cases
//   --notebook-report <e2e-report.json>           the same, every one passed
import { readFileSync } from "node:fs";

/** The notebook run's required cases, per project and file. */
const NOTEBOOK_MANIFEST = {
  "notebook\tnotebook-auth.spec.ts": [
    "N1a no token key: signed-out page, no API request, no editor module or storage",
    "N1b a malformed token: signed-out page, no API request, no editor module or storage",
    "N2a notebook unreachable: error page with Retry, no single-user storage",
    "N2b notebook answers 5xx: error page with Retry, no single-user storage",
    "N2c auth/me answers 500: error page with Retry, no single-user storage",
    "N2d auth/me answers malformed JSON or no user: error page with Retry",
    "N2e auth/me answers a standalone user: error page with Retry",
    "N2f Retry after the fault is gone mounts the editor",
    "N2g a token notebook rejects shows the signed-out page",
    "N3 an account switch in another tab reloads into the new account without the old previews",
    "N4a a save issued before the switch stays the old account's",
    "N4b a save in the pre-event interval carries the mounted account's bearer",
    "N4c a 401 on a mounted document reloads the page",
    "N5a unsaved work: the switch reloads without a beforeunload prompt",
    "N5b the old document is cleared at the storage event and sends nothing",
    "N6a sign-out then Back shows the signed-out page",
    "N6b sign-out in another page reloads into the signed-out page",
    "N8 bundled packages, the RNL Viewer and the RNL Worker carry no bearer",
    "N10a the entry chunk fails: reload page, then the editor",
    "N10b the editor modules fail: reload page without Retry, then the editor",
    "N10c lazy Shelf previews load as they scroll into view",
    "N10d version history placeholders hold the layout until previews load",
    "N10e previews that do not decode fall back to placeholders",
    "N10f measurement: version list observer root and requests before scrolling",
  ],
  "notebook-bfcache\tnotebook-bfcache.spec.ts": [
    "N6c control: a plain page is restored from the back/forward cache",
    "N6c sign-out then Back: the restored editor is cleared at pageshow",
  ],
  "notebook\tnotebook-worker.spec.ts": [
    "N7 previews never come from the HTTP cache or the service worker, and Bob never sees Alice's previews",
    "N9 offline: the cached shell stops at the gate and opens no editor storage",
  ],
  "notebook\tnotebook-evidence.spec.ts": [
    "N11d seed control: the standard editor's recovery reader accepts the single-user seed",
    "N11b the standard build needs its account server, and shows no recovery content without it",
    "N11c the notebook build keeps the Agent off with a saved Agent session and ?agent=pair",
  ],
};

const SEPARATOR = " › ";

/** Every test in a listing or a report, with its identity and results. */
function collect(report) {
  const tests = [];
  const walk = (suite, file, titles) => {
    for (const spec of suite.specs ?? [])
      for (const test of spec.tests ?? [])
        tests.push({
          project: test.projectName ?? "",
          file,
          title: [...titles, spec.title].join(SEPARATOR),
          test,
        });
    for (const child of suite.suites ?? [])
      walk(child, file, [...titles, child.title]);
  };
  for (const fileSuite of report.suites ?? [])
    walk(fileSuite, fileSuite.file ?? fileSuite.title, []);
  return tests;
}

const identity = ({ project, file, title }) => `${project}\t${file}\t${title}`;

function fail(message) {
  console.error(`notebook-e2e-selection-check: ${message}`);
  process.exit(1);
}

function readJson(path) {
  if (!path) fail("a JSON file is required");
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(`cannot read ${path}: ${error.message}`);
  }
}

function listDifference(actual, expected) {
  const count = (items) => {
    const counts = new Map();
    for (const item of items) counts.set(item, (counts.get(item) ?? 0) + 1);
    return counts;
  };
  const a = count(actual);
  const e = count(expected);
  const lines = [];
  for (const [item, n] of e)
    if ((a.get(item) ?? 0) < n) lines.push(`missing: ${item}`);
  for (const [item, n] of a)
    if ((e.get(item) ?? 0) < n) lines.push(`unexpected: ${item}`);
  return lines;
}

function expectList(actual, expected, label) {
  const lines = listDifference(actual, expected);
  if (lines.length) fail(`${label} differs:\n${lines.slice(0, 40).join("\n")}`);
}

function expectErrorsAbsent(report) {
  if ((report.errors ?? []).length)
    fail(
      `the report has ${report.errors.length} error(s): ${report.errors
        .map((error) => error.message?.split("\n")[0])
        .join("; ")}`,
    );
}

function notebookIdentities() {
  return Object.entries(NOTEBOOK_MANIFEST).flatMap(([pair, titles]) =>
    titles.map((title) => `${pair}\t${title}`),
  );
}

const [mode, file, flag, baseline] = process.argv.slice(2);
const report = readJson(file);
expectErrorsAbsent(report);
const tests = collect(report);
if (mode === "--standard") {
  if (flag !== "--baseline" || !baseline)
    fail("--standard needs --baseline <file>");
  const expected = readFileSync(baseline, "utf8")
    .split("\n")
    .filter((line) => line !== "");
  expectList(tests.map(identity).sort(), expected.sort(), "standard listing");
  if (
    tests.some((test) => /(?:^|\/)notebook-[^/]*\.spec\.ts$/u.test(test.file))
  )
    fail("the standard listing collects a notebook spec");
  console.log(`standard listing: ${tests.length} tests equal the baseline`);
} else if (mode === "--prefix") {
  expectList(
    tests.map(identity),
    [
      [
        "",
        "base-path.spec.ts",
        "a prefixed editor saves and reopens a Cloud circuit beside notebook",
      ].join("\t"),
    ],
    "prefix listing",
  );
  console.log("prefix listing: exactly the base-path case");
} else if (mode === "--notebook" || mode === "--notebook-report") {
  expectList(tests.map(identity), notebookIdentities(), "notebook listing");
  if (mode === "--notebook-report")
    for (const { test, title, project } of tests) {
      const last = test.results?.at(-1);
      if (
        test.expectedStatus !== "passed" ||
        test.status !== "expected" ||
        last?.status !== "passed" ||
        (test.results ?? []).length !== 1
      )
        fail(
          `${project} ${title}: expectedStatus ${test.expectedStatus}, status ${test.status}, results ${(test.results ?? []).map((result) => result.status).join(",")}`,
        );
    }
  console.log(
    `${mode.slice(2)}: ${tests.length} notebook tests${mode === "--notebook-report" ? ", every one passed" : ""}`,
  );
} else fail(`unknown mode ${mode ?? "(none)"}`);
