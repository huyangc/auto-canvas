import { readFileSync } from "node:fs";
import type { CircuitProject } from "@icm/model";
import {
  assembleNativeExecutionOutput,
  type ExecutionInput,
} from "@icm/simulation-service";
import { routeSimulationRequest } from "../../../../worker/simulation";
import {
  nativeEnvironment,
  nativeWorkerEnv,
} from "../../../../worker/simulation.test-fixture";

const dividerSource = readFileSync(
  new URL("../../../../netlists/vacask-divider/divider.sim", import.meta.url),
  "utf8",
).replace(/  sweep supply[\s\S]*?endc/u, "endc");
const dividerRawfile = readFileSync(
  new URL(
    "../../../../netlists/vacask-divider/divider_op.raw",
    import.meta.url,
  ),
  "utf8",
);

/** A native divider operating point, as an Agent authors it. */
export function dividerFiles() {
  return [
    {
      path: "experiment.json",
      text: JSON.stringify({
        version: 2,
        environment: { profileId: nativeEnvironment.profileId },
      }),
    },
    { path: "main.sim", text: dividerSource },
  ];
}

/** The same divider saved in the Project as a simulation folder. */
export function dividerFolder(
  id: string,
  name: string,
): CircuitProject["simulationFolders"][number] {
  return {
    id,
    name,
    version: 4,
    input: {
      kind: "source",
      entry: "main.sim",
      configPath: "experiment.json",
      circuitBindings: [],
      files: dividerFiles(),
      dependencies: [],
    },
  };
}

/**
 * The executor's answer for one run, assembled from a captured divider run,
 * or, `failed`, from VACASK exiting on a source it could not run.
 */
async function capturedDividerRun(input: ExecutionInput, failed = false) {
  const output = await assembleNativeExecutionOutput(
    input,
    {
      execution: {
        stdout: failed
          ? ""
          : "Running analysis 'divider_op'.\n  Elapsed time: 0.001\n",
        stderr: failed ? "Error: unknown model 'rbad'.\n" : "",
        exitCode: failed ? 1 : 0,
        signal: null,
        timedOut: false,
        cancelled: false,
        spawnError: null,
        durationMs: 1,
      },
      timeoutMs: 1000,
      rawfiles: failed
        ? []
        : [{ path: "divider_op.raw", text: dividerRawfile }],
      executedFiles: input.files,
      diagnostics: [],
      truncated: false,
    },
    nativeEnvironment,
  );
  return Response.json({
    ...output.result,
    rawfiles: output.rawfiles,
    executedFiles: output.executedFiles,
    cancelled: output.cancelled,
  });
}

/**
 * The hosted simulation service the editor calls over the network: the
 * Worker's own route, whose native executor answers with a captured divider
 * run. Only this side is scripted; the editor's Simulation resource is real.
 */
export class HostedSimulationService {
  executions = 0;
  maxActive = 0;
  private active = 0;
  private gate: Promise<void> = Promise.resolve();
  private open = () => {};
  private repliesLost = false;
  private failures = 0;

  /** The next execution fails as VACASK does on a source it cannot run. */
  failNext(): void {
    this.failures++;
  }

  /** Executions started from now on wait for release(). */
  hold(): void {
    this.gate = new Promise((resolve) => {
      this.open = resolve;
    });
  }

  release(): void {
    this.open();
  }

  /** From now on, an execution's reply never reaches the editor. */
  loseReplies(): void {
    this.repliesLost = true;
  }

  readonly fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    const gate = this.gate;
    // Capability and cancel requests name an operation; executions do not.
    const execution = !(
      "operation" in (JSON.parse(String(init?.body)) as object)
    );
    const response = await routeSimulationRequest(
      new Request(new URL(String(url), "http://localhost"), init),
      nativeWorkerEnv(async (target, run) => {
        if (new URL(target).pathname === "/cancel")
          return Response.json({ accepted: true });
        this.executions++;
        this.maxActive = Math.max(this.maxActive, ++this.active);
        const failed = this.failures > 0;
        if (failed) this.failures--;
        try {
          await gate;
          return await capturedDividerRun(
            JSON.parse(String(run?.body)),
            failed,
          );
        } finally {
          this.active--;
        }
      }),
    );
    if (execution && this.repliesLost) throw new TypeError("fetch failed");
    return response!;
  }) as typeof fetch;
}
