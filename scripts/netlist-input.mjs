#!/usr/bin/env node
/**
 * Netlist-only input for the auto-layout evaluation (T128): every drawing of a
 * corpus is exported with the product's design-netlist exporter, imported
 * again with the product's SPICE importer and the editor's import step, and
 * written as the Project the editor would open.
 *
 *   node scripts/netlist-input.mjs <corpus> --form vss|global [--out <dir>] [--jobs <n>]
 *
 * `vss` exports ground as a pin of the top subcircuit (the design export's
 * default, `groundPin: "pin"`); `global` keeps SPICE node 0. For each
 * `<id>.json` the output folder (default `tmp/netlist-input/<form>`) gets
 * `<id>.meta.json` always and, when the case converts, `<id>.sp` (the
 * exported netlist) and `<id>.json` (the netlist-input Project). Output is
 * sorted and has no timestamps, so it is byte-identical across runs and job
 * counts.
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  isMainThread,
  parentPort,
  Worker,
  workerData,
} from "node:worker_threads";

import { classifyNets } from "../packages/auto-layout/dist/net-roles.js";
import { touchingPins } from "../packages/auto-layout/dist/pin-contacts.js";
import { isMarker } from "../packages/auto-layout/dist/placement-connectivity.js";
import { resolveDocumentLogicalNets } from "../packages/derived/dist/index.js";
import {
  compareElectricalGraphs,
  createDesignNetlistExport,
  projectElectricalGraph,
} from "../packages/netlist/dist/index.js";
import { parseProject } from "../packages/project-protocol/dist/index.js";
import { importSpiceSources } from "../packages/spice/dist/index.js";
import {
  builtInSymbols,
  createProjectSymbolResolver,
} from "../packages/symbols/dist/index.js";

const FORMS = ["vss", "global"];
// The rail name patterns of packages/auto-layout/src/net-roles.ts, which does
// not export them.
const SUPPLY_NAME = /^(?:[ad]?vdd|vcc|vpwr|vpos|vplus|pwr)/iu;
const GROUND_NAME = /^(?:[ad]?vss|[ad]?gnd|vee|vgnd|vneg|ground)|^0$/iu;
const PORT_SYMBOLS = ["port", "port-filled"];

const topDocument = (project) =>
  project.documents.find((d) => d.id === project.topDocumentId);

/** Rail symbols, ports and labels drawn on a Document. */
export function markerCounts(document) {
  const symbols = (ids) =>
    document.instances.filter((i) => ids.includes(i.symbolId)).length;
  const annotations = (kind) =>
    document.annotations.filter((a) => a.kind === kind).length;
  return {
    ground: symbols(["ground"]),
    supply: symbols(["vdd-port", "vdd"]),
    ports: symbols(PORT_SYMBOLS),
    netLabels: annotations("net-label"),
    powerLabels: annotations("power-label"),
  };
}

/** What a Document presents beyond its netlist, as the meta file records it. */
function presentationCounts(document, resolver) {
  const logical = resolveDocumentLogicalNets(document);
  const members = new Map();
  for (const net of document.nets) {
    const id = logical.byBaseNetId.get(net.id)?.id ?? net.id;
    members.set(id, (members.get(id) ?? 0) + 1);
  }
  const terminals = document.netlist?.terminals ?? [];
  return {
    ...markerCounts(document),
    labelJoinedNets: [...members.values()].filter((count) => count > 1).length,
    // Contacts are only defined when every instance is placed.
    pinContacts: document.instances.every((i) => i.placement)
      ? touchingPins(document, resolver).length
      : 0,
    rails: classifyNets(document, resolver).rails.size,
    groundClaim: document.connectivityEvidence.some(
      (e) => e.kind === "name-claim" && e.powerDomain === "ground",
    ),
    supplyTerminals: terminals.filter((t) => SUPPLY_NAME.test(t.name)).length,
    groundTerminals: terminals.filter((t) => GROUND_NAME.test(t.name)).length,
  };
}

// Device names change on export (a subcircuit-called MOS gains an X prefix).
const deviceName = (instance) =>
  String(instance.reference ?? instance.id)
    .toLowerCase()
    .replace(/^x(?=[a-z])/u, "");

/** Netted device pins, `<device>.<PIN>`, by device name; markers and ports excluded. */
function nettedPins(document, resolver) {
  const roles = classifyNets(document, resolver);
  const pins = new Set();
  for (const instance of document.instances) {
    if (isMarker(instance) || PORT_SYMBOLS.includes(instance.symbolId))
      continue;
    for (const net of document.nets)
      for (const terminal of net.terminals)
        if (
          terminal.instanceId === instance.id &&
          roles.pinNet(instance.id, terminal.pinName)
        )
          pins.add(
            `${deviceName(instance)}.${String(terminal.pinName).toUpperCase()}`,
          );
  }
  return pins;
}

