import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import {
  BLOCK_ROLES,
  describeCircuit,
  llmResultToPartition,
  PARTITION_SYSTEM_PROMPT,
  PROMPT_VERSION,
} from "../packages/auto-layout/dist/partition-prompt.js";
import { parseFingerprintLibrary } from "../packages/auto-layout/dist/fingerprint.js";
import { parseProject } from "../packages/project-protocol/dist/index.js";
import {
  builtInSymbols,
  createProjectSymbolResolver,
} from "../packages/symbols/dist/index.js";

// `deepseek-flash` mirrors silicon-notebook's `general` model service: the OpenAI
// protocol, with the key read from the environment and never stored here.
const PROVIDERS = {
  "deepseek-flash": {
    protocol: "openai",
    model: "deepseek-flash",
    baseURL: "https://api.deepseek.com",
    apiKeyEnv: "SYSTEM_GENERAL_API_KEY",
    usdPerMTok: [0.28, 1.12], // Peak-hour rate, so the budget errs high.
  },
  "claude-opus-5-5": {
    protocol: "anthropic",
    model: "claude-opus-5-5",
    usdPerMTok: [4, 20],
  },
};
const PROVIDER =
  PROVIDERS[process.env.LLM_PARTITION_PROVIDER ?? "deepseek-flash"];
if (!PROVIDER) throw new Error("Unknown LLM_PARTITION_PROVIDER");
export const MODEL = PROVIDER.model;
// Thinking counts toward this limit, and a truncated answer would fail only the
// largest circuits, biasing the experiment.
const MAX_TOKENS = 32000;
const CACHE_DIRECTORY = "tmp/llm-partition";
const schema = z
  .object({
    blocks: z.array(
      z
        .object({
          id: z.string().min(1),
          title: z.string(),
          role: z.enum(BLOCK_ROLES),
          units: z.array(z.string()),
          reason: z.string(),
        })
        .strict(),
    ),
    uncertain: z.array(z.string()),
  })
  .strict();

export function cacheKey(payload, sample = 0, anonymize = false) {
  return createHash("sha256")
    .update(JSON.stringify([payload, PROMPT_VERSION, MODEL, sample, anonymize]))
    .digest("hex");
}
export function readCachedPartition(
  payload,
  sample = 0,
  anonymize = false,
  cacheDirectory = CACHE_DIRECTORY,
) {
  const path = join(
    cacheDirectory,
    `${cacheKey(payload, sample, anonymize)}.json`,
  );
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : undefined;
}
/** Read only shape-valid cached proposals; missing and failed samples remain visible. */
export function cachedSamples(
  document,
  resolver,
  count = 3,
  anonymize = false,
  cacheDirectory = CACHE_DIRECTORY,
  entries = [],
) {
  const payload = describeCircuit(document, resolver, anonymize, entries);
  const samples = [];
  const statuses = [];
  for (let sample = 0; sample < count; sample++) {
    const entry = readCachedPartition(
      payload,
      sample,
      anonymize,
      cacheDirectory,
    );
    const parsed = entry && schema.safeParse(entry.output);
    const valid =
      entry &&
      ["valid-first-try", "repaired"].includes(entry.status) &&
      parsed.success;
    statuses.push({
      sample,
      status: !entry ? "missing" : valid ? entry.status : "failed",
    });
    if (valid) samples.push(parsed.data);
  }
  return { samples, entries: statuses };
}

/** Inject into the layout entry; API use must be explicitly enabled by the caller. */
export function createPartitioner({
  cacheDirectory = CACHE_DIRECTORY,
  allowApi = false,
  provider,
  concurrency,
  maxUsd,
  entries = [],
} = {}) {
  return async ({ system, payload, sample, anonymize }) => {
    const entry = allowApi
      ? (
          await runPartitionJobs(
            [{ system, payload, sample, anonymize, entries }],
            {
              provider,
              cacheDirectory,
              concurrency,
              maxUsd,
            },
          )
        ).results[0]
      : readCachedPartition(payload, sample, anonymize, cacheDirectory);
    const parsed = entry && schema.safeParse(entry.output);
    return entry &&
      ["valid-first-try", "repaired"].includes(entry.status) &&
      parsed.success
      ? parsed.data
      : undefined;
  };
}

