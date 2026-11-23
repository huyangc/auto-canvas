// Stage T: a real Next.js production server with the two canvas rules.
import path from "node:path";

import { modulesInClone, prepareModules } from "./modules.mjs";
import {
  checkStopped,
  guardLoaded,
  nextCommand,
  ownershipGate,
  OwnershipLost,
  ownershipHeld,
  StageAborted,
  startNext,
  stopServer,
  tail,
} from "./steps.mjs";
import { startStub, transportAssertions } from "./transport.mjs";

// One allowed path unit, and a segment of units (see the plan's Context).
const UNIT = String.raw`(?:[^/\\%.\x00-\x20\x7f]|%(?!2[eEfF]|5[cC]|[01][0-9a-fA-F]|20|7[fF]))`;
const SEGMENT =
  String.raw`\.*` + UNIT + "(?:" + UNIT + String.raw`|\.)*|\.{3,}`;

const nextConfig = `const segment = ${JSON.stringify(SEGMENT)};
const target = process.env.CHECK_TARGET;
export default {
  experimental: { proxyTimeout: 300_000 },
  async rewrites() {
    if (process.env.CHECK_RULES === "one")
      return [{ source: "/canvas/:path*", destination: target + "/@notebook/canvas/:path*" }];
    return [
      { source: "/canvas", destination: target + "/@notebook/canvas/" },
      { source: "/canvas/:path(" + segment + ")*", destination: target + "/@notebook/canvas/:path*" },
    ];
  },
};
`;

/**
 * The throwaway app's files. Written through the sandbox's validated writer
 * (R8-1): if a run's Next server replaced the app directory with a link, the
 * write is refused instead of landing wherever the link points.
 */
export function writeApp(sandbox, app, { config, marker }) {
  sandbox.makeDir(path.join(app, "pages"), { recursive: true });
  sandbox.writeFile(
    path.join(app, "package.json"),
    '{"name":"nb-check","private":true}\n',
  );
  sandbox.writeFile(
    path.join(app, "pages/index.js"),
    `export default function Home() { return <main>${marker}</main>; }\n`,
  );
  sandbox.writeFile(path.join(app, "next.config.mjs"), config);
}

/** The app's build output, removed through the sandbox's validated removal. */
export const removeAppNext = (sandbox, app) =>
  sandbox.removePath(path.join(app, ".next"));

/**
 * The private copy is validated before **every** use (R10-1): the preflight
 * before the first build, and this check before each build and each `next
 * start`. A copy that fails is a FAIL for this step and ends the stage, so no
 * later build or server runs from a copy an earlier one replaced or relinked.
 */
export function requireModules(sandbox, report, prefix, modules, when) {
  // A disposal has removed the copy already: this is an interrupt, not a
  // statement about the modules.
  sandbox.ensureOpen(`the private modules ${when}`);
  const problems = modulesInClone(sandbox, modules);
  const name = `${prefix}the private modules are usable ${when}`;
  if (!problems.length) return report.ok(name);
  report.fail(name, problems.slice(0, 10).join("; "));
  throw new StageAborted(`${name}: ${problems[0]}`);
}

