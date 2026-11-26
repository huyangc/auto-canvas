// Stage M: a managed start of this checkout's canvas inside a disposable
// silicon-notebook clone. The clone is built with the `/canvas` rewrite and
// configured with the auto-canvas plugin; silicon-notebook's own launcher
// (`npm run start`, scripts/prod.sh) starts the canvas as a companion
// service. Two notebook users get separate, authenticated canvases through
// the notebook's origin; sign-out and stop are observed; then the external
// mode with a misrouted upstream, and the partial and full rollbacks.
//
// The set-up, the launch, the managed service's checks, the gates, the stop
// and the cleanup are shared with stage L (managed-clone.mjs).
import path from "node:path";

import {
  checkManagedService,
  hex,
  integration,
  launchClone,
  managedCompanions,
  managedState,
  parsed,
  probing,
  readState,
  register,
  repo,
  request,
  resetRuntime,
  runManagedStage,
  SERVICE_KEY,
  setUp,
  stopAll,
  throughCanvas,
  vacant,
  managedService,
} from "./managed-clone.mjs";
import { removeNext } from "./notebook-clone.mjs";
import { waitFor } from "./sandbox.mjs";
import { ownershipGate, tail } from "./steps.mjs";
import {
  expectDestinations,
  expectRewrites,
  readManifest,
  todaysRules,
} from "./transport.mjs";

const READY = "/@notebook/canvas/api/integration/ready.json";

const contentTypeOf = (res) => String(res.headers?.["content-type"] ?? "");

/**
 * A response that must be the canvas's project list (`GET
 * /canvas/api/projects`): HTTP 200, the JSON media type, and a body that
 * parses to an object with a `projects` array whose entries each carry a
 * string id. Returns `{ ids, problem }`: the ids and "", or [] and a problem
 * naming the response (an HTML page or an error answer never counts as an
 * empty list). The body's excerpt in the problem is cut only after `clean`
 * (the stage's redaction) has run over the whole body (T165 follow-up 7): a
 * secret that straddles the cut is never printed in part.
 */
export function projectList(res, clean = (text) => text) {
  const type = contentTypeOf(res);
  const body = parsed(res);
  const why =
    res.status !== 200
      ? `status ${res.status}`
      : !/^application\/json\s*(?:;|$)/iu.test(type.trim())
        ? "not the JSON media type"
        : body === null ||
            typeof body !== "object" ||
            !Array.isArray(body.projects)
          ? "the body is not an object with a projects array"
          : body.projects.some(
                (project) => typeof project?.id !== "string" || !project.id,
              )
            ? "a project entry has no id"
            : "";
  if (!why)
    return { ids: body.projects.map((project) => project.id), problem: "" };
  return {
    ids: [],
    problem: `not a project list: ${why} (status ${res.status}, content-type ${JSON.stringify(type)}, body ${JSON.stringify(clean(String(res.body ?? "")).slice(0, 80))})`,
  };
}

/**
 * Why a project list (`projectList`'s result) is not the one expected, or "":
 * a valid list that holds every id of `holds` and none of `lacks` (T165
 * follow-up 4: an always-empty list fails as soon as it must hold one).
 */
export function listProblem(list, { holds = [], lacks = [] }) {
  if (list.problem) return list.problem;
  const missing = holds.filter((id) => !id || !list.ids.includes(id));
  const present = lacks.filter((id) => id && list.ids.includes(id));
  if (missing.length)
    return `${list.ids.length} project(s): ${missing.length} expected project(s) missing`;
  if (present.length)
    return `${list.ids.length} project(s): ${present.length} project(s) of the other user present`;
  return "";
}

/** JSON text with every object's keys in order, for a comparison. */
const canonicalJson = (value) =>
  JSON.stringify(value, (_key, item) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(
          Object.keys(item)
            .sort()
            .map((key) => [key, item[key]]),
        )
      : item,
  );

/**
 * Why a reopened project (`GET /canvas/api/projects/<id>`) is not the save it
 * should show, or "" (T165 follow-up 3): 200, the saved revision and name,
 * and a schematic that is the saved fixture's (`projectText`), compared as
 * canonical JSON — not merely some string.
 */