/** Pins of source devices that the import nets and the source does not. */
function pinsNettedOnlyInImport(source, sourceResolver, imported, resolver) {
  const before = nettedPins(source, sourceResolver);
  const devices = new Set(
    [...before].map((p) => p.slice(0, p.lastIndexOf("."))),
  );
  return [...nettedPins(imported, resolver)]
    .filter(
      (p) => devices.has(p.slice(0, p.lastIndexOf("."))) && !before.has(p),
    )
    .sort();
}

/** Cell terminal names only one side has, compared case-insensitively. */
function terminalChanges(source, imported) {
  const names = (d) => (d.netlist?.terminals ?? []).map((t) => t.name);
  const lower = (list) => new Set(list.map((n) => n.toLowerCase()));
  const a = lower(names(source)),
    b = lower(names(imported));
  return {
    added: [
      ...new Set(names(imported).filter((n) => !a.has(n.toLowerCase()))),
    ].sort(),
    lost: [
      ...new Set(names(source).filter((n) => !b.has(n.toLowerCase()))),
    ].sort(),
  };
}

// Cards in order-insensitive form: same cards in another order, or with the
// subcircuit pins in another order, are the same netlist.
const cards = (text) =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      if (!/^\.subckt/iu.test(line)) return line;
      const words = line.split(/\s+/u);
      return [...words.slice(0, 2), ...words.slice(2).sort()].join(" ");
    })
    .sort()
    .join("\n");

const errors = (diagnostics) =>
  diagnostics.filter((d) => d.severity === "error");
const codes = (diagnostics) =>
  [...new Set(diagnostics.map((d) => d.code))].sort();

/** A case that has not got past reading its Project. */
const emptyMeta = (id, form) => ({
  id,
  form,
  stage: "threw",
  errorCodes: [],
  warningCodes: [],
  message: null,
  reexport: null,
  electricalGraph: null,
  pinsNettedOnlyInImport: [],
  terminals: null,
  source: null,
  import: null,
});

/**
 * Converts one corpus Project. Returns the meta record and, when the case
 * converts, the exported netlist text and the netlist-input Project text.
 */
export async function convertProject(project, id, form, importStep) {
  if (!FORMS.includes(form)) throw new Error(`Unknown form ${form}`);
  const exportOptions = {
    format: "spice",
    groundPin: form === "vss" ? "pin" : "global",
  };
  const meta = emptyMeta(id, form);
  try {
    const source = topDocument(project);
    if (!source) throw new Error("Top Document missing");
    const sourceResolver = createProjectSymbolResolver(project, builtInSymbols);
    meta.source = {
      ...presentationCounts(source, sourceResolver),
      hiddenPinsExplicit: 0,
    };
    const exported = createDesignNetlistExport(project, exportOptions);
    if (exported.status !== "ready") {
      meta.stage = "export-blocked";
      meta.errorCodes = codes(errors(exported.diagnostics));
      meta.warningCodes = codes(
        exported.diagnostics.filter((d) => d.severity === "warning"),
      );
      meta.message = errors(exported.diagnostics)[0]?.message ?? null;
      return { meta };
    }
    const netlist = exported.file.text;
    // The editor's SPICE import (editor-file-commands.ts importSpiceFiles).
    const path = `${id}.sp`;
    const inputs = [{ path, bytes: new TextEncoder().encode(netlist) }];
    const prepared = importStep.prepareImportSources(inputs);
    const result = await importSpiceSources(
      prepared.inputs,
      path,
      {},
      {
        namingProfile: "native",
        originalSources: inputs,
        builtInBodies: prepared.builtInBodies,
      },
    );
    meta.warningCodes = codes(
      result.diagnostics.filter((d) => d.severity === "warning"),
    );
    if (!result.project || !result.successful) {
      meta.stage = "import-failed";
      meta.errorCodes = codes(errors(result.diagnostics));
      meta.message = errors(result.diagnostics)[0]?.message ?? null;
      return { meta, netlist };
    }
    const text = `${JSON.stringify(importStep.withImportedInstanceDisplays(result.project))}\n`;
    const imported = parseProject(text);
    const document = topDocument(imported);
    const resolver = createProjectSymbolResolver(imported, builtInSymbols);
    meta.pinsNettedOnlyInImport = pinsNettedOnlyInImport(
      source,
      sourceResolver,
      document,
      resolver,
    );
    meta.terminals = terminalChanges(source, document);
    meta.import = {
      ...presentationCounts(document, resolver),
      hiddenPinsExplicit: meta.pinsNettedOnlyInImport.length,
    };
    const before = projectElectricalGraph(project);
    const after = projectElectricalGraph(imported);
    meta.electricalGraph =
      before.status === "ready" && after.status === "ready"
        ? compareElectricalGraphs(before.graph, after.graph)
        : "uncheckable";
    const again = createDesignNetlistExport(imported, exportOptions);
    meta.reexport =
      again.status !== "ready"
        ? "blocked"
        : again.file.text === netlist
          ? "identical"
          : cards(again.file.text) === cards(netlist)
            ? "same-cards"
            : "differs";
    meta.stage = "converted";
    return { meta, netlist, project: text };
  } catch (error) {
    meta.stage = "threw";
    meta.message = String(error?.stack ?? error);
    return { meta };
  }
}

