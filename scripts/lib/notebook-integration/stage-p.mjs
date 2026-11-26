// Stage P exercises the documented package commands. Package scripts run
// only inside site/, with no build checkout or host Node on their PATH.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import {
  checkManagedService,
  checkRoutes,
  checkStoppedServices,
  createDatabases,
  hex,
  managedState,
  observedLaunch,
  parsed,
  projectTextBuilder,
  readState,
  request,
  runExtensionStop,
  runManagedStage,
  throughCanvas,
  tomlVariants,
  vacant,
} from "./managed-clone.mjs";
import { awaitLaunch, groupOf, stopLaunch } from "./notebook-clone.mjs";
import { buildPackages, checkedCommand, oneFile } from "./package-build.mjs";
import {
  browserSessions,
  checkEntry,
  checkEntryAbsent,
  createNotebook,
  webGate,
} from "./stage-l.mjs";
import {
  listProblem,
  projectList,
  reopenedProblem,
  signedInUsers,
} from "./stage-m.mjs";
import { guardLoaded, offlineVerdict, StageAborted } from "./steps.mjs";

// The checks themselves use the host's SQL and browser clients. Site command
// lookup contains only these system utilities, even on hosts with /usr/bin/node.
function siteEnvironment(m, site) {
  const bin = path.join(site, "bin");
  m.sandbox.makeDir(bin);
  const utilities =
    "bash sh env tar gzip gunzip dirname basename mkdir cp rm mv ls head tail cat mktemp sleep seq pkill ps nproc sysctl uname id chmod tr sed awk cut getconf readlink realpath wc sort which find touch date";
  for (const tool of utilities.split(" ")) {
    const source = ["/usr/bin", "/bin", "/usr/sbin", "/sbin"]
      .map((dir) => path.join(dir, tool))
      .find((file) => fs.existsSync(file));
    if (source) fs.symlinkSync(source, path.join(bin, tool));
  }
  return m.sandbox.env(
    {
      PATH: bin,
      PYTHON_BIN: m.options.python,
      PIP_NO_INDEX: "1",
      PIP_CONFIG_FILE: "/dev/null",
      PIP_DISABLE_PIP_VERSION_CHECK: "1",
      OFFLINE: "1",
    },
    { envFile: false },
  );
}

function requireCheck(m, label, condition, detail) {
  if (!m.report.check(label, condition, detail)) throw new StageAborted(label);
}

// Prefix reused M and L check names verbatim so regressions can be compared.
function phaseState(m, phase) {
  const report = { ...m.report };
  for (const method of ["check", "ok", "fail", "info", "note"]) {
    report[method] = (name, ...args) =>
      m.report[method](
        name.startsWith(phase) ? name : `${phase} ${name}`,
        ...args,
      );
  }
  return { ...m, report };
}

async function unpack(m, archive, directory) {
  m.sandbox.makeDir(directory);
  m.sandbox.assertRealFile(archive);
  await checkedCommand(
    m,
    `unpack-${path.basename(directory)}`,
    "tar",
    ["-xzf", archive, "-C", directory, "--strip-components=1"],
    { cwd: m.site, env: m.siteEnv },
  );
}

function siteCommand(m, name, command, args = [], env = {}, refusal) {
  return checkedCommand(
    m,
    name,
    command,
    args,
    { cwd: m.nb, env: { ...m.siteEnv, ...env } },
    refusal,
  );
}

async function install(m, archive) {
  await unpack(m, archive, m.nb);
  await siteCommand(m, "install", "./install.sh");
  // Edit the installer's example. Keep the notebook's own SQLite and storage
  // under .local, so P3 and P4 actually exercise the upgrader's preservation.
  let env = m.sandbox.readFile(m.envFile, "utf8");
  const password = hex(16);
  m.secrets.push(password);
  for (const [key, value] of Object.entries({
    DATABASE_URL: "sqlite:///.local/silicon_notebook.db",
    NEXT_PUBLIC_API_BASE_URL: "/api",
    SILICON_NOTEBOOK_ADMIN_PASSWORD: password,
    MODEL_SERVICES_CONFIG: "",
  })) {
    const pattern = new RegExp(`^${key}=.*$`, "gmu");
    if (env.match(pattern)?.length !== 1)
      throw new Error(`expected one ${key} in the installed .env`);
    env = env.replace(pattern, `${key}=${value}`);
  }
  m.sandbox.writeFile(
    m.envFile,
    env + `\nPORT=${m.apiPort}\nFRONTEND_PORT=${m.webPort}\n`,
    0o600,
  );
}

