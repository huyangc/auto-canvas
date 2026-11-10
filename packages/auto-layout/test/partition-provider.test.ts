import { spawnSync } from "node:child_process";
import { createEmptyProject } from "@icm/model";
import { serializeProject } from "@icm/project-protocol";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
// These scheduler tests assert one provider's model name and prices.
vi.hoisted(() => {
  process.env.LLM_PARTITION_PROVIDER = "claude-opus-5-5";
});
// The CLI is JavaScript; exercise its real scheduler with an injected provider.
// @ts-expect-error The standalone script does not publish TypeScript declarations.
import * as runner from "../../../scripts/auto-layout-llm-partition.mjs";
import { circuit } from "./document-fixture.js";

// Resolve the pure implementation from source, including in a fresh checkout.
vi.mock(
  "../dist/partition-prompt.js",
  () => import("../src/partition-prompt.js"),
);
const { cacheKey, runPartitionJobs } = runner;
const resolver = new InMemorySymbolResolver(builtInSymbols);
const document = circuit(
  { a: "resistor", b: "resistor" },
  { link: ["a.2", "b.1"] },
);
const job = { document, resolver };
const answer = {
  blocks: [
    {
      id: "signal",
      title: "Signal",
      role: "gain",
      units: ["U1", "U2"],
      reason: "series network",
    },
  ],
  uncertain: [],
};
const response = (output: unknown = answer, stop_reason = "end_turn") => ({
  content: [
    {
      type: "thinking",
      thinking: "synthetic reasoning",
      signature: "test-signature",
    },
    { type: "text", text: JSON.stringify(output) },
  ],
  usage: { input_tokens: 100, output_tokens: 200 },
  stop_reason,
  model: "synthetic-serving-model",
});
const dirs: string[] = [];
const cache = () => {
  const dir = mkdtempSync(join(tmpdir(), "partition-fake-"));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

it("repairs once with unchanged assistant content and records both attempts and serving model", async () => {
  const bad = response({
    ...answer,
    blocks: [{ ...answer.blocks[0], units: "invalid" }],
  });
  const provider = vi
    .fn()
    .mockResolvedValueOnce(bad)
    .mockResolvedValueOnce(response());
  const result = await runPartitionJobs([job], {
    provider,
    cacheDirectory: cache(),
  });
  expect(provider).toHaveBeenCalledTimes(2);
  const first = provider.mock.calls[0]![0],
    repair = provider.mock.calls[1]![0];
  expect(first).toMatchObject({
    model: "claude-opus-5-5",
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "high", format: { type: "json_schema" } },
  });
  for (const key of ["temperature", "thinking", "budget_tokens", "tool_choice"])
    expect(first).not.toHaveProperty(key);
  expect(first.messages[0].content).toContain("<circuit-data>");
  expect(repair.messages[1]).toEqual({
    role: "assistant",
    content: bad.content,
  });
  expect(repair.messages[2].content).toContain("blocks.0.units");
  expect(result.results[0]).toMatchObject({
    status: "repaired",
    model: "synthetic-serving-model",
    stop_reason: "end_turn",
    usage: { input_tokens: 200, output_tokens: 400 },
  });
  expect(result.results[0].attempts).toHaveLength(2);
  expect(result.costUsd).toBeCloseTo(0.0088);
});
it.each([
  ["refusal", "failed"],
  ["max_tokens", "unavailable"],
])("records %s as %s without parsing or repairing", async (stop, status) => {
  const provider = vi.fn().mockResolvedValue(response(answer, stop));
  const result = await runPartitionJobs([job], {
    provider,
    cacheDirectory: cache(),
  });
  expect(provider).toHaveBeenCalledTimes(1);
  expect(result.results[0]).toMatchObject({
    status,
    stop_reason: stop,
    output: null,
  });
});
it("records a double validation failure and continues to the next document", async () => {
  const provider = vi
    .fn()
    .mockResolvedValueOnce(response({}))
    .mockResolvedValueOnce(response({}))
    .mockResolvedValueOnce(response());
  const result = await runPartitionJobs([job, { ...job, sample: 1 }], {
    provider,
    concurrency: 1,
    cacheDirectory: cache(),
  });
  expect(result.results.map((r: { status: string }) => r.status)).toEqual([
    "failed",
    "valid-first-try",
  ]);
  expect(provider).toHaveBeenCalledTimes(3);
});
it("never requests cached successes or failures and separates samples and anonymous payloads", async () => {
  const provider = vi.fn().mockResolvedValue(response());
  const cacheDirectory = cache();
  await runPartitionJobs([job], { provider, cacheDirectory });
  provider.mockClear();
  const hit = await runPartitionJobs([job], {
    provider,
    cacheDirectory,
    maxUsd: 0,
  });
  expect(provider).not.toHaveBeenCalled();
  expect(hit.results[0].cached).toBe(true);
  expect(hit.costUsd).toBe(0);
  provider.mockResolvedValue(response(answer, "refusal"));
  await runPartitionJobs([{ ...job, sample: 1 }], { provider, cacheDirectory });
  provider.mockClear();
  expect(
    (
      await runPartitionJobs([{ ...job, sample: 1 }], {
        provider,
        cacheDirectory,
      })
    ).results[0].status,
  ).toBe("failed");
  expect(provider).not.toHaveBeenCalled();
  expect(
    new Set([
      cacheKey({}, 0, false),
      cacheKey({}, 1, false),
      cacheKey({}, 0, true),
      cacheKey({ other: true }, 0, false),
    ]).size,
  ).toBe(4);
});
it.each(["max_tokens", "insufficient_system_resource"])(
  "does not cache a response that stopped for %s, so the next run asks again",
  async (reason) => {
    const provider = vi
      .fn()
      .mockResolvedValueOnce(response(answer, reason))
      .mockResolvedValueOnce(response());
    const cacheDirectory = cache();
    const first = await runPartitionJobs([job], { provider, cacheDirectory });
    expect(first.results[0]).toMatchObject({
      status: "unavailable",
      errors: [`Stopped: ${reason}`],
    });
    // The spent tokens still count toward the budget.
    expect(first.costUsd).toBeGreaterThan(0);
    const second = await runPartitionJobs([job], { provider, cacheDirectory });
    expect(second.results[0].status).toBe("valid-first-try");
    expect(provider).toHaveBeenCalledTimes(2);
  },
);
it("stops starting new calls at budget, including repair, without poisoning unstarted caches", async () => {
  const provider = vi.fn().mockResolvedValue(response());
  const cacheDirectory = cache();
  const jobs = [job, { ...job, sample: 1 }, { ...job, sample: 2 }];
  const result = await runPartitionJobs(jobs, {
    provider,
    cacheDirectory,
    concurrency: 1,
    maxUsd: 0.001,
  });
  expect(provider).toHaveBeenCalledTimes(1);
  expect(result.results.map((r: { status: string }) => r.status)).toEqual([
    "valid-first-try",
    "budget",
    "budget",
  ]);
  expect(readdirSync(cacheDirectory)).toHaveLength(1);
  provider.mockClear().mockResolvedValue(response({}));
  const repair = await runPartitionJobs([{ ...job, sample: 1 }], {
    provider,
    cacheDirectory,
    maxUsd: 0.001,
  });
  expect(provider).toHaveBeenCalledTimes(1);
  expect(repair.results[0]).toMatchObject({
    status: "failed",
    errors: ["Budget exhausted"],
  });
});
it("coalesces concurrent identical keys and honors the concurrency limit", async () => {
  let active = 0,
    peak = 0;
  const provider = vi.fn(async () => {
    active++;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active--;
    return response();
  });
  const jobs = [
    job,
    job,
    ...Array.from({ length: 4 }, (_, sample) => ({
      ...job,
      sample: sample + 1,
    })),
  ];
  await runPartitionJobs(jobs, {
    provider,
    cacheDirectory: cache(),
    concurrency: 2,
  });
  expect(provider).toHaveBeenCalledTimes(5);
  expect(peak).toBe(2);
});
it("never writes credentials or provider error objects", async () => {
  const secret = "synthetic-credential-never-persist";
  const previous = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = secret;
  const cacheDirectory = cache();
  try {
    const provider = vi
      .fn()
      .mockRejectedValue(new Error(`Authorization: ${secret}`));
    const result = await runPartitionJobs([job], { provider, cacheDirectory });
    expect(result.results[0]).toMatchObject({
      status: "unavailable",
      errors: ["Provider error"],
    });
    // A call with no answer is never cached, so the next run retries it.
    expect(readdirSync(cacheDirectory)).toEqual([]);
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(JSON.stringify(provider.mock.calls)).not.toContain(secret);
    const retry = vi.fn().mockRejectedValue(new Error("still down"));
    await runPartitionJobs([job], { provider: retry, cacheDirectory });
    expect(retry).toHaveBeenCalledTimes(1);
  } finally {
    if (previous === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = previous;
  }
});

it("runs dry-run, rule fallback, cached V1 and report while refusing LLM V2", async () => {
  const directory = cache();
  const folder = join(directory, "cases");
  mkdirSync(folder);
  const d = structuredClone(document);
  d.instances.forEach((i, n) => {
    i.placement = {
      position: { x: n * 400, y: 0 },
      rotation: 0,
      mirror: "none",
    };
  });
  const project = createEmptyProject("synthetic", "Synthetic", d.id);
  project.documents = [d];
  writeFileSync(join(folder, "synthetic.json"), serializeProject(project));
  const cli = (script: string, args: string[]) =>
    spawnSync(process.execPath, [resolve("scripts", script), folder, ...args], {
      cwd: directory,
      encoding: "utf8",
    });
  const dry = cli("auto-layout-llm-partition.mjs", ["--dry-run"]);
  expect(dry.status, dry.stderr).toBe(0);
  expect(JSON.parse(dry.stdout)).toMatchObject({ jobs: 1, cached: 0 });
  const missing = cli("auto-layout-eval.mjs", ["--partition", "llm"]);
  expect(missing.status, missing.stderr).toBe(0);
  const readReport = (variant: string) =>
    JSON.parse(
      readFileSync(
        join(
          directory,
          `tmp/auto-layout-eval/${variant}-llm-3-samples-3/report.json`,
        ),
        "utf8",
      ),
    );
  expect(readReport("v1").cases[0]).toMatchObject({
    status: "completed",
    partitionValidity: { status: "rule-only" },
    partitionStatistics: { samples: 0, ruleOnly: true },
  });
  const output = {
    blocks: [
      {
        id: "first",
        title: "Synthetic <input>",
        role: "input",
        units: ["U1"],
        reason: "input",
      },
      {
        id: "second",
        title: "Synthetic output",
        role: "output",
        units: ["U2"],
        reason: "output",
      },
    ],
    uncertain: [],
  };
  await runPartitionJobs([{ document: d, resolver }], {
    provider: vi.fn().mockResolvedValue(response(output)),
    cacheDirectory: join(directory, "tmp/llm-partition"),
  });
  const v1 = cli("auto-layout-eval.mjs", [
    "--partition",
    "llm",
    "--variant",
    "v1",
  ]);
  expect(v1.status, v1.stderr).toBe(0);
  const first = readReport("v1").cases[0];
  expect(first).toMatchObject({
    status: "completed",
    equivalent: true,
    partitionValidity: { status: "reconciled" },
    partitionMetrics: { floorplanAgreement: null },
  });
  const svg = readFileSync(
    join(
      directory,
      "tmp/auto-layout-eval/v1-llm-3-samples-3/synthetic-result.svg",
    ),
    "utf8",
  );
  expect(svg).toContain("Synthetic &lt;input&gt; · other");
  const v2 = cli("auto-layout-eval.mjs", [
    "--partition",
    "llm",
    "--variant",
    "v2",
    "--block-boxes",
    "off",
  ]);
  expect(v2.status).toBe(1);
  expect(v2.stderr).toContain("LLM partitions have no floorplan");
  const report = cli("auto-layout-partition-report.mjs", ["--samples", "0"]);
  expect(report.status, report.stderr).toBe(0);
  const reportData = JSON.parse(
    readFileSync(
      join(directory, "tmp/auto-layout-partition/report.json"),
      "utf8",
    ),
  );
  expect(reportData.cases[0]).toMatchObject({
    status: "completed",
    statistics: { ruleOnly: true, llmCoverage: 0 },
  });
  expect(
    readFileSync(
      join(directory, "tmp/auto-layout-partition/index.html"),
      "utf8",
    ),
  ).toContain("#6b7280");
  // An unplaced device leaves no human-drawing reference, but the cached LLM
  // partition (the payload ignores placement) still lays out.
  const unplaced = structuredClone(d);
  unplaced.instances[1]!.placement = null;
  project.documents = [unplaced];
  writeFileSync(join(folder, "synthetic.json"), serializeProject(project));
  const netlistOnly = cli("auto-layout-eval.mjs", [
    "--partition",
    "llm",
    "--variant",
    "v1",
  ]);
  expect(netlistOnly.status, netlistOnly.stderr).toBe(0);
  expect(readReport("v1").cases[0]).toMatchObject({
    status: "completed",
    partitionMetrics: null,
    partitionValidity: { status: "reconciled" },
  });
  // With a LOADBench reference the positions are importer-made: no human
  // metrics or human SVG, but ARI against the XML partition remains.
  project.documents = [d];
  writeFileSync(join(folder, "synthetic.json"), serializeProject(project));
  writeFileSync(
    join(folder, "synthetic.partitioning.xml"),
    '<gmPart type="firstStage"><device name="a"/></gmPart><loadPart><device name="b"/></loadPart>',
  );
  // Earlier runs in this test wrote a human SVG here; start the check clean.
  rmSync(join(directory, "tmp/auto-layout-eval/v1-llm-3-samples-3"), {
    recursive: true,
    force: true,
  });
  const referenced = cli("auto-layout-eval.mjs", [
    "--partition",
    "llm",
    "--variant",
    "v1",
  ]);
  expect(referenced.status, referenced.stderr).toBe(0);
  const lb = readReport("v1").cases[0];
  expect(lb).toMatchObject({
    status: "completed",
    hasHuman: false,
    human: null,
    partitionMetrics: { ari: 1, humanOverlap: null, floorplanAgreement: null },
  });
  expect(
    readdirSync(join(directory, "tmp/auto-layout-eval/v1-llm-3-samples-3")),
  ).not.toContain("synthetic-human.svg");
}, 30_000);

const openai = {
  model: "m",
  baseURL: "https://example.test",
  apiKeyEnv: "T027_TEST_KEY",
};
const reply = (body: object, status = 200) =>
  ({ ok: status < 400, status, json: async () => body }) as unknown as Response;
const request = {
  max_tokens: 100,
  system: "sys",
  messages: [
    { role: "user", content: "hello" },
    { role: "assistant", content: [{ type: "text", text: "{}" }] },
  ],
};

it("maps an OpenAI-protocol answer onto the scheduler's response", async () => {
  process.env.T027_TEST_KEY = "synthetic-key";
  try {
    const fetchImpl = vi.fn().mockResolvedValue(
      reply({
        model: "served",
        choices: [{ message: { content: '{"a":1}' }, finish_reason: "length" }],
        usage: { prompt_tokens: 3, completion_tokens: 4 },
      }),
    );
    const result = await runner.openaiProvider(openai, fetchImpl)(request);
    expect(result).toEqual({
      content: [{ type: "text", text: '{"a":1}' }],
      usage: { input_tokens: 3, output_tokens: 4 },
      stop_reason: "max_tokens",
      model: "served",
    });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://example.test/chat/completions");
    const sent = JSON.parse(init.body);
    expect(sent.response_format).toEqual({ type: "json_object" });
    expect(sent.messages.map((m: { content: string }) => m.content)).toEqual([
      "sys",
      "hello",
      "{}",
    ]);
  } finally {
    delete process.env.T027_TEST_KEY;
  }
});

it("reports only a status for provider failures and needs a credential", async () => {
  delete process.env.T027_TEST_KEY;
  const none = vi.fn();
  await expect(
    runner.openaiProvider(openai, none)(request),
  ).rejects.toMatchObject({ status: "no credential" });
  expect(none).not.toHaveBeenCalled();
  process.env.T027_TEST_KEY = "synthetic-key";
  try {
    const denied = vi.fn().mockResolvedValue(reply({ echoed: "secret" }, 401));
    const error = await runner
      .openaiProvider(
        openai,
        denied,
      )(request)
      .catch((e: Error) => e);
    expect(error).toMatchObject({ status: 401 });
    expect(JSON.stringify(error)).not.toContain("secret");
    expect(String((error as Error).message)).not.toContain("synthetic-key");
    expect(denied).toHaveBeenCalledTimes(1);
  } finally {
    delete process.env.T027_TEST_KEY;
  }
});
