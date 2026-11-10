import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { format, resolveConfig } from "prettier";
import { cachedSamples } from "./auto-layout-llm-partition.mjs";
import {
  blockFingerprint,
  matchFingerprints,
  parseFingerprintLibrary,
} from "../packages/auto-layout/dist/fingerprint.js";
import { reconcilePartition } from "../packages/auto-layout/dist/partition-reconcile.js";
import { partitionBounds } from "../packages/auto-layout/dist/partition-geometry.js";
import { isMarker } from "../packages/auto-layout/dist/placement-connectivity.js";
import { parseProject } from "../packages/project-protocol/dist/index.js";
import {
  builtInSymbols,
  createProjectSymbolResolver,
} from "../packages/symbols/dist/index.js";
import {
  buildSvgScene,
  renderDocumentSvg,
} from "../packages/render-svg/dist/index.js";

const MIN_CONFIDENCE = 0.6;
const MIN_DEVICES = 2;
const MAX_DEVICES = 16;
const MIN_DOCUMENTS = 2;
const MIN_ROLE_SHARE = 0.6;
const MIN_PRECISION = 0.8;
const OUTPUT = "tmp/fingerprints";
const LIBRARY = fileURLToPath(
  new URL("../packages/auto-layout/fingerprint-library.json", import.meta.url),
);
const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const escape = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

/** Aggregate reconciled blocks; document keys and examples never leave tmp/. */
export function aggregateFingerprints(records, matcherOptions) {
  const groups = new Map();
  for (const { documentKey, document, resolver, partition } of records) {
    for (const block of partition.blocks) {
      if (
        block.provenance !== "llm" ||
        block.confidence < MIN_CONFIDENCE ||
        block.members.length < MIN_DEVICES ||
        block.members.length > MAX_DEVICES ||
        block.unitIds.length <= 1
      )
        continue;
      const fingerprint = blockFingerprint(document, resolver, block.members);
      const group = groups.get(fingerprint.hash) ?? {
        ...fingerprint,
        documents: new Set(),
        occurrences: 0,
        titles: new Map(),
        roles: new Map(),
        examples: [],
      };
      group.documents.add(documentKey);
      group.occurrences++;
      group.titles.set(block.title, (group.titles.get(block.title) ?? 0) + 1);
      group.roles.set(block.role, (group.roles.get(block.role) ?? 0) + 1);
      group.examples.push({ document: documentKey, members: block.members });
      groups.set(fingerprint.hash, group);
    }
  }
  const ranked = (counts) =>
    [...counts].sort((a, b) => b[1] - a[1] || compare(a[0], b[0]));
  const fingerprints = [...groups.values()]
    .map((g) => {
      const [role, count] = ranked(g.roles)[0];
      return {
        hash: g.hash,
        canonical: g.canonical,
        title: ranked(g.titles)[0][0],
        role,
        documents: g.documents.size,
        occurrences: g.occurrences,
        titles: Object.fromEntries(ranked(g.titles)),
        roles: Object.fromEntries(ranked(g.roles)),
        roleShare: count / g.occurrences,
        examples: g.examples.sort(
          (a, b) =>
            compare(a.document, b.document) ||
            compare(JSON.stringify(a.members), JSON.stringify(b.members)),
        ),
      };
    })
    .sort((a, b) => compare(a.hash, b.hash));
  const documents = [
    ...new Map(records.map((r) => [r.documentKey, r])).values(),
  ];
  const evaluated = fingerprints
    .filter(
      (g) => g.documents >= MIN_DOCUMENTS && g.roleShare >= MIN_ROLE_SHARE,
    )
    .map((candidate) => {
      let matchedDocuments = 0,
        matchedOccurrences = 0,
        matchedAsBlock = 0,
        matchedIntact = 0;
      const budgetExhaustedDocuments = [];
      for (const { documentKey, document, resolver, partition } of documents) {
        const result = matchFingerprints(
          document,
          resolver,
          [candidate],
          matcherOptions,
        );
        if (result.matches.length) matchedDocuments++;
        matchedOccurrences += result.matches.length;
        for (const { deviceIds } of result.matches) {
          const containing = partition.blocks.filter((block) =>
            deviceIds.every((id) => block.members.includes(id)),
          );
          if (containing.length) matchedIntact++;
          if (
            containing.some(
              (block) =>
                block.members.length === deviceIds.length &&
                ["llm", "attached"].includes(block.provenance),
            )
          )
            matchedAsBlock++;
        }
        if (result.budgetExhausted) budgetExhaustedDocuments.push(documentKey);
      }
      return {
        ...candidate,
        matchedDocuments,
        matchedOccurrences,
        matchedAsBlock,
        matchedIntact,
        precision: matchedOccurrences ? matchedAsBlock / matchedOccurrences : 0,
        budgetExhaustedDocuments,
      };
    })
    .sort(
      (a, b) =>
        b.precision - a.precision ||
        b.matchedDocuments - a.matchedDocuments ||
        b.documents - a.documents ||
        compare(a.hash, b.hash),
    );
  return {
    version: 1,
    fingerprints,
    candidates: evaluated.filter((c) => c.precision >= MIN_PRECISION),
    rejected: evaluated.filter((c) => c.precision < MIN_PRECISION),
  };
}