async function configurePair(m, archive) {
  const { sandbox, nb, canvas } = m;
  await unpack(m, archive, canvas);
  const wheels = path.join(canvas, "wheels");
  const wheel = oneFile(sandbox, wheels, (f) =>
    /^silicon_notebook_auto_canvas-.*\.whl$/u.test(f),
  );
  await siteCommand(m, "install-plugin", ".venv/bin/python", [
    "-m",
    "pip",
    "--isolated",
    "install",
    "--no-index",
    "--find-links",
    wheels,
    wheel,
  ]);
  const node = path.join(nb, "node/bin/node");
  const toml = tomlVariants({
    ...m,
    logFile: path.join(sandbox.root, "canvas.log"),
    canvasRoot: canvas,
    node,
  });
  sandbox.writeFile(m.tomlFile, toml.managed);
  const env = sandbox.readFile(m.envFile, "utf8");
  // Single quoted literals are read identically by bash and the canvas guard.
  if ([m.canvasUrl, m.tomlFile].some((v) => /['\r\n]/u.test(v)))
    throw new Error("site path cannot be represented in the literal .env");
  sandbox.writeFile(
    m.envFile,
    env +
      `AUTO_CANVAS_DATABASE_URL='${m.canvasUrl}'\nEXTENSIONS_CONFIG='${m.tomlFile}'\n`,
    0o600,
  );
  await siteCommand(
    m,
    "init-canvas-database",
    path.join(canvas, "integrations/silicon-notebook/init-db.sh"),
    ["--notebook-root", nb],
    { AUTO_CANVAS_NODE: node, AUTO_CANVAS_DATABASE_URL: m.canvasUrl },
  );
  m.editorIndex = sandbox.readFile(
    path.join(canvas, "apps/editor/dist-notebook/index.html"),
    "utf8",
  );
  m.contribution = JSON.parse(
    sandbox.readFile(
      path.join(
        canvas,
        "integrations/silicon-notebook/ui/auto-canvas/ui-plugin.json",
      ),
      "utf8",
    ),
  ).contributions[0];
}

// Normal stop uses the package's own pidfile-based command. Only call it
// while its pidfiles still name the services in our launcher's group.
async function stopPackage(m, phase, run, stopInfo) {
  const { sandbox } = m;
  for (const [name, pid] of run.launch.services) {
    const recorded = Number(
      sandbox.readFile(path.join(m.nb, ".local/run", name + ".pid"), "utf8"),
    );
    requireCheck(
      m,
      `${phase} the ${name} pidfile names the launched process`,
      pid === recorded && groupOf(pid) === run.launch.launcher.pgid,
      "refusing stop.sh with an unverified pidfile",
    );
  }
  await siteCommand(m, `${phase}-stop`, "./stop.sh");
  const watched = [
    ...run.launch.services.map(([, pid]) => pid),
    ...(stopInfo?.canvasPids ?? []),
  ];
  // Check what stop.sh accomplished before releasing the process group.
  const ended = await checkStoppedServices(
    m,
    phase,
    watched.filter((pid) => pid > 0),
    stopInfo?.canvasGroup,
  );
  const stopped = await stopLaunch({
    sandbox,
    report: m.report,
    label: phase,
    launch: run.launch,
  });
  if (!ended || !stopped) throw new StageAborted(`${phase} package stop`);
  m.launched = false;
}

async function runningPackage(m, phase, paired, probe) {
  const { sandbox, nb } = m;
  if (!checkRoutes(m, path.join(nb, "frontend"), phase, paired))
    throw new StageAborted("installed routes");
  const mark = sandbox.guardMark();
  const since = Date.now();
  const ports = paired
    ? [m.apiPort, m.webPort, m.canvasPort]
    : [m.apiPort, m.webPort];
  requireCheck(
    m,
    `${phase} the packaged ports are vacant before start`,
    ports.every((port) => vacant(m, port)),
    "a configured port is already occupied",
  );
  const launcher = sandbox.start("./start.sh", [], {
    cwd: nb,
    name: `${phase}-start`,
    env: m.siteEnv,
  });
  m.groups.push(launcher.pgid);
  m.launched = true;
  const launch = { launcher, services: [] };
  const awaitUp = () => awaitLaunch({ ...m, label: phase, launch });
  const observed = paired
    ? await observedLaunch({ launch: awaitUp, read: () => readState(m), since })
    : { up: await awaitUp() };
  const run = { ...observed, launch, mark, launchedAt: since };
  if (!run.up) throw new StageAborted(`${phase} package launch`);
  let stopInfo;
  try {
    if (
      !guardLoaded(
        sandbox,
        m.report,
        `${phase} packaged frontend loaded the offline guard`,
        mark,
        (entry) => entry.pid === run.up.frontendPid,
      )
    )
      throw new StageAborted(`${phase} frontend guard`);
    let canvasPid = null;
    if (paired) {
      const { service, ok } = await checkManagedService(m, run, `${phase} M2`);
      stopInfo = service.stopInfo;
      if (!ok) throw new StageAborted(`${phase} managed service`);
      canvasPid = service.canvasPid;
    }
    return await probe(phaseState(m, phase), run.up, canvasPid);
  } finally {
    run.stopWatch?.();
    sandbox.ensureOpen(`${phase} stop`);
    await stopPackage(m, phase, run, stopInfo);
  }
}

async function defaultResponses(m, up) {
  const ready = await request(up.getProxied, "/api/ready");
  requireCheck(
    m,
    "GET /api/ready -> 200",
    ready.status === 200,
    `status ${ready.status}`,
  );
  const canvas = await request(throughCanvas(m, up, null), "/canvas");
  requireCheck(
    m,
    "GET /canvas -> notebook HTML 404",
    canvas.status === 404 &&
      /text\/html/iu.test(canvas.headers["content-type"]),
    `status ${canvas.status}`,
  );
}

async function login(m, up, a) {
  const res = await request(up.getProxied, "/api/auth/login", {
    method: "POST",
    json: { username: a.username, password: a.password },
  });
  const body = parsed(res);
  if (body?.token) m.secrets.push(body.token);
  requireCheck(
    m,
    "A signs in again as the original notebook user",
    res.status === 200 && body?.user?.id === a.id && body.token,
    `status ${res.status}`,
  );
  return { ...a, token: body.token };
}

async function sitePhases(m, packages, browsers) {
  m.siteEnv = siteEnvironment(m, m.site);
  m.tomlFile = path.join(m.nb, ".local/extensions.toml");
  m.canvas = path.join(m.site, "companion");
  m.extensionStop = (label, timeoutMs) =>
    runExtensionStop({
      ...m,
      python: path.join(m.nb, ".venv/bin/python"),
      env: m.siteEnv,
      label,
      timeoutMs,
    });
  m.report.note("P1 site phase begins (offline)");
  await install(m, packages.default);
  await runningPackage(m, "P1", false, defaultResponses);
  m.sandbox.removePath(m.nb);

  await install(m, packages.canvas);
  if (!(await createDatabases(m))) return;
  await configurePair(m, packages.companion);
  const paired = await runningPackage(m, "P2", true, async (phase, up, pid) => {
    const flow = await signedInUsers(phase, {
      getCanvas: throughCanvas(m, up, pid),
      getProxied: up.getProxied,
    });
    if (!flow) throw new StageAborted("P2 two-user flow");
    const user = await createNotebook(
      phase,
      up.getProxied,
      await login(phase, up, flow.a),
    );
    if (
      !user ||
      !(await checkEntry(
        phase,
        browsers,
        webGate(m, up, pid),
        user,
        m.contribution,
        "P2 L4",
      ))
    )
      throw new StageAborted("P2 browser entry");
    return { ...flow, user };
  });

  const next = path.join(m.site, "new-notebook");
  await unpack(m, packages["canvas-next"], next);
  const target = ["--target", m.nb];
  const upgrade = path.join(next, "upgrade.sh");
  await siteCommand(
    m,
    "P3-upgrade-refuses-missing-plugin-wheels",
    upgrade,
    target,
    {},
    /额外安装的包或插件[^\n]*--extra-wheelhouse/u,
  );
  await siteCommand(m, "P3-upgrade", upgrade, [
    ...target,
    "--extra-wheelhouse",
    path.join(m.canvas, "wheels"),
  ]);
  requireCheck(
    m,
    "P3 the installed release matches canvas-next",
    m.sandbox.readFile(path.join(m.nb, "VERSION"), "utf8") ===
      m.sandbox.readFile(path.join(next, "VERSION"), "utf8"),
    "installed VERSION differs from the upgrade source",
  );
  await runningPackage(m, "P3", true, async (phase, up, pid) => {
    const user = await login(phase, up, paired.user);
    const getCanvas = throughCanvas(m, up, pid);
    const list = projectList(
      await request(getCanvas, "/canvas/api/projects", user),
      phase.report.clean,
    );
    const why = listProblem(list, { holds: [paired.projectId] });
    requireCheck(phase, "A's project is still listed", !why, why);
    const reopened = reopenedProblem(
      await request(
        getCanvas,
        `/canvas/api/projects/${paired.projectId}`,
        user,
      ),
      paired.saved,
    );
    requireCheck(
      phase,
      "A reopens the saved revision and schematic",
      !reopened,
      reopened,
    );
    if (
      !(await checkEntry(
        phase,
        browsers,
        webGate(m, up, pid),
        user,
        m.contribution,
        "P3 L4",
      ))
    )
      throw new StageAborted("P3 browser entry");
  });

  m.sandbox.writeFile(m.tomlFile, "# Canvas removed\n");
  await siteCommand(m, "P4-uninstall-plugin", ".venv/bin/python", [
    "-m",
    "pip",
    "uninstall",
    "-y",
    "silicon-notebook-auto-canvas",
  ]);
  const fallback = path.join(m.site, "default-notebook");
  await unpack(m, packages.default, fallback);
  await siteCommand(m, "P4-upgrade", path.join(fallback, "upgrade.sh"), target);
  requireCheck(
    m,
    "P4 the installed release matches default",
    m.sandbox.readFile(path.join(m.nb, "VERSION"), "utf8") ===
      m.sandbox.readFile(path.join(fallback, "VERSION"), "utf8"),
    "installed VERSION differs from the rollback source",
  );
  await runningPackage(m, "P4", false, async (phase, up) => {
    await defaultResponses(phase, up);
    const user = await login(phase, up, paired.user);
    const notebooks = await request(up.getProxied, "/api/notebooks", user);
    const rows = parsed(notebooks);
    requireCheck(
      phase,
      "A sees the notebook created in P2",
      notebooks.status === 200 &&
        Array.isArray(rows) &&
        rows.some(
          (n) => n.id === user.notebookId && n.name === user.notebookName,
        ),
      `status ${notebooks.status}`,
    );
    await checkEntryAbsent(
      phase,
      browsers,
      webGate(m, up, null),
      user,
      null,
      "P4",
    );
    const project = await m.withClient(m.canvasUrl, (client) =>
      client.query("SELECT name, revision FROM cloud_projects WHERE id = $1", [
        paired.projectId,
      ]),
    );
    requireCheck(
      phase,
      "canvas database retains A's saved project",
      project.rows[0]?.name === paired.saved.name &&
        project.rows[0]?.revision === paired.saved.revision,
      "saved project missing or changed",
    );
  });
}

export async function stageP(context) {
  await runManagedStage(context, async (ctx) => {
    const site = path.join(ctx.sandbox.root, "site");
    const m = managedState({
      ...ctx,
      stage: "P",
      nb: path.join(site, "notebook"),
    });
    m.site = site;
    const browsers = browserSessions(m);
    m.cleanupSteps.push((ms) => browsers.closeOpen(ms));
    m.sandbox.beforeDispose(m.cleanup);
    try {
      const inbox = path.join(site, "archives");
      m.sandbox.makeDir(inbox, { recursive: true });
      // Resolve a PATH name on the build host before switching to site PATH.
      m.options.python = execFileSync(
        m.options.python,
        [
          "-c",
          "import sys; assert sys.version_info >= (3, 13), 'stage P needs Python 3.13+'; print(sys.executable)",
        ],
        { env: m.sandbox.env(), encoding: "utf8", timeout: 10_000 },
      ).trim();
      m.makeProject = await projectTextBuilder();
      const packages = await buildPackages(m, inbox);
      if (packages) {
        try {
          await sitePhases(m, packages, browsers);
        } finally {
          offlineVerdict(m.sandbox, m.report);
        }
      }
    } finally {
      await m.cleanup();
      if (fs.existsSync(m.sandbox.root)) {
        const disk = execFileSync("du", ["-sk", m.sandbox.root], {
          encoding: "utf8",
        }).split(/\s+/u)[0];
        m.report.info(
          `stage P took ${m.elapsed()}; final sandbox size ${disk} KiB (external cache excluded)`,
        );
      }
    }
  });
}