const usageCost = (usage) =>
  (usage.input_tokens * PROVIDER.usdPerMTok[0] +
    usage.output_tokens * PROVIDER.usdPerMTok[1]) /
  1_000_000;
const inputMessage = (payload) =>
  `<circuit-data>\n${JSON.stringify(payload)}\n</circuit-data>`;

/** Carries only a status: a response body may echo the request or a credential. */
class ProviderError extends Error {
  constructor(status) {
    super("Provider request failed");
    this.status = status;
  }
}
const FINISH_REASONS = {
  stop: "end_turn",
  length: "max_tokens",
  content_filter: "refusal",
};
const blockText = (content) =>
  typeof content === "string"
    ? content
    : content
        .filter((c) => c.type === "text")
        .map((c) => c.text)
        .join("");

/** Adapts an OpenAI-protocol service to the scheduler's request and response. */
export function openaiProvider(config = PROVIDER, fetchImpl = fetch) {
  return async (request) => {
    const key = process.env[config.apiKeyEnv];
    if (!key) throw new ProviderError("no credential");
    // JSON mode only guarantees JSON; the shape is checked by the same schema.
    const body = JSON.stringify({
      model: config.model,
      max_tokens: request.max_tokens,
      thinking: { type: "enabled" },
      reasoning_effort: "high",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: request.system },
        ...request.messages.map((m) => ({
          role: m.role,
          content: blockText(m.content),
        })),
      ],
    });
    const attempts = 3;
    for (let attempt = 1; ; attempt++) {
      let response;
      try {
        response = await fetchImpl(`${config.baseURL}/chat/completions`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${key}`,
          },
          body,
          signal: AbortSignal.timeout(600_000),
        });
      } catch {
        if (attempt >= attempts) throw new ProviderError("connection");
        await new Promise((done) => setTimeout(done, 2000 * attempt));
        continue;
      }
      if (response.ok) {
        const data = await response.json();
        const choice = data.choices[0];
        return {
          content: [{ type: "text", text: choice.message.content ?? "" }],
          usage: {
            input_tokens: data.usage.prompt_tokens,
            output_tokens: data.usage.completion_tokens,
          },
          stop_reason:
            FINISH_REASONS[choice.finish_reason] ?? choice.finish_reason,
          model: data.model,
        };
      }
      const retryable =
        [408, 409, 429].includes(response.status) || response.status >= 500;
      if (!retryable || attempt >= attempts)
        throw new ProviderError(response.status);
      await new Promise((done) => setTimeout(done, 2000 * attempt));
    }
  };
}

// The only network boundary. Dry runs and imports never construct a client.
function sdkProvider() {
  if (PROVIDER.protocol === "openai") return openaiProvider();
  const client = new Anthropic({ logLevel: "off" });
  // Streaming keeps a long high-effort answer clear of request timeouts.
  return (request) => client.beta.messages.stream(request).finalMessage();
}

export function validateCachedResult(document, resolver, entry, entries = []) {
  const parsed = schema.safeParse(entry.output);
  if (!parsed.success)
    return {
      errors: parsed.error.issues.map(
        (i) => `${i.path.join(".")}: ${i.message}`,
      ),
    };
  // Prepared-payload jobs only validate the wire schema. The layout entry
  // reconciles their answers together, against its original document and units.
  return document
    ? llmResultToPartition(document, resolver, parsed.data, entries)
    : { errors: [], l0Merges: 0 };
}

/** Shared scheduler for CLI and offline fake-provider tests. Samples are zero-based. */
export async function runPartitionJobs(
  jobs,
  {
    provider,
    cacheDirectory = CACHE_DIRECTORY,
    concurrency = 6,
    maxUsd = Infinity,
  } = {},
) {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1 || !(maxUsd >= 0))
    throw new Error("Invalid concurrency or budget");
  let spent = 0,
    next = 0;
  const results = new Array(jobs.length);
  const pending = new Map();
  const run = async (job) => {
    const {
      document,
      resolver,
      sample = 0,
      anonymize = false,
      entries = [],
    } = job;
    const payload =
      job.payload ?? describeCircuit(document, resolver, anonymize, entries);
    const key = cacheKey(payload, sample, anonymize);
    const cached = readCachedPartition(
      payload,
      sample,
      anonymize,
      cacheDirectory,
    );
    if (cached) return { ...cached, cached: true };
    if (pending.has(key)) return pending.get(key);
    const execute = async () => {
      const entry = {
        status: "failed",
        attempts: [],
        output: null,
        usage: { input_tokens: 0, output_tokens: 0 },
        stop_reason: null,
        model: null,
        costUsd: 0,
        l0Merges: 0,
      };
      const messages = [{ role: "user", content: inputMessage(payload) }];
      for (let attempt = 0; attempt < 2; attempt++) {
        // Calls already in flight can overshoot; no call (including a repair)
        // starts once completed responses have exhausted the running budget.
        if (spent >= maxUsd) {
          entry.errors = ["Budget exhausted"];
          if (!entry.attempts.length) return { ...entry, status: "budget" };
          break;
        }
        let response;
        try {
          provider ??= sdkProvider();
          response = await provider({
            model: MODEL,
            max_tokens: MAX_TOKENS,
            betas: ["server-side-fallback-2026-07-01"],
            fallbacks: "default",
            output_config: { effort: "high", format: zodOutputFormat(schema) },
            system: job.system ?? PARTITION_SYSTEM_PROMPT,
            messages: structuredClone(messages),
          });
        } catch (error) {
          // Do not persist error messages, headers, request objects or stacks:
          // SDK errors can contain credentials or server-echoed request data.
          entry.errors = [
            error instanceof ProviderError ||
            error instanceof Anthropic.APIError
              ? `API error (${error.status ?? "connection"})`
              : error instanceof Anthropic.AnthropicError
                ? "SDK error"
                : "Provider error",
          ];
          // Never cache a call that got no answer: a credential or rate-limit
          // problem must not read as this circuit's result on the next run.
          return { ...entry, status: "unavailable" };
        }
        const usage = {
          input_tokens: response.usage.input_tokens,
          output_tokens: response.usage.output_tokens,
        };
        const cost = usageCost(usage);
        spent += cost;
        entry.costUsd += cost;
        entry.usage.input_tokens += usage.input_tokens;
        entry.usage.output_tokens += usage.output_tokens;
        entry.stop_reason = response.stop_reason;
        entry.model = response.model;
        // Keep every attempt's serving model, stop reason, usage and exact content
        // for audit and for the unchanged assistant turn on the one repair.
        entry.attempts.push({
          content: response.content,
          usage,
          stop_reason: response.stop_reason,
          model: response.model,
        });
        if (response.stop_reason !== "end_turn") {
          entry.errors = [`Stopped: ${response.stop_reason}`];
          // A refusal is this circuit's answer and is cached. An output limit or
          // a provider-specific stop such as an overload is not: leave it
          // uncached, so the next run asks again.
          if (response.stop_reason !== "refusal")
            return { ...entry, status: "unavailable" };
          break;
        }
        try {
          entry.output = JSON.parse(
            response.content
              .filter((c) => c.type === "text")
              .map((c) => c.text)
              .join(""),
          );
        } catch {
          entry.output = null;
        }
        const validated = validateCachedResult(
          document,
          resolver,
          entry,
          entries,
        );
        entry.errors = validated.errors;
        entry.attempts.at(-1).errors = validated.errors;
        if (!validated.errors.length) {
          entry.status = attempt ? "repaired" : "valid-first-try";
          entry.l0Merges = validated.l0Merges;
          break;
        }
        messages.push(
          { role: "assistant", content: response.content },
          {
            role: "user",
            content: `Repair the JSON once, addressing these validation errors:\n${JSON.stringify(validated.errors)}`,
          },
        );
      }
      mkdirSync(cacheDirectory, { recursive: true });
      writeFileSync(
        join(cacheDirectory, `${key}.json`),
        JSON.stringify(entry, null, 2),
      );
      return entry;
    };
    const promise = execute();
    pending.set(key, promise);
    return promise;
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, jobs.length) }, async () => {
      while (next < jobs.length) {
        const index = next++;
        results[index] = await run(jobs[index]);
      }
    }),
  );
  return { results, costUsd: spent };
}

async function main(args) {
  const [folder, ...rest] = args;
  if (!folder)
    throw new Error(
      "Usage: auto-layout-llm-partition.mjs <folder> [--split dev|val] [--limit n] [--samples n] [--anonymize] [--max-usd n] [--concurrency n] [--dry-run] [--library path]",
    );
  const flags = new Map();
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    if (["--anonymize", "--dry-run"].includes(flag)) flags.set(flag, true);
    else if (
      [
        "--library",
        "--split",
        "--limit",
        "--samples",
        "--max-usd",
        "--concurrency",
      ].includes(flag) &&
      rest[i + 1] !== undefined
    )
      flags.set(flag, rest[++i]);
    else throw new Error(`Unknown or incomplete option: ${flag}`);
  }
  const samples = Number(flags.get("--samples") ?? 1);
  const limit = Number(flags.get("--limit") ?? Number.MAX_SAFE_INTEGER);
  const concurrency = Number(flags.get("--concurrency") ?? 6);
  const maxUsd = Number(flags.get("--max-usd") ?? Infinity);
  if (
    ![samples, limit, concurrency].every(
      (n) => Number.isSafeInteger(n) && n > 0,
    ) ||
    !(maxUsd >= 0) ||
    (flags.has("--split") && !["dev", "val"].includes(flags.get("--split")))
  )
    throw new Error("Invalid split, count or budget");
  const library = parseFingerprintLibrary(
    JSON.parse(
      readFileSync(
        flags.get("--library") ??
          new URL(
            "../packages/auto-layout/fingerprint-library.json",
            import.meta.url,
          ),
        "utf8",
      ),
    ),
  );
  const files = readdirSync(folder)
    .filter((f) => f.endsWith(".json") && !f.endsWith(".meta.json"))
    .sort()
    .filter((file) => {
      const split =
        BigInt(
          `0x${createHash("sha256").update(file.slice(0, -5)).digest("hex")}`,
        ) %
          3n ===
        0n
          ? "val"
          : "dev";
      return !flags.has("--split") || flags.get("--split") === split;
    })
    .slice(0, limit);
  const jobs = files.flatMap((file) => {
    const project = parseProject(readFileSync(join(folder, file), "utf8"));
    const document = project.documents.find(
      (d) => d.id === project.topDocumentId,
    );
    if (!document) throw new Error("Top Document missing");
    const resolver = createProjectSymbolResolver(project, builtInSymbols);
    return Array.from({ length: samples }, (_, sample) => ({
      document,
      resolver,
      sample,
      anonymize: flags.has("--anonymize"),
      entries: library.entries,
    }));
  });
  const estimates = jobs.map((job) => {
    const payload = describeCircuit(
      job.document,
      job.resolver,
      job.anonymize,
      job.entries,
    );
    const bytes = Buffer.byteLength(JSON.stringify(payload));
    const cached = !!readCachedPartition(payload, job.sample, job.anonymize);
    // Heuristic only: 4 bytes/token, up to MAX_TOKENS output, two attempts.
    // Includes a repeated assistant output on repair, but is not a hard cap.
    const inputTokens = Math.ceil(
      (bytes + Buffer.byteLength(PARTITION_SYSTEM_PROMPT)) / 4,
    );
    return {
      bytes,
      cached,
      estimatedUsd: cached
        ? 0
        : usageCost({
            input_tokens: inputTokens * 2 + MAX_TOKENS,
            output_tokens: MAX_TOKENS * 2,
          }),
    };
  });
  console.log(
    JSON.stringify({
      jobs: jobs.length,
      payloadBytes: estimates.reduce((s, e) => s + e.bytes, 0),
      cached: estimates.filter((e) => e.cached).length,
      estimatedUsd: estimates.reduce((s, e) => s + e.estimatedUsd, 0),
      estimate: "4 bytes/token, two attempts at output limit; not a cap",
    }),
  );
  if (flags.has("--dry-run")) return;
  const result = await runPartitionJobs(jobs, { concurrency, maxUsd });
  console.log(
    JSON.stringify({
      costUsd: result.costUsd,
      statuses: result.results.map((r) => r.status),
      errors: [...new Set(result.results.flatMap((r) => r.errors ?? []))].slice(
        0,
        10,
      ),
    }),
  );
  if (
    result.results.some((r) =>
      ["failed", "budget", "unavailable"].includes(r.status),
    )
  )
    process.exitCode = 1;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  await main(process.argv.slice(2)).catch((error) => {
    // Only the error class: its message may carry private input.
    console.error(
      `Partition run failed (${error?.name ?? "unknown"}); check input folder, options and local build.`,
    );
    process.exitCode = 1;
  });
}