/** Explicit promotion is the only tracked write; validate everything before writing. */
export async function promoteFingerprints(
  hashes,
  approvedBy,
  candidatePath = join(OUTPUT, "candidates.json"),
  libraryPath = LIBRARY,
) {
  if (
    !approvedBy?.trim() ||
    !hashes.length ||
    new Set(hashes).size !== hashes.length
  )
    throw new Error(
      "Promotion requires distinct hashes and --approved-by <name>",
    );
  const { candidates } = JSON.parse(readFileSync(candidatePath, "utf8"));
  const library = parseFingerprintLibrary(
    JSON.parse(readFileSync(libraryPath, "utf8")),
  );
  for (const hash of hashes) {
    const candidate = candidates.find((c) => c.hash === hash);
    if (
      !candidate ||
      candidate.documents < MIN_DOCUMENTS ||
      candidate.roleShare < MIN_ROLE_SHARE ||
      !(candidate.precision >= MIN_PRECISION)
    )
      throw new Error(`Not a qualifying candidate: ${hash}`);
    library.entries.push({
      hash,
      canonical: candidate.canonical,
      title: candidate.title,
      role: candidate.role,
      approvedBy: approvedBy.trim(),
      sources: {
        documents: candidate.documents,
        occurrences: candidate.occurrences,
        roles: candidate.roles,
      },
    });
  }
  parseFingerprintLibrary(library);
  writeFileSync(
    libraryPath,
    await format(JSON.stringify(library), {
      ...(await resolveConfig(libraryPath)),
      parser: "json",
    }),
  );
  return library;
}

function drawingFor(record, members) {
  const { document, resolver } = record;
  if (!document.instances.filter((i) => !isMarker(i)).every((i) => i.placement))
    return "<p>No human drawing available.</p>";
  const box = buildSvgScene(document, resolver).viewBox;
  const x = Math.floor(box.x),
    y = Math.floor(box.y);
  const drawing = renderDocumentSvg(document, resolver, {
    bounds: {
      x,
      y,
      width: Math.ceil(box.x + box.width) - x,
      height: Math.ceil(box.y + box.height) - y,
    },
  });
  const overlays = partitionBounds(document, resolver, {
    blocks: [{ id: "example", members }],
  })
    .filter((b) => Number.isFinite(b.x))
    .map(
      (b) =>
        `<rect x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}" fill="#7c3aed" fill-opacity="0.12" stroke="#7c3aed" stroke-width="3"/>`,
    )
    .join("");
  return drawing.replace("</svg>", `${overlays}</svg>`);
}

