import { readFileSync, writeFileSync, readdirSync, mkdirSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createEmptyDocument } from "../packages/model/dist/index.js";
import { deviceDescriptor } from "../packages/devices/dist/index.js";
import {
  builtInSymbols,
  InMemorySymbolResolver,
} from "../packages/symbols/dist/index.js";
import { importSpiceSources } from "../packages/spice/dist/index.js";
import { classifyNets } from "../packages/auto-layout/dist/net-roles.js";
import * as recognition from "../packages/auto-layout/dist/recognize.js";
import { scoreRecognition } from "../packages/auto-layout/dist/recognition-score.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const resolver = new InMemorySymbolResolver(builtInSymbols);
const coreKinds = [
  "current-mirror",
  "differential-pair",
  "differential-pair-mirror-load",
  "common-gate-pair",
];
const allKinds = [...coreKinds, "cross-coupled-pair", "matched-pair"];
const read = (path) => readFileSync(path, "utf8");
const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((e) =>
      e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
    );
const flat = (s) => ({
  kind: s.kind,
  members: Object.fromEntries(
    s.members.flatMap((m) => m.instanceIds.map((id) => [id, m.role])),
  ),
});
const expectation = (kind, groups, tailUnlabeled) => ({
  kind,
  members: Object.fromEntries(
    groups.flatMap(([ids, role]) => ids.map((id) => [id, role])),
  ),
  ...(tailUnlabeled ? { tailUnlabeled: true } : {}),
});
function documentFromCase(c) {
  const d = createEmptyDocument(c.id, c.id);
  d.instances = Object.entries(c.symbols).map(([id, symbolId]) => ({
    id,
    symbolId,
    placement: null,
    ...(c.models?.[id]
      ? {
          netlist: {
            parameters: {},
            binding: {
              kind: "model",
              deviceClass: deviceDescriptor(symbolId).deviceClass,
              name: c.models[id],
            },
          },
        }
      : {}),
  }));
  d.nets = Object.entries(c.nets).map(([id, pins]) => ({
    id,
    terminals: pins.map((p) => {
      const at = p.lastIndexOf(".");
      return { instanceId: p.slice(0, at), pinName: p.slice(at + 1) };
    }),
  }));
  return d;
}
async function importBody(body, supply, models) {
  const text = `* Recognition topology only\n${body}\nVsupply ${supply} 0 1.8\n${models}\n.end\n`;
  const result = await importSpiceSources(
    [{ path: "case.cir", bytes: new TextEncoder().encode(text) }],
    "case.cir",
  );
  if (!result.successful || !result.project)
    throw new Error(JSON.stringify(result.diagnostics));
  return (
    result.project.documents.find(
      (d) => d.id === result.project.topDocumentId,
    ) ?? result.project.documents[0]
  );
}
function body(text) {
  const match = text.match(/^\.subckt[^\n]*\n([\s\S]*?)^\.ends/imu);
  if (!match) throw new Error("Missing .subckt body");
  return match[1];
}
function xmlStructures(text) {
  const roots = [],
    stack = [];
  for (const token of text.matchAll(
    /<structure\s+[^>]+>|<\/structure>|<pin\s+[^>]+\/>|<device\s+[^>]+\/>/gu,
  )) {
    const tag = token[0],
      attrs = Object.fromEntries(
        [...tag.matchAll(/(\w+)="([^"]*)"/gu)].map((m) => [m[1], m[2]]),
      );
    if (tag.startsWith("<structure ")) {
      const n = {
        name: attrs.name.split("[")[0],
        pins: {},
        devices: [],
        children: [],
      };
      (stack.at(-1)?.children ?? roots).push(n);
      stack.push(n);
    } else if (tag === "</structure>") stack.pop();
    else if (tag.startsWith("<pin ")) stack.at(-1).pins[attrs.name] = attrs.net;
    else stack.at(-1).devices.push(attrs.name.replace(/^\//u, ""));
  }
  return roots;
}
const descendants = (n) => [n, ...n.children.flatMap(descendants)];
const devices = (n) =>
  [...new Set(descendants(n).flatMap((s) => s.devices))].sort();
async function loadbench(dir) {
  const result = [];
  const deferredKinds = new Set([
    "MosfetCascodeCurrentMirror",
    "MosfetWideSwingCascodeCurrentMirror",
    "MosfetWilsonCurrentMirror",
    "MosfetImprovedWilsonCurrentMirror",
    "MosfetFoldedCascodeDifferentialPair",
    "MosfetCascodedDifferentialPair",
    "MosfetVoltageReference",
  ]);
  for (const path of walk(dir).filter((p) =>
    p.endsWith("struct_recognition.xml"),
  )) {
    const nodes = xmlStructures(read(path)).flatMap(descendants);
    const mirrors = new Map(),
      simple = nodes.filter((n) => n.name === "MosfetSimpleCurrentMirror");
    for (const n of simple) {
      const ref = n.children
        .filter((c) => c.name === "MosfetDiodeArray")
        .flatMap(devices);
      const out = n.children
        .filter((c) => c.name === "MosfetNormalArray")
        .flatMap(devices);
      if (!ref.length || !out.length) throw new Error(`Invalid mirror ${path}`);
      const key = JSON.stringify(ref.sort()),
        m = mirrors.get(key) ?? { ref, out: [] };
      m.out.push(...out);
      mirrors.set(key, m);
    }
    const expected = [...mirrors.values()].map((m) =>
      expectation("current-mirror", [
        [m.ref, "reference"],
        [[...new Set(m.out)], "output"],
      ]),
    );
    for (const p of nodes.filter((n) => n.name === "MosfetDifferentialPair")) {
      const inputs = p.children.filter((c) => c.name === "MosfetNormalArray");
      expected.push(
        expectation(
          "differential-pair",
          [[inputs.flatMap(devices), "input"]],
          true,
        ),
      );
      for (const m of simple) {
        if (
          ![p.pins.Output1, p.pins.Output2].includes(m.pins.Input) ||
          ![p.pins.Output1, p.pins.Output2].includes(m.pins.Output) ||
          m.pins.Input === m.pins.Output
        )
          continue;
        const a = inputs.find((n) => n.pins.Drain === m.pins.Input),
          b = inputs.find((n) => n.pins.Drain === m.pins.Output);
        if (!a || !b) throw new Error(`Invalid composite ${path}`);
        expected.push(
          expectation(
            "differential-pair-mirror-load",
            [
              [devices(a), "input-reference-side"],
              [devices(b), "input-output-side"],
              [
                m.children
                  .filter((n) => n.name === "MosfetDiodeArray")
                  .flatMap(devices),
                "load-reference",
              ],
              [
                m.children
                  .filter((n) => n.name === "MosfetNormalArray")
                  .flatMap(devices),
                "load-output",
              ],
            ],
            true,
          ),
        );
      }
    }
    for (const n of nodes.filter((n) => n.name === "MosfetGateConnectedCouple"))
      expected.push(
        expectation("common-gate-pair", [
          [
            n.children
              .filter((c) => c.name === "MosfetNormalArray")
              .flatMap(devices),
            "member",
          ],
        ]),
      );
    const cascodePairs = new Set([
      "MosfetFoldedCascodeDifferentialPair",
      "MosfetCascodedDifferentialPair",
    ]);
    const deferredByKind = Object.fromEntries(
      allKinds
        .filter((kind) => kind !== "common-gate-pair")
        .map((kind) => [
          kind,
          [
            ...new Set(
              nodes.filter((n) => cascodePairs.has(n.name)).flatMap(devices),
            ),
          ],
        ]),
    );
    const rewritten = body(
      read(join(dirname(path), "example_run/CombinedTestBench.cir")),
    )
      .trim()
      .split(/\r?\n/u)
      .map((line) => {
        const t = line.trim().split(/\s+/u);
        if (/^x/iu.test(t[0]))
          return [`m${t[0].slice(1)}`, ...t.slice(1, 6)].join(" ");
        if (/^c/iu.test(t[0])) return [...t.slice(0, 3), "1p"].join(" ");
        return line;
      })
      .join("\n")
      .replace(/\bsourceNmos\b/giu, "0");
    result.push({
      id: relative(dir, dirname(path)),
      source: "loadbench",
      document: await importBody(
        rewritten,
        "sourcePmos",
        ".model sky130_fd_pr__nfet_01v8_lvt nmos level=1\n.model sky130_fd_pr__pfet_01v8_lvt pmos level=1",
      ),
      expected,
      deferredByKind,
      deferred: [
        ...new Set(
          nodes
            .filter(
              (n) => deferredKinds.has(n.name) && !cascodePairs.has(n.name),
            )
            .flatMap(devices),
        ),
      ],
    });
  }
  return result;
}
async function circuitgenome(dir) {
  const result = [];
  for (const path of walk(dir).filter((p) => p.endsWith("_flat.ckt"))) {
    const raw = body(read(path)),
      lines = raw
        .trim()
        .split(/\r?\n/u)
        .map((l) => l.trim().split(/\s+/u));
    const variants = Object.fromEntries(
      [
        ...read(path.replace("_flat.ckt", "_hier.ckt")).matchAll(
          /^X(\S+)\s+([^\n]+)$/gmu,
        ),
      ].map((m) => [m[1], m[2].trim().split(/\s+/u).at(-1)]),
    );
    const expected = [],
      deferred = [];
    const pair = /^differential_pair_(nmos|pmos)$/u.test(variants.input_pair);
    const simpleTail = /^current_mirror_tail_/u.test(variants.tail_current),
      resistorTail = /^resistor_tail_/u.test(variants.tail_current);
    const active = /^active_load_(nmos|pmos)$/u.test(variants.load);
    const mirror = (id) => {
      const ref = lines.find((l) => l[0] === id);
      if (!ref) throw new Error(`Missing ${id} in ${path}`);
      const out = lines
        .filter(
          (l) =>
            /^m/iu.test(l[0]) &&
            l[5] === ref[5] &&
            l[2] === ref[2] &&
            l[3] === ref[3] &&
            l[1] !== l[2] &&
            l[1] !== l[3],
        )
        .map((l) => l[0]);
      expected.push(
        expectation("current-mirror", [
          [[id], "reference"],
          [out, "output"],
        ]),
      );
      return { ref, out };
    };
    let tail;
    const input = lines.find((l) => l[0] === "m1_input_pair");
    if (simpleTail) {
      const m = mirror("m1_tail_current");
      tail = m.out.find((id) => lines.find((l) => l[0] === id)[1] === input[3]);
    }
    if (resistorTail) tail = "r1_tail_current";
    if (pair)
      expected.push(
        expectation(
          "differential-pair",
          [
            [["m1_input_pair", "m2_input_pair"], "input"],
            ...(tail ? [[[tail], "tail"]] : []),
          ],
          !simpleTail && !resistorTail,
        ),
      );
    if (active) {
      const m = mirror("m1_load");
      if (pair) {
        const a = lines.find(
          (l) =>
            ["m1_input_pair", "m2_input_pair"].includes(l[0]) &&
            l[1] === m.ref[1],
        );
        const b = lines.find(
          (l) => ["m1_input_pair", "m2_input_pair"].includes(l[0]) && l !== a,
        );
        const out = m.out.filter(
          (id) => lines.find((l) => l[0] === id)[1] === b[1],
        );
        if (a && out.length)
          expected.push(
            expectation(
              "differential-pair-mirror-load",
              [
                [[a[0]], "input-reference-side"],
                [[b[0]], "input-output-side"],
                [[m.ref[0]], "load-reference"],
                [out, "load-output"],
                ...(tail ? [[[tail], "tail"]] : []),
              ],
              !simpleTail && !resistorTail,
            ),
          );
      }
    }
    // Independent module port labels, never recognizer output. A cascode is
    // labeled only over an in-scope input pair: R90 needs a recognized anchor,
    // and source-degenerated pairs are deferred, so their cascodes are too.
    const commonGateDevices = new Set();
    if (pair && /^(telescopic|folded)_cascode_load_/u.test(variants.load)) {
      const hierarchy = read(path.replace("_flat.ckt", "_hier.ckt"));
      const ports = hierarchy
        .split(/\r?\n/u)
        .find((l) => l.startsWith(`.subckt ${variants.load} `))
        .trim()
        .split(/\s+/u)
        .slice(2);
      const actual = hierarchy
        .split(/\r?\n/u)
        .find((l) => l.startsWith("Xload "))
        .trim()
        .split(/\s+/u)
        .slice(1, -1);
      const bindings = Object.fromEntries(ports.map((p, i) => [p, actual[i]]));
      const bias = new Set(
        ports.filter((p) => p.startsWith("bias")).map((p) => bindings[p]),
      );
      const anchors = [[bindings.in1, bindings.in2]];
      const loads = lines.filter(
        (l) => /^m/iu.test(l[0]) && l[0].endsWith("_load"),
      );
      for (let pass = 0; pass < loads.length; pass++) {
        let added = false;
        for (let i = 0; i < loads.length; i++)
          for (const b of loads.slice(i + 1)) {
            const a = loads[i];
            if (
              commonGateDevices.has(a[0]) ||
              commonGateDevices.has(b[0]) ||
              a[5] !== b[5] ||
              a[2] !== b[2] ||
              !bias.has(a[2]) ||
              a[3] === b[3] ||
              a[1] === b[1] ||
              !anchors.some(
                ([x, y]) =>
                  (a[3] === x && b[3] === y) || (a[3] === y && b[3] === x),
              )
            )
              continue;
            expected.push(
              expectation("common-gate-pair", [[[a[0], b[0]], "member"]]),
            );
            commonGateDevices.add(a[0]);
            commonGateDevices.add(b[0]);
            anchors.push([a[1], b[1]]);
            added = true;
          }
        if (!added) break;
      }
    }
    const deferredByKind = Object.fromEntries(
      allKinds
        .filter((k) => k !== "common-gate-pair")
        .map((k) => [k, [...commonGateDevices]]),
    );
    for (const l of lines) {
      const slot = Object.keys(variants).find((s) => l[0].endsWith(`_${s}`));
      const labeled =
        slot === "input_pair"
          ? pair
          : slot === "tail_current"
            ? simpleTail || resistorTail
            : slot === "load" &&
              (active ||
                /^(resistor|current_source)_load_/u.test(variants.load));
      if (!labeled && !commonGateDevices.has(l[0])) deferred.push(l[0]);
    }
    result.push({
      id: relative(dir, path).replace("_flat.ckt", ""),
      source: "circuitgenome-all",
      document: await importBody(
        raw.replaceAll("gnd!", "0"),
        "vdd!",
        ".model nmos nmos level=1\n.model pmos pmos level=1",
      ),
      expected,
      deferred,
      deferredByKind,
      variants,
    });
  }
  return result;
}
function evaluate(c, units) {
  const d = c.document ?? documentFromCase(c),
    roles = classifyNets(d, resolver);
  const recognized = recognition.recognizeSubstructures?.(d, roles);
  if (!units && !recognized)
    throw new Error("Build the role-aware recognizer first");
  const groups = units ? recognition.recognizeStructures(d, roles) : [];
  const predicted = units
    ? groups.flatMap((g) => {
        const common = recognized?.structures.find(
          (s) =>
            s.kind === "common-gate-pair" &&
            g.members.every((id) =>
              s.members.some((m) => m.instanceIds.includes(id)),
            ),
        );
        if (g.kind === "matched-pair" && !common) return [];
        const tailUnit = groups.find(
          (t) => t.facing === "outward" && t.members.includes(g.tailInstanceId),
        );
        return [
          {
            kind: common ? "common-gate-pair" : g.kind,
            members: Object.fromEntries([
              ...g.members.map((id) => [
                id,
                common
                  ? "member"
                  : g.kind === "current-mirror"
                    ? id === g.diodeInstanceId
                      ? "reference"
                      : "output"
                    : "input",
              ]),
              ...(g.tailInstanceId
                ? (tailUnit?.members ?? [g.tailInstanceId]).map((id) => [
                    id,
                    "tail",
                  ])
                : []),
            ]),
          },
        ];
      })
    : recognized.structures.map(flat);
  return {
    id: c.id,
    source: c.source,
    expected: c.expected,
    predicted,
    deferred: c.deferred,
    deferredByKind: c.deferredByKind,
    labeledKinds: (c.source === "hand" ? allKinds : coreKinds).filter(
      (kind) => !units || kind !== "matched-pair",
    ),
    ambiguousTailInputs: recognized?.ambiguities
      .filter((a) => a.kind === "tail")
      .flatMap((a) =>
        predicted
          .filter((s) => s.kind === "differential-pair")
          .map((s) =>
            Object.keys(s.members).filter((id) => s.members[id] === "input"),
          )
          .filter((ids) => ids.every((id) => a.instanceIds.includes(id))),
      ),
  };
}
const flags = new Map();
for (let i = 2; i < process.argv.length; i++) {
  const flag = process.argv[i];
  if (flag === "--units") flags.set(flag, true);
  else if (
    ["--loadbench", "--circuitgenome", "--out", "--emit-cases"].includes(
      flag,
    ) &&
    process.argv[i + 1]
  )
    flags.set(flag, process.argv[++i]);
  else throw new Error(`Unknown or incomplete option: ${flag}`);
}
const committedPath = join(
  root,
  "packages/auto-layout/test/recognition-cases.json",
);
let cases = JSON.parse(read(committedPath));
if (flags.has("--loadbench"))
  cases.push(...(await loadbench(flags.get("--loadbench"))));
const generated = flags.has("--circuitgenome")
  ? await circuitgenome(flags.get("--circuitgenome"))
  : [];
if (flags.has("--emit-cases")) {
  if (!generated.length)
    throw new Error("--emit-cases requires --circuitgenome");
  const selected = [],
    covered = new Set();
  for (const c of generated) {
    const features = [
      c.variants.input_pair === "differential_pair_nmos" &&
      c.variants.load === "active_load_pmos"
        ? "n"
        : null,
      c.variants.input_pair === "differential_pair_pmos" &&
      c.variants.load === "active_load_nmos"
        ? "p"
        : null,
      /^current_mirror_tail_/u.test(c.variants.tail_current) ? "mirror" : null,
      /^resistor_tail_/u.test(c.variants.tail_current) ? "resistor" : null,
      Object.values(c.variants).some((v) => v.startsWith("dda_cmfb"))
        ? "dda"
        : null,
    ].filter(Boolean);
    if (features.every((f) => covered.has(f))) continue;
    features.forEach((f) => covered.add(f));
    const d = structuredClone(c.document);
    d.instances.push({
      id: "benchmark_ground",
      symbolId: "ground",
      placement: null,
    });
    d.nets
      .find((n) =>
        n.terminals.some(
          (t) => t.instanceId === "Vsupply" && t.pinName === "-",
        ),
      )
      .terminals.push({ instanceId: "benchmark_ground", pinName: "0" });
    d.nets.forEach((n, index) => {
      n.id = `n${index}`;
    });
    selected.push({
      id: c.id,
      source: "circuitgenome",
      symbols: Object.fromEntries(d.instances.map((i) => [i.id, i.symbolId])),
      nets: Object.fromEntries(
        d.nets.map((n) => [
          n.id,
          n.terminals.map((t) => `${t.instanceId}.${t.pinName}`),
        ]),
      ),
      models: Object.fromEntries(
        d.instances
          .filter((i) => i.netlist?.binding?.kind === "model")
          .map((i) => [i.id, i.netlist.binding.name]),
      ),
      expected: c.expected,
      deferred: c.deferred,
      deferredByKind: c.deferredByKind,
      provenance: {
        tool: "CircuitGenome",
        version: "0.3.0",
        command: `circuitgenome synthesize --topology ${c.id.split("/")[0]} --format both --output-dir ${c.id.split("/")[0]}`,
        license: "MIT License, Copyright (c) 2026 Analog ML",
      },
    });
  }
  if (covered.size !== 5 || selected.length > 6)
    throw new Error("Fixture coverage incomplete");
  const serialized = JSON.stringify(selected, null, 2) + "\n";
  if (Buffer.byteLength(serialized) >= 20000)
    throw new Error("Fixtures exceed 20 KB");
  writeFileSync(flags.get("--emit-cases"), serialized);
}
cases.push(...generated);
const scored = cases.map((c) => evaluate(c, flags.has("--units")));
const report = {
  mode: flags.has("--units") ? "units" : "structures",
  ...scoreRecognition(scored),
  cases: scored,
};
for (const [source, kinds] of Object.entries(report.sources)) {
  console.log(
    `\n${source} (${scored.filter((c) => c.source === source).length} cases)`,
  );
  console.table(
    Object.entries(kinds).map(([kind, s]) => ({
      kind,
      expected: s.expected,
      predicted: s.predicted,
      matched: s.matched,
      precision: s.precision,
      recall: s.recall,
      exact: s.exactRate,
      unscored: s.unscored,
    })),
  );
}
if (flags.has("--out")) {
  mkdirSync(dirname(flags.get("--out")), { recursive: true });
  writeFileSync(flags.get("--out"), JSON.stringify(report, null, 2) + "\n");
}