/** Counts of each value, as sorted `[value, count]` entries. */
function tally(values) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts].sort(
    (a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])),
  );
}

/** The coverage summary the command prints. */
function coverageSummary(metas) {
  const converted = metas.filter((m) => m.stage === "converted");
  return {
    cases: metas.length,
    stage: tally(metas.map((m) => m.stage)),
    exportBlockedCodes: tally(
      metas
        .filter((m) => m.stage === "export-blocked")
        .flatMap((m) => m.errorCodes),
    ),
    importFailedCodes: tally(
      metas
        .filter((m) => m.stage === "import-failed")
        .flatMap((m) => m.errorCodes),
    ),
    electricalGraph: tally(converted.map((m) => m.electricalGraph)),
    reexport: tally(converted.map((m) => m.reexport)),
    groundClaim: converted.filter((m) => m.import.groundClaim).length,
    supplyTerminal: converted.filter((m) => m.import.supplyTerminals > 0)
      .length,
    groundTerminal: converted.filter((m) => m.import.groundTerminals > 0)
      .length,
    hiddenPinsExplicit: converted.filter((m) => m.import.hiddenPinsExplicit > 0)
      .length,
  };
}

function writeCase(out, { meta, netlist, project }) {
  writeFileSync(
    join(out, `${meta.id}.meta.json`),
    `${JSON.stringify(meta, null, 2)}\n`,
  );
  if (netlist !== undefined && project !== undefined) {
    writeFileSync(join(out, `${meta.id}.sp`), netlist);
    writeFileSync(join(out, `${meta.id}.json`), project);
  }
}

const usage =
  "Usage: netlist-input.mjs <corpus> --form vss|global [--out <dir>] [--jobs <n>]";

function parseArgs(argv) {
  const [corpus, ...rest] = argv;
  const flags = new Map();
  for (let i = 0; i < rest.length; i += 2) {
    if (
      !["--form", "--out", "--jobs"].includes(rest[i]) ||
      rest[i + 1] === undefined
    )
      throw new Error(usage);
    flags.set(rest[i], rest[i + 1]);
  }
  const form = flags.get("--form");
  const jobs = Number(flags.get("--jobs") ?? 1);
  if (
    !corpus ||
    !FORMS.includes(form) ||
    !Number.isSafeInteger(jobs) ||
    jobs < 1
  )
    throw new Error(usage);
  return {
    corpus,
    form,
    jobs,
    out: flags.get("--out") ?? `tmp/netlist-input/${form}`,
  };
}

async function main() {
  const { corpus, form, jobs, out } = parseArgs(process.argv.slice(2));
  const files = readdirSync(corpus)
    .filter((f) => f.endsWith(".json") && !f.endsWith(".meta.json"))
    .sort();
  if (!files.length) throw new Error(`No <id>.json files in ${corpus}`);
  // Loaded here so the evaluation, which imports markerCounts, does not load Vite.
  const { bundleImportDisplay } =
    await import("./lib/import-display-bundle.mjs");
  const bundle = await bundleImportDisplay();
  // Stale cases from an earlier run would not be byte-identical to this one.
  mkdirSync(out, { recursive: true });
  for (const f of readdirSync(out))
    if (f.endsWith(".json") || f.endsWith(".sp")) rmSync(join(out, f));
  const metas = new Array(files.length);
  let next = 0;
  await Promise.all(
    Array.from(
      { length: Math.min(jobs, files.length) },
      () =>
        new Promise((done, fail) => {
          const worker = new Worker(new URL(import.meta.url), {
            workerData: {
              kind: "netlist-input",
              bundle,
              form,
              out: resolve(out),
            },
          });
          const send = () => {
            if (next >= files.length) {
              void worker.terminate().then(() => done(), fail);
              return;
            }
            const index = next++;
            worker.postMessage({ index, file: resolve(corpus, files[index]) });
          };
          worker.on("message", ({ index, meta }) => {
            metas[index] = meta;
            send();
          });
          worker.once("error", fail);
          send();
        }),
    ),
  );
  for (const [key, value] of Object.entries(coverageSummary(metas)))
    console.log(`${key}: ${JSON.stringify(value)}`);
  console.log(`Wrote ${metas.length} cases to ${out}`);
  if (metas.some((m) => m.stage === "threw")) process.exitCode = 1;
}

if (!isMainThread && workerData?.kind === "netlist-input") {
  const importStep = await import(pathToFileURL(workerData.bundle).href);
  parentPort.on("message", ({ index, file }) => {
    const id = file.split("/").at(-1).slice(0, -5);
    const run = async () => {
      let project;
      try {
        project = parseProject(readFileSync(file, "utf8"));
      } catch (error) {
        return {
          meta: { ...emptyMeta(id, workerData.form), message: String(error) },
        };
      }
      return convertProject(project, id, workerData.form, importStep);
    };
    void run().then((converted) => {
      writeCase(workerData.out, converted);
      parentPort.postMessage({ index, meta: converted.meta });
    });
  });
} else if (
  process.argv[1] &&
  existsSync(process.argv[1]) &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  await main();
}