export function mineFingerprints(folders, samples) {
  const records = [],
    failures = [],
    seen = new Set();
  for (const folder of folders) {
    for (const file of readdirSync(folder)
      .filter((f) => f.endsWith(".json") && !f.endsWith(".meta.json"))
      .sort()) {
      const documentKey = resolve(folder, file);
      if (seen.has(documentKey)) continue;
      seen.add(documentKey);
      try {
        const project = parseProject(readFileSync(documentKey, "utf8"));
        const document = project.documents.find(
          (d) => d.id === project.topDocumentId,
        );
        if (!document) throw new Error("Top Document missing");
        const resolver = createProjectSymbolResolver(project, builtInSymbols);
        // Evaluate against the LLM's base partition, without forced templates.
        const cached = cachedSamples(document, resolver, samples, false);
        const result = reconcilePartition(document, resolver, cached.samples);
        records.push({
          documentKey,
          document,
          resolver,
          ...result,
          cache: cached.entries,
        });
      } catch (error) {
        failures.push({ document: documentKey, error: String(error) });
      }
    }
  }
  const result = {
    ...aggregateFingerprints(records),
    samples,
    documents: records.length,
    failures,
    cache: records.map((r) => ({ document: r.documentKey, entries: r.cache })),
  };
  mkdirSync(OUTPUT, { recursive: true });
  writeFileSync(
    join(OUTPUT, "candidates.json"),
    JSON.stringify(result, null, 2) + "\n",
  );
  const sections = (candidates, drawings) =>
    candidates
      .map(
        (c) =>
          `<section><h2>${escape(c.title)} · ${escape(c.role)}</h2><p>${c.documents} documents; ${c.occurrences} occurrences; matcher: ${c.matchedDocuments} documents, ${c.matchedOccurrences} occurrences; matched as LLM/attached block: ${c.matchedAsBlock}; matched intact: ${c.matchedIntact}; precision ${(c.precision * 100).toFixed(1)}%; budget exhausted in ${c.budgetExhaustedDocuments.length} documents (counts may be partial); dominant role ${(c.roleShare * 100).toFixed(1)}%</p><pre>${escape(JSON.stringify({ hash: c.hash, titles: c.titles, roles: c.roles, canonical: JSON.parse(c.canonical) }, null, 2))}</pre>${(drawings
            ? c.examples
            : []
          )
            .map(
              (example) =>
                `<h3>${escape(example.document)}</h3><p>${escape(example.members.join(", "))}</p>${drawingFor(
                  records.find((r) => r.documentKey === example.document),
                  example.members,
                )}`,
            )
            .join("")}</section>`,
      )
      .join("");
  writeFileSync(
    join(OUTPUT, "index.html"),
    `<!doctype html><html><head><meta charset="utf-8"><title>Fingerprint candidates</title><style>body{font:14px system-ui;margin:24px}svg{max-width:100%;height:auto}pre{white-space:pre-wrap}section{border-top:1px solid #ccc}</style></head><body><h1>Fingerprint candidates</h1><p>${records.length} documents; ${result.candidates.length} candidates; ${result.rejected.length} rejected; ${failures.length} failures.</p>${sections(result.candidates, true)}<h1>Rejected: precision below ${MIN_PRECISION * 100}%</h1>${sections(result.rejected, false)}<pre>${escape(JSON.stringify(failures, null, 2))}</pre></body></html>`,
  );
  return result;
}

async function main(args) {
  const libraryAt = args.indexOf("--library");
  let libraryPath = LIBRARY;
  if (libraryAt >= 0) {
    if (!args[libraryAt + 1] || args[libraryAt + 1].startsWith("--"))
      throw new Error("Missing --library path");
    libraryPath = args[libraryAt + 1];
    args = [...args.slice(0, libraryAt), ...args.slice(libraryAt + 2)];
  }
  if (args[0] === "--promote") {
    const at = args.indexOf("--approved-by");
    if (at < 2 || at !== args.length - 2)
      throw new Error(
        "Usage: --promote <hash…> --approved-by <name> [--library path]",
      );
    await promoteFingerprints(
      args.slice(1, at),
      args[at + 1],
      undefined,
      libraryPath,
    );
    console.log("Promoted approved fingerprints");
    return;
  }
  const at = args.indexOf("--samples");
  const folders = at < 0 ? args : args.slice(0, at);
  const samples = at < 0 ? 3 : Number(args[at + 1]);
  if (
    !folders.length ||
    folders.some((f) => f.startsWith("--")) ||
    (at >= 0 && at !== args.length - 2) ||
    !Number.isSafeInteger(samples) ||
    samples < 0
  )
    throw new Error(
      "Usage: auto-layout-fingerprint-mine.mjs <folder…> [--samples k] [--library path]",
    );
  parseFingerprintLibrary(JSON.parse(readFileSync(libraryPath, "utf8")));
  const result = mineFingerprints(folders, samples);
  console.log(
    JSON.stringify({
      documents: result.documents,
      candidates: result.candidates.length,
      failures: result.failures.length,
      output: OUTPUT,
    }),
  );
  if (result.failures.length) process.exitCode = 1;
}
if (
  process.argv[1] &&
  existsSync(process.argv[1]) &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  await main(process.argv.slice(2));