export async function stageT({ sandbox, report, notebook }) {
  const app = path.join(sandbox.root, "app");
  const modules = path.join(app, "node_modules");
  const preflight = prepareModules(
    sandbox,
    path.join(notebook, "frontend", "node_modules"),
    modules,
  );
  if (preflight.problems.length) {
    report.fail(
      "private modules preflight",
      preflight.problems.slice(0, 10).join("; "),
    );
    return;
  }
  report.ok(
    `private modules preflight (next ${preflight.version}; native SWC ${preflight.loaded.join(", ")})`,
  );

  const marker = `nb-check-${sandbox.randomToken()}`;
  writeApp(sandbox, app, { config: nextConfig, marker });

  const configurations = [
    { label: "(i) two rules, 127.0.0.1", rules: "two", host: "127.0.0.1" },
    { label: "(ii) two rules, localhost", rules: "two", host: "localhost" },
    { label: "(iii) one rule, 127.0.0.1", rules: "one", host: "127.0.0.1" },
  ];
  for (const configuration of configurations) {
    const prefix = `T${configuration.label.split(" ")[0]} `;
    console.log(`-- ${configuration.label}`);
    const stubPort = await sandbox.freePort();
    const stub = await startStub(stubPort);
    const env = sandbox.env({
      CHECK_RULES: configuration.rules,
      CHECK_TARGET: `http://${configuration.host}:${stubPort}`,
    });
    let server;
    try {
      // R10-1: nothing runs from a copy that a previous build or server may
      // have replaced or relinked.
      requireModules(sandbox, report, prefix, modules, "before next build");
      removeAppNext(sandbox, app);
      const mark = sandbox.guardMark();
      const build = await sandbox.run(
        process.execPath,
        [path.join(modules, "next/dist/bin/next"), "build"],
        { cwd: app, env, name: "t-build" },
      );
      checkStopped(report, `${prefix}next build`, build.pgid, build.gone);
      // After an interrupt the sandbox is gone: nothing below means anything.
      sandbox.ensureOpen(`${prefix}checks after next build`);
      guardLoaded(
        sandbox,
        report,
        `${prefix}the offline guard was loaded in next build`,
        mark,
        nextCommand("build"),
      );
      // R6-3, R10-1: the build may not replace or relink the private modules,
      // and a copy that fails this check is never used again.
      requireModules(sandbox, report, prefix, modules, "after next build");
      if (
        !report.check(`${prefix}next build`, build.status === 0, () =>
          tail(build.output),
        )
      )
        continue;
      const nextPort = await sandbox.freePort();
      requireModules(sandbox, report, prefix, modules, "before next start");
      server = await startNext(sandbox, {
        dir: app,
        port: nextPort,
        env,
        name: "t-start",
        marker,
      });
      if (
        !report.check(
          `${prefix}next start serves the marker`,
          !server.error,
          () => server.error,
        )
      )
        continue;
      if (configuration.rules === "two") {
        const transportOk = await transportAssertions({
          nextPort,
          stub,
          report,
          prefix,
          owner: () => sandbox.listenerState(nextPort, server.pid),
        });
        // R10-3: the transport table stopped because the server no longer
        // owned its port. No further request is sent — the second gate only
        // blocks while the mismatch persists — and this configuration goes
        // straight to its cleanup.
        if (!transportOk) continue;
        if (configuration.host === "127.0.0.1") {
          // Every request to the port goes through the ownership gate (R8-2);
          // a port that changed hands is reported and the request is not sent.
          // The gate refuses before it sends, so its OwnershipLost is thrown
          // synchronously, not as a rejected promise: caught here, never a
          // stack trace through the stage.
          const get = ownershipGate(sandbox, nextPort, server.pid);
          await stub.close();
          let res;
          try {
            res = await get("/canvas");
          } catch (error) {
            if (error instanceof OwnershipLost) {
              report.fail(
                `${prefix}the server owned its port before the upstream-down request`,
                error.message,
              );
            } else res = { status: error.message };
          }
          if (res)
            report.check(
              `${prefix}GET /canvas with the upstream down -> 500`,
              res.status === 500,
              `status ${res.status}`,
            );
        }
      } else {
        await singleRuleControl({
          get: ownershipGate(sandbox, nextPort, server.pid),
          stub,
          report,
          prefix,
        });
      }
      ownershipHeld(
        sandbox,
        report,
        `${prefix}next start still owns its port after the last probe`,
        nextPort,
        server.pid,
      );
    } finally {
      // A server group that survived its shutdown ends the stage (R9-1): the
      // next configuration must not remove `.next` beside a live server. The
      // stub still closes, so nothing of this configuration holds a port.
      try {
        if (server)
          await stopServer(
            sandbox,
            report,
            `${prefix}next start`,
            server.handle,
          );
      } finally {
        await stub.close();
      }
    }
  }
}

/**
 * The negative control: one wildcard rule alone loops between Next and the
 * upstream. Every request is sent only while the server still owns its port
 * (R8-2); the first mismatch stops the control before another request.
 */
export async function singleRuleControl({ get, stub, report, prefix }) {
  let allOk = true;
  for (let round = 1; round <= 2; round += 1) {
    let slash;
    let bare;
    try {
      let mark = stub.records.length;
      slash = await get("/canvas/");
      const slashOk = report.check(
        `${prefix}round ${round}: GET /canvas/ -> 308 /canvas, not forwarded`,
        slash.status === 308 &&
          slash.headers.location === "/canvas" &&
          stub.records.length === mark,
        `status ${slash.status}, location ${slash.headers.location}, upstream ${stub.records.length - mark}`,
      );
      allOk = allOk && slashOk;
      mark = stub.records.length;
      bare = await get("/canvas");
      const fresh = stub.records.slice(mark);
      const bareOk = report.check(
        `${prefix}round ${round}: GET /canvas -> 308 /canvas/, upstream /@notebook/canvas`,
        bare.status === 308 &&
          bare.headers.location === "/canvas/" &&
          fresh.length === 1 &&
          fresh[0].url === "/@notebook/canvas",
        `status ${bare.status}, location ${bare.headers.location}, upstream ${JSON.stringify(fresh)}`,
      );
      allOk = allOk && bareOk;
    } catch (error) {
      if (!(error instanceof OwnershipLost)) throw error;
      report.fail(
        `${prefix}the server owned its port before every control request`,
        error.message,
      );
      return false;
    }
  }
  if (allOk) report.ok("control: single rule loops");
  return allOk;
}
