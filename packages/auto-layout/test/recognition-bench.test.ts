import { expect, it } from "vitest";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { classifyNets } from "../src/net-roles.js";
import {
  recognizeStructures,
  recognizeSubstructures,
} from "../src/recognize.js";
import {
  scoreRecognition,
  type RecognitionCase,
  type RecognitionExpectation,
} from "../src/recognition-score.js";
import type { Structure } from "../src/types.js";
import casesJson from "./recognition-cases.json";
import { circuit } from "./document-fixture.js";

interface Case {
  id: string;
  source: string;
  symbols: Record<string, string>;
  nets: Record<string, string[]>;
  models?: Record<string, string>;
  expected: RecognitionExpectation[];
  deferred?: string[];
}
const cases: Case[] = casesJson;
const resolver = new InMemorySymbolResolver(builtInSymbols);
const flat = (s: Structure): RecognitionExpectation => ({
  kind: s.kind,
  members: Object.fromEntries(
    s.members.flatMap((m) => m.instanceIds.map((id) => [id, m.role])),
  ),
});
const kinds = [
  "current-mirror",
  "differential-pair",
  "differential-pair-mirror-load",
  "cross-coupled-pair",
  "matched-pair",
];
const canonical = (ss: RecognitionExpectation[]) =>
  ss
    .map((s) =>
      JSON.stringify({
        kind: s.kind,
        members: Object.entries(s.members).sort(([a], [b]) =>
          a.localeCompare(b),
        ),
      }),
    )
    .sort();
const scored: RecognitionCase[] = cases.map((c) => {
  const d = circuit(c.symbols, c.nets, c.models);
  return {
    ...c,
    predicted: recognizeSubstructures(
      d,
      classifyNets(d, resolver),
    ).structures.map(flat),
    labeledKinds: c.source === "hand" ? kinds : kinds.slice(0, 3),
  };
});
for (const c of scored)
  it(`exact labeled structures: ${c.id}`, () => {
    const report = scoreRecognition([c]);
    expect(report.mismatches).toEqual([]);
  });
it("scores committed hand cases perfectly for every kind", () => {
  const report = scoreRecognition(scored);
  for (const score of Object.values(report.sources.hand!))
    expect([score.precision, score.recall, score.exactRate]).toEqual([1, 1, 1]);
});
function random(seed: number) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}
function shuffle<T>(xs: T[], next: () => number): T[] {
  const result = [...xs];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}
for (const c of cases.filter((c) => c.source === "hand"))
  for (const seed of [1, 7, 42])
    it(`rename and shuffle ${c.id}, seed ${seed}`, () => {
      const next = random(seed),
        ids = Object.keys(c.symbols).sort().reverse();
      const rename = new Map(
        ids.map((id, n) => [id, `renamed-${String(n).padStart(3, "0")}`]),
      );
      const inverse = new Map([...rename].map(([a, b]) => [b, a]));
      const d = circuit(
        Object.fromEntries(
          shuffle(Object.entries(c.symbols), next).map(([id, s]) => [
            rename.get(id)!,
            s,
          ]),
        ),
        Object.fromEntries(
          shuffle(Object.entries(c.nets), next).map(([id, ts]) => [
            id,
            shuffle(ts, next).map((t) => {
              const [i, p] = t.split(".");
              return `${rename.get(i!)}.${p}`;
            }),
          ]),
        ),
        Object.fromEntries(
          Object.entries(c.models ?? {}).map(([id, m]) => [rename.get(id)!, m]),
        ),
      );
      const result = recognizeSubstructures(d, classifyNets(d, resolver));
      const mapped = result.structures.map(flat).map((s) => ({
        ...s,
        members: Object.fromEntries(
          Object.entries(s.members).map(([id, role]) => [
            inverse.get(id)!,
            role,
          ]),
        ),
      }));
      expect(canonical(mapped)).toEqual(canonical(c.expected));
      const original = circuit(c.symbols, c.nets, c.models);
      const ambiguities = recognizeSubstructures(
        original,
        classifyNets(original, resolver),
      ).ambiguities;
      expect(
        result.ambiguities
          .map((a) => ({
            ...a,
            instanceIds: a.instanceIds.map((id) => inverse.get(id)!).sort(),
          }))
          .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
      ).toEqual(
        ambiguities.sort((a, b) =>
          JSON.stringify(a).localeCompare(JSON.stringify(b)),
        ),
      );
    });