export function reopenedProblem(res, { revision, name, projectText }) {
  const project = parsed(res)?.project;
  if (res.status !== 200) return `status ${res.status}`;
  if (project?.revision !== revision)
    return `revision ${project?.revision}, expected ${revision}`;
  if (project?.name !== name) return "not the saved name";
  if (typeof project?.projectText !== "string")
    return "the project has no projectText";
  let reopened;
  try {
    reopened = canonicalJson(JSON.parse(project.projectText));
  } catch {
    return "its projectText is not JSON";
  }
  return reopened === canonicalJson(JSON.parse(projectText))
    ? ""
    : "its schematic is not the one saved (canonical JSON differs)";
}

/**
 * An answer counts as JSON when its media type names JSON (any case) or its
 * body, whatever the header says, parses as JSON once trimmed.
 */
function answersJson(res) {
  if (/json/iu.test(contentTypeOf(res))) return true;
  const text = String(res.body ?? "").trim();
  if (!text) return false;
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

export async function stageM(context) {
  await runManagedStage(context, stageMBody);
}

// ---- The stage -------------------------------------------------------------

async function stageMBody({ sandbox, report, secrets, notebook, options }) {
  const m = managedState({
    sandbox,
    report,
    secrets,
    notebook,
    options,
    stage: "M",
  });
  sandbox.beforeDispose(m.cleanup);
  try {
    if (!(await setUp(m, {}))) return;
    if (!(await managedRun(m))) return;
    m.say(`     managed run done after ${m.elapsed()}`);
    if (!(await externalRun(m))) return;
    m.say(`     external run done after ${m.elapsed()}`);
    await rolledBack(m, "M-a", withoutTheEntry);
    m.say(
      `     partial rollback (plugin entry removed) done after ${m.elapsed()}`,
    );
    if (!(await secondBuild(m))) return;
    if (!(await targetlessRun(m))) return;
    m.say(`     partial rollback (target removed) done after ${m.elapsed()}`);
    await rolledBack(m, "M-full", withoutBoth);
    m.say(`     full rollback done after ${m.elapsed()}`);
  } finally {
    await m.cleanup();
    m.say(`     stage M took ${m.elapsed()}`);
  }
}

// ---- M2–M9: the managed run --------------------------------------------------

async function managedRun(m) {
  const run = await launchClone(m, "M2", "managed");
  let stopInfo = { launch: run.launch };
  try {
    if (!run.up) return false;
    const { service, ok } = await checkManagedService(m, run, "M2");
    stopInfo = service.stopInfo;
    if (!ok) return false;
    await probing(m, "M3–M8", () =>
      signedInUsers(m, {
        getCanvas: throughCanvas(m, run.up, service.canvasPid),
        getProxied: run.up.getProxied,
      }),
    );
    return true;
  } finally {
    run.stopWatch?.();
    await stopAll(m, "M9", stopInfo);
  }
}

/**
 * Polls `probe(leftMs)` from `since` until it answers 401, every `intervalMs`,
 * and never past `limitMs` after `since`: each probe gets only the time left
 * as its deadline, no probe starts once it is used up, and a 401 that arrives
 * after the limit does not count. Resolves to `{ after, last, late }`:
 * `after` the ms from `since` to the first 401 within the limit (undefined if
 * none), `late` the ms of a 401 that came after it.
 */
export async function firstRefusal({
  since,
  limitMs,
  intervalMs,
  probe,
  now = Date.now,
}) {
  let last;
  for (;;) {
    const left = limitMs - (now() - since);
    if (left <= 0) return { after: undefined, last };
    last = await probe(left);
    const after = now() - since;
    if (last?.status === 401)
      return after <= limitMs
        ? { after, last }
        : { after: undefined, late: after, last };
    const wait = Math.min(intervalMs, limitMs - after);
    if (wait <= 0) return { after: undefined, last };
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
}

/** M3–M8: readiness, the signed-out answers, two users, a sign-out. */
export async function signedInUsers(m, { getCanvas, getProxied }) {
  const { report } = m;
  const clean = report.clean;
  // M3 ready through the notebook's origin.
  const ready = await request(getCanvas, "/canvas/api/integration/ready.json");
  report.check(
    'M3 GET /canvas/api/integration/ready.json through web -> 200 {"ok":true,"mode":"notebook"}',
    ready.status === 200 &&
      JSON.stringify(parsed(ready)) === '{"ok":true,"mode":"notebook"}',
    `status ${ready.status}, body ${tail(ready.body, 3)}`,
  );
  // M4 signed out.
  const anonymous = await request(getCanvas, "/canvas/api/projects");
  report.check(
    "M4 GET /canvas/api/projects without a bearer -> 401",
    anonymous.status === 401,
    `status ${anonymous.status}`,
  );
  const page = await request(getCanvas, "/canvas");
  report.check(
    "M4 GET /canvas -> 200 with the notebook editor's index.html",
    page.status === 200 && page.body === m.editorIndex,
    `status ${page.status}, ${page.body.length} bytes (index.html ${m.editorIndex.length})`,
  );
  // M5 two users.
  const a = await register(m, getProxied, "a");
  const b = await register(m, getProxied, "b");
  for (const [name, user] of [
    ["A", a],
    ["B", b],
  ]) {
    if (
      !report.check(
        `M5 user ${name} registers through web`,
        user.status === 200 && user.token && user.id,
        `status ${user.status}`,
      )
    )
      return false;
    const me = await request(getProxied, "/api/me", { token: user.token });
    report.check(
      `M5 /api/me with ${name}'s token -> 200 with ${name}'s id`,
      me.status === 200 && parsed(me)?.id === user.id,
      `status ${me.status}`,
    );
  }
  // M6 A's project: imports, saves, reopens (API level).
  const projects = "/canvas/api/projects";
  const nameA = `M6 project ${hex(3)}`;
  const createdA = await request(getCanvas, projects, {
    method: "POST",
    token: a.token,
    json: { name: nameA, projectText: m.makeProject(nameA) },
  });
  const projectA = parsed(createdA)?.project;
  if (
    !report.check(
      "M6 A creates a project through /canvas -> 201",
      createdA.status === 201 && projectA?.id && projectA.revision > 0,
      `status ${createdA.status}, body ${tail(createdA.body, 3)}`,
    )
  )
    return false;
  const projectOfA = `${projects}/${projectA.id}`;
  const readA = await request(getCanvas, projectOfA, { token: a.token });
  report.check(
    "M6 A reads it back -> 200, same name",
    readA.status === 200 && parsed(readA)?.project?.name === nameA,
    `status ${readA.status}`,
  );
  // The save is a different schematic (four resistors, not three), so a
  // reopen that still shows the first one is caught.
  const renamed = `${nameA} saved`;
  const savedText = m.makeProject(renamed, 4);
  const saved = await request(getCanvas, projectOfA, {
    method: "PUT",
    token: a.token,
    headers: { "if-match": `revision-${projectA.revision}` },
    json: { name: renamed, projectText: savedText },
  });
  report.check(
    "M6 A saves a new revision with If-Match -> 200",
    saved.status === 200 &&
      parsed(saved)?.project?.revision === projectA.revision + 1,
    `status ${saved.status}, body ${tail(saved.body, 3)}`,
  );
  const reopened = await request(getCanvas, projectOfA, { token: a.token });
  const reopenedWhy = reopenedProblem(reopened, {
    revision: projectA.revision + 1,
    name: renamed,
    projectText: savedText,
  });
  report.check(
    "M6 A reopens it -> the new revision, its name and the saved schematic (canonical JSON)",
    !reopenedWhy,
    reopenedWhy,
  );
  // M7 separation. A list counts only as a valid project list (projectList).
  const foreign = await request(getCanvas, projectOfA, { token: b.token });
  report.check(
    "M7 B reading A's project -> 404",
    foreign.status === 404,
    `status ${foreign.status}`,
  );
  const listB = projectList(
    await request(getCanvas, projects, { token: b.token }),
    clean,
  );
  report.check(
    "M7 B's list is a valid project list and does not hold A's project",
    !listB.problem && !listB.ids.includes(projectA.id),
    () =>
      listB.problem || `it holds A's project (${listB.ids.length} project(s))`,
  );
  const nameB = `M7 project ${hex(3)}`;
  const createdB = await request(getCanvas, projects, {
    method: "POST",
    token: b.token,
    json: { name: nameB, projectText: m.makeProject(nameB) },
  });
  const projectB = parsed(createdB)?.project;
  report.check(
    "M7 B creates its own project -> 201",
    createdB.status === 201 && projectB?.id,
    `status ${createdB.status}`,
  );
  const listA = projectList(
    await request(getCanvas, projects, { token: a.token }),
    clean,
  );
  report.check(
    "M7 A's list is a valid project list holding A's project and not B's",
    !listA.problem &&
      listA.ids.includes(projectA.id) &&
      !listA.ids.includes(projectB?.id),
    () =>
      listA.problem ||
      `${listA.ids.length} project(s): A's ${listA.ids.includes(projectA.id) ? "present" : "missing"}, B's ${listA.ids.includes(projectB?.id) ? "present" : "absent"}`,
  );
  // M8 sign-out: the canvas trusts a validated token for 60 s. The 75 s are
  // measured from the moment the sign-out's response arrived.
  const logout = await request(getProxied, "/api/auth/logout", {
    method: "POST",
    token: a.token,
  });
  const signedOut = Date.now();
  report.check(
    "M8 A signs out through web -> 204",
    logout.status === 204,
    `status ${logout.status}`,
  );
  const meAfter = await request(getProxied, "/api/me", { token: a.token });
  report.check(
    "M8 /api/me with A's token after the sign-out -> 401",
    meAfter.status === 401,
    `status ${meAfter.status}`,
  );
  const refusal =
    logout.status === 204
      ? await firstRefusal({
          since: signedOut,
          limitMs: 75_000,
          intervalMs: 5000,
          probe: (left) =>
            request(getCanvas, projects, {
              token: a.token,
              deadlineMs: Math.min(30_000, left),
            }),
        })
      : { after: undefined };
  report.check(
    `M8 /canvas/api/projects with A's token -> 401 within 75 s of the sign-out's 204${refusal.after === undefined ? "" : ` (first 401 after ${(refusal.after / 1000).toFixed(1)} s)`}`,
    refusal.after !== undefined,
    () =>
      logout.status !== 204
        ? "the sign-out did not succeed, so nothing was polled"
        : refusal.late !== undefined
          ? `the first 401 came ${(refusal.late / 1000).toFixed(1)} s after the sign-out, past 75 s`
          : `no 401 within 75 s; last status ${refusal.last?.status}`,
  );
  const stillB = listProblem(
    projectList(await request(getCanvas, projects, { token: b.token }), clean),
    { holds: [projectB?.id], lacks: [projectA.id] },
  );
  report.check(
    "M8 B's token still gets a valid project list afterwards, holding B's project and not A's",
    !stillB,
    stillB,
  );
  return {
    a,
    projectId: projectA.id,
    saved: {
      revision: projectA.revision + 1,
      name: renamed,
      projectText: savedText,
    },
  };
}

// ---- M-ext: external mode, then a misrouted upstream -------------------------

/** Waits until `handle` listens on the canvas port; "" or the problem. */
async function canvasListening(m, handle) {
  await handle.ready;
  let foreign = [];
  const settled = await waitFor(
    () => {
      if (handle.exited) return true;
      const state = m.sandbox.listenerState(m.canvasPort, handle.pid);
      if (state.state === "foreign") foreign = state.pids;
      return state.state !== "none";
    },
    60_000,
    200,
  );
  if (handle.exited) return "it exited";
  if (foreign.length)
    return `port ${m.canvasPort} is held by ${foreign.join(", ")}`;
  return settled ? "" : "it did not listen within 60 s";
}

async function externalRun(m) {
  const { sandbox, report } = m;
  const externalLog = path.join(sandbox.root, "canvas-external.log");
  // The canvas the operator would start: the same serve.sh with the managed
  // service's variables.
  const serve = sandbox.start(path.join(integration, "serve.sh"), [], {
    cwd: sandbox.root,
    name: "mext-serve",
    env: sandbox.env(
      {
        AUTO_CANVAS_DATABASE_URL: m.canvasUrl,
        AUTO_CANVAS_NOTEBOOK_API: m.api,
        AUTO_CANVAS_NOTEBOOK_ENV_FILE: m.envFile,
        AUTO_CANVAS_PORT: String(m.canvasPort),
        AUTO_CANVAS_LOG_FILE: externalLog,
        AUTO_CANVAS_NODE: process.execPath,
      },
      { envFile: false },
    ),
  });
  m.groups.push(serve.pgid);
  const serveProblem = await canvasListening(m, serve);
  if (
    !report.check(
      "M-ext the stage's serve.sh listens on the canvas port",
      !serveProblem,
      () =>
        `${serveProblem}\n${tail(sandbox.readFile(externalLog, "utf8") ?? "", 8)}`,
    )
  ) {
    await sandbox.stopGroup(serve.pgid);
    return false;
  }
  const run = await launchClone(m, "M-ext", "external");
  let standalone;
  let supervisorPid = 0;
  try {
    if (!run.up) return false;
    const state = readState(m);
    // Recorded only once proven to be this clone's supervisor.
    const companions = managedCompanions({
      nb: m.nb,
      supervisorPid: Number(state?.pid),
      record: m.recordCompanion,
    });
    supervisorPid = companions.supervisorPid;
    const service = state?.services?.[SERVICE_KEY];
    report.check(
      "M-ext silicon-notebook reports the external service ready, without a worker of its own",
      state?.state === "ready" &&
        service?.state === "ready" &&
        service.pid === null,
      `state ${JSON.stringify(state)}`,
    );
    report.check(
      "M-ext the state's supervisor is this clone's extension_services.py _supervise (verified before it is recorded)",
      supervisorPid > 0 && companions.problems.length === 0,
      () => companions.problems.join("; "),
    );
    const user = await probing(m, "M-ext", async () => {
      const fresh = await register(m, run.up.getProxied, "c");
      if (
        !report.check(
          "M-ext a fresh user registers",
          fresh.status === 200 && fresh.token,
          `status ${fresh.status}`,
        )
      )
        return false;
      const list = projectList(
        await request(
          throughCanvas(m, run.up, serve.pid),
          "/canvas/api/projects",
          { token: fresh.token },
        ),
        report.clean,
      );
      report.check(
        "M-ext /canvas/api/projects with that user's token -> 200 with a valid project list",
        !list.problem,
        () => list.problem,
      );
      return fresh;
    });
    if (!user) return false;

    // The misrouted upstream: a standalone canvas on the canvas port.
    const serveStopped = await sandbox.stopGroup(serve.pgid);
    if (
      !report.check(
        "M-ext the stage's canvas is stopped and the canvas port is vacant",
        serveStopped && vacant(m, m.canvasPort),
        `stopped ${serveStopped}, listeners [${sandbox.listenerPids(m.canvasPort)}]`,
      )
    )
      return false;
    const standaloneUser = `Standalone ${hex(4)}`;
    standalone = sandbox.start(
      process.execPath,
      [path.join(repo, "apps/server/dist/cli.js")],
      {
        cwd: sandbox.root,
        name: "mext-standalone",
        env: sandbox.env(
          {
            DATABASE_URL: m.standaloneUrl,
            PORT: String(m.canvasPort),
            HOST: "127.0.0.1",
            AUTO_CANVAS_AUTH: "local",
            AUTO_CANVAS_USER_NAME: standaloneUser,
            EDITOR_ROOT: path.join(repo, "apps/editor/dist"),
          },
          { envFile: false },
        ),
      },
    );
    m.groups.push(standalone.pgid);
    const standaloneProblem = await canvasListening(m, standalone);
    if (
      !report.check(
        "M-ext a standalone canvas listens on the canvas port instead",
        !standaloneProblem,
        () =>
          `${standaloneProblem}\n${tail(sandbox.readFile(standalone.logFile, "utf8") ?? "", 8)}`,
      )
    )
      return false;
    await probing(m, "M-ext misrouted", () =>
      misroutedUpstream(m, {
        run,
        standalone,
        standaloneUser,
        token: user.token,
      }),
    );
    return true;
  } finally {
    if (standalone) await sandbox.stopGroup(standalone.pgid);
    await sandbox.stopGroup(serve.pgid);
    await stopAll(m, "M-ext", {
      launch: run.launch,
      canvasPids: [supervisorPid],
    });
  }
}

/**
 * Through the notebook, with the user's token and without, nothing of the
 * standalone canvas on the canvas port may come back: no 200 with JSON, no
 * body naming its seeded project or its user.
 */
async function misroutedUpstream(
  m,
  { run, standalone, standaloneUser, token },
) {
  const { sandbox, report } = m;
  const seededName = `Seeded ${hex(4)}`;
  const seeded = await request(
    ownershipGate(sandbox, m.canvasPort, standalone.pid),
    "/api/projects",
    {
      method: "POST",
      headers: { origin: m.canvasOrigin },
      json: { name: seededName, projectText: m.makeProject(seededName) },
    },
  );
  const seededId = parsed(seeded)?.project?.id;
  if (
    !report.check(
      "M-ext the standalone canvas holds one project seeded through its own API",
      seeded.status === 201 && seededId,
      `status ${seeded.status}, body ${tail(seeded.body, 3)}`,
    )
  )
    return false;
  const misrouted = throughCanvas(m, run.up, standalone.pid);
  const answers = [];
  for (const bearer of [token, undefined])
    for (const rawPath of [
      "/canvas",
      "/canvas/api/projects",
      "/canvas/api/auth/me",
      "/canvas/../api/projects",
      "/canvas/%2e%2e/api/projects",
    ]) {
      const res = await request(misrouted, rawPath, { token: bearer });
      answers.push(
        misroutedAnswer({
          rawPath,
          token: Boolean(bearer),
          res,
          names: [seededId, seededName, standaloneUser],
        }),
      );
    }
  const bad = misroutingProblems(answers);
  report.check(
    "M-ext through the notebook, every request with or without a token gets an HTTP answer, none 200 with JSON, none showing the standalone canvas's project or user",
    bad.length === 0,
    bad.join("; "),
  );
  report.info(
    `M-ext answers: ${answers.map((answer) => `${answer.token ? "token" : "none"} ${answer.rawPath} ${answer.status}${answer.json ? " json" : ""}`).join("; ")}`,
  );
  return true;
}

/**
 * One M-ext probe's answer for `misroutingProblems`: `json` when the answer
 * is JSON by its media type (any case) or by its body (`answersJson`),
 * `leaked` the standalone canvas's `names` its body shows.
 */
export function misroutedAnswer({ rawPath, token, res, names }) {
  const body = String(res.body ?? "");
  return {
    rawPath,
    token,
    status: res.status,
    json: answersJson(res),
    leaked: names.filter((text) => text && body.includes(text)),
  };
}

/**
 * The misrouting verdict of M-ext's probes `{ rawPath, token, status, json,
 * leaked }`: one line per probe that fails, naming it. A probe passes only
 * with an HTTP answer (a numeric status; a timeout or a socket error is a
 * failure, never "safe"), and that answer is neither 200 with JSON nor a body
 * holding any of the standalone canvas's names.
 */
export function misroutingProblems(answers) {
  const problems = [];
  for (const answer of answers) {
    const probe = `${answer.token ? "with the token" : "without a token"} GET ${answer.rawPath}`;
    if (typeof answer.status !== "number")
      problems.push(`${probe}: no HTTP answer (${answer.status})`);
    else if (answer.status === 200 && answer.json)
      problems.push(`${probe}: 200 with JSON`);
    else if (answer.leaked.length)
      problems.push(
        `${probe}: the body shows ${answer.leaked.length} of the standalone canvas's names`,
      );
  }
  return problems;
}

// ---- M-a, build 2, M-b, M-full: the rollbacks ----------------------------------

/**
 * A launch without the plugin entry: no companion service, and every request
 * through `/canvas` is sent only while the canvas port has no listener.
 */
async function rolledBack(m, label, expectations) {
  const { sandbox, report } = m;
  const run = await launchClone(m, label, "none");
  try {
    if (!run.up) return false;
    const state = readState(m);
    report.check(
      `${label} no companion service: no canvas listener and no running extension session`,
      vacant(m, m.canvasPort) &&
        (state === null || !Object.keys(state.services ?? {}).length),
      `listeners [${sandbox.listenerPids(m.canvasPort)}], state ${JSON.stringify(state)}`,
    );
    return await probing(m, label, () =>
      expectations(m, {
        toVacantCanvas: throughCanvas(m, run.up, null),
        getProxied: run.up.getProxied,
        getWeb: run.up.getWeb,
      }),
    );
  } finally {
    await stopAll(m, label, { launch: run.launch });
  }
}

/** M-a: the build still has the target, nothing serves it. */
async function withoutTheEntry(m, { toVacantCanvas, getProxied }) {
  for (const rawPath of ["/canvas", "/canvas/api/projects"]) {
    const res = await request(toVacantCanvas, rawPath);
    m.report.check(
      `M-a GET ${rawPath} -> 500 (the rule points at a vacant port)`,
      res.status === 500,
      `status ${res.status}`,
    );
  }
  const health = await request(getProxied, "/api/health");
  m.report.check(
    "M-a GET /api/health without a session -> 401 (the notebook itself works)",
    health.status === 401,
    `status ${health.status}`,
  );
  return true;
}

/** M-full: neither the entry nor the target. */
async function withoutBoth(m, { toVacantCanvas, getWeb }) {
  const canvas = await request(toVacantCanvas, "/canvas");
  m.report.check(
    "M-full GET /canvas -> 404",
    canvas.status === 404,
    `status ${canvas.status}`,
  );
  const home = await request(getWeb, "/");
  m.report.check(
    "M-full GET / -> 200",
    home.status === 200,
    `status ${home.status}`,
  );
  return true;
}

/** Build 2: without CANVAS_PROXY_TARGET, today's two rules only. */
async function secondBuild(m) {
  const { sandbox, report } = m;
  resetRuntime(m);
  removeNext(sandbox, m.frontend);
  const rebuilt = await m.build({ BACKEND_PROXY_TARGET: m.api }, "m-build-2", {
    envFile: false,
  });
  if (
    !report.check(
      "M build 2 without CANVAS_PROXY_TARGET exits 0",
      rebuilt.status === 0,
      () => tail(rebuilt.output),
    )
  )
    return false;
  const manifest = readManifest(m.frontend, sandbox.readFile);
  const rules = expectRewrites(
    report,
    "M build 2 holds today's two rules only",
    manifest,
    todaysRules(m.api),
  );
  const destinations = expectDestinations(
    report,
    "M build 2 every rewrite destination is the run's api port",
    manifest,
    [m.api],
  );
  return rules && destinations;
}

/** M-b: the plugin kept, the build without the target. */
async function targetlessRun(m) {
  const { sandbox, report } = m;
  const run = await launchClone(m, "M-b", "managed");
  let stopInfo = { launch: run.launch };
  try {
    if (!run.up) return false;
    const service = await managedService(m, run);
    stopInfo = service.stopInfo;
    const { canvasPid } = service;
    if (
      !report.check(
        `M-b silicon-notebook starts the canvas (state ready within 90 s of the launch${service.readyAfter === undefined ? "" : `, first seen after ${(service.readyAfter / 1000).toFixed(1)} s`}; the supervisor, the worker and the canvas port's listener verified)`,
        service.readyAfter !== undefined &&
          !service.readyProblem &&
          service.supervisorPid > 0 &&
          service.workerPid > 0 &&
          service.companionProblems.length === 0 &&
          canvasPid > 0 &&
          !service.canvasProblem,
        () =>
          `${[service.readyProblem, ...service.companionProblems, service.canvasProblem].filter(Boolean).join("; ")}; state ${JSON.stringify(service.state)}, listeners [${service.listeners}]`,
      )
    )
      return false;
    await probing(m, "M-b", async () => {
      const direct = await request(
        ownershipGate(sandbox, m.canvasPort, canvasPid),
        READY,
      );
      report.check(
        "M-b the canvas's ready probe on its own port -> 200",
        direct.status === 200,
        `status ${direct.status}`,
      );
      const through = await request(
        throughCanvas(m, run.up, canvasPid),
        "/canvas",
      );
      report.check(
        "M-b GET /canvas through web -> 404 (the canvas runs, unreachable)",
        through.status === 404,
        `status ${through.status}`,
      );
      return true;
    });
    return true;
  } finally {
    run.stopWatch?.();
    await stopAll(m, "M-b", stopInfo);
  }
}