it("recognition ignores persisted groups while movement units suppress their members", () => {
  const c = cases.find((c) => c.id === "multi-output")!,
    d = circuit(c.symbols, c.nets);
  const roles = classifyNets(d, resolver),
    before = recognizeSubstructures(d, roles);
  expect(recognizeStructures(d, roles)).toEqual([
    {
      id: "auto-current-mirror-r",
      kind: "current-mirror",
      members: ["r", "x"],
      diodeInstanceId: "r",
      extraMemberIds: ["y"],
    },
  ]);
  d.layoutGroups.push({
    id: "manual",
    kind: "custom",
    objectIds: ["y"],
    locked: false,
  });
  expect(recognizeSubstructures(d, roles)).toEqual(before);
  expect(recognizeStructures(d, roles)[0]).not.toHaveProperty("extraMemberIds");
  d.layoutGroups[0]!.objectIds.push("r");
  expect(recognizeStructures(d, roles)).toEqual([]);
});
it("scores instance sets separately from roles, one-to-one, with deferred and unlabeled exclusions", () => {
  const expected: RecognitionExpectation = {
    kind: "current-mirror",
    members: { a: "reference", b: "output" },
  };
  const c: RecognitionCase = {
    id: "scoring",
    source: "test",
    labeledKinds: ["current-mirror", "differential-pair"],
    expected: [
      expected,
      {
        kind: "differential-pair",
        members: { x: "input", y: "input" },
        tailUnlabeled: true,
      },
    ],
    predicted: [
      { kind: "current-mirror", members: { a: "output", b: "reference" } },
      { ...expected },
      {
        kind: "differential-pair",
        members: { x: "input", y: "input", t: "tail" },
      },
      {
        kind: "current-mirror",
        members: { deferred: "reference", b: "output" },
      },
      { kind: "matched-pair", members: { q: "member", r: "member" } },
    ],
    deferred: ["deferred"],
  };
  const r = scoreRecognition([c]).sources.test!;
  expect(r["current-mirror"]).toMatchObject({
    expected: 1,
    predicted: 2,
    matched: 1,
    exact: 1,
    precision: 0.5,
    recall: 1,
  });
  expect(r["differential-pair"]).toMatchObject({
    matched: 1,
    exact: 1,
    tails: { labeled: 0 },
  });
  expect(r["matched-pair"]).toMatchObject({ predicted: 0, unscored: 1 });
  c.predicted = c.predicted.slice(0, 1);
  expect(scoreRecognition([c]).sources.test!["current-mirror"]).toMatchObject({
    matched: 1,
    exact: 0,
  });
});
it("reports correct, wrong, missed and ambiguous labeled tails", () => {
  const make = (id: string, tail?: string): RecognitionExpectation => ({
    kind: "differential-pair",
    members: {
      [`${id}a`]: "input",
      [`${id}b`]: "input",
      ...(tail ? { [tail]: "tail" } : {}),
    },
  });
  const c: RecognitionCase = {
    id: "tails",
    source: "test",
    labeledKinds: ["differential-pair"],
    expected: [1, 2, 3, 4].map((n) => make(String(n), `t${n}`)),
    predicted: [make("1", "t1"), make("2", "wrong"), make("3"), make("4")],
    ambiguousTailInputs: [["4a", "4b"]],
  };
  expect(
    scoreRecognition([c]).sources.test!["differential-pair"]!.tails,
  ).toEqual({ labeled: 4, correct: 1, wrong: 1, missed: 1, ambiguous: 1 });
});

it.each(["differential-pair", "differential-pair-mirror-load"])(
  "scores %s with a deferred tail but excludes deferred core members",
  (kind) => {
    const members =
      kind === "differential-pair"
        ? { a: "input", b: "input" }
        : {
            a: "input-reference-side",
            b: "input-output-side",
            r: "load-reference",
            o: "load-output",
          };
    const c: RecognitionCase = {
      id: "deferred-tail",
      source: "test",
      labeledKinds: [kind],
      deferred: ["cascode"],
      expected: [{ kind, members: { ...members, t: "tail" } }],
      predicted: [{ kind, members: { ...members, cascode: "tail" } }],
    };
    const result = scoreRecognition([c]);
    expect(result.mismatches).toEqual([]);
    expect(result.sources.test![kind]).toMatchObject({
      expected: 1,
      predicted: 1,
      matched: 1,
      exact: 1,
      tails: { labeled: 0 },
    });
    c.deferred!.push("a");
    expect(scoreRecognition([c]).sources.test![kind]).toMatchObject({
      expected: 0,
      predicted: 0,
    });
  },
);
