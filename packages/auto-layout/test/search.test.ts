import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { executeTransaction } from "@icm/edit-engine";
import type { SchematicDocument } from "@icm/model";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { planAutoLayout, planLayoutOnce } from "../src/auto-layout.js";
import { enclosingBox, geometryProblem, placement } from "../src/geometry.js";
import { emptyChoices } from "../src/layout-choices.js";
import { routedScore } from "../src/refine.js";
import { auditRouting } from "../src/routing-audit.js";
import { searchBounds } from "../src/search-bounds.js";
import { createMoveGenerator, randomStream } from "../src/search-moves.js";
import { lostNameClaim, terminalPartition } from "../src/transaction.js";
import type { AutoLayoutResult } from "../src/types.js";
import { classifyNets } from "../src/net-roles.js";
import { persistedTemplates, recognizeStructures } from "../src/recognize.js";
import { circuit } from "./document-fixture.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);
// A small block wiring fixture: exchanging a and b removes the remaining
// crossing. This is a topology/layout test, not a simulated analog circuit.
const crossed = () =>
  circuit(
    { a: "opamp", b: "opamp", c: "opamp", d: "opamp" },
    {
      n0: ["a.IN+", "a.IN-", "b.OUT"],
      n1: ["a.OUT", "b.IN-", "c.IN+", "c.OUT"],
      n4: ["b.IN+", "c.IN-", "d.OUT"],
      n2: ["d.IN+"],
      n3: ["d.IN-"],
    },
  );
function commit(document: SchematicDocument, result: AutoLayoutResult) {
  expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  const transaction = executeTransaction(
    document,
    {
      transactionId: "search-test",
      documentId: document.id,
      expectedRevision: document.revision,
      actor: { kind: "agent", id: "test" },
      edits: result.edits,
    },
    { symbolResolver: resolver },
  );
  expect(transaction.ok, JSON.stringify(transaction.diagnostics)).toBe(true);
  if (!transaction.ok) throw new Error("Search transaction refused");
  expect(terminalPartition(transaction.document, resolver)).toBe(
    terminalPartition(document, resolver),
  );
  expect(lostNameClaim(document, transaction.document)).toBeUndefined();
  expect(auditRouting(transaction.document, resolver).unsafeProblems).toEqual(
    [],
  );
  expect(geometryProblem(transaction.document, resolver)).toBeUndefined();
  return transaction.document;
}
const score = (result: AutoLayoutResult, final: SchematicDocument) =>
  routedScore({ result, final, choices: emptyChoices() }, resolver);

it("R66 keeps the byte-identical pre-search quick result", () => {
  const document = crossed();
  const result = planAutoLayout(document, resolver);
  // T023 records the quick result after Base Net clearance and partial routing.
  // commit checks equivalence and safety; the previous quick result had one crossing.
  expect(
    auditRouting(commit(document, result), resolver).crossings,
  ).toBeLessThanOrEqual(1);
  expect(
    createHash("sha256").update(JSON.stringify(result)).digest("hex"),
  ).toBe("3a873691880f213d5be464317065863290914c4f6bc8be9bd58c68c123c26311");
  expect(
    planAutoLayout(document, resolver, { search: { seed: 3, evaluations: 0 } }),
  ).toEqual(result);
}, 30000);

it("R66 repeats the same seed/budget and improves a known same-row swap", () => {
  const document = crossed();
  const quick = planAutoLayout(document, resolver),
    before = commit(document, quick);
  expect(auditRouting(before, resolver).crossings).toBe(1);
  const targets = new Map(
    before.instances.map((i) => [i.id, structuredClone(i.placement!)]),
  );
  [targets.get("a")!.position.x, targets.get("b")!.position.x] = [
    targets.get("b")!.position.x,
    targets.get("a")!.position.x,
  ];
  const swapped = planLayoutOnce(
    document,
    resolver,
    {},
    { sides: new Map(), orientations: targets },
    "layered",
    true,
    targets,
  );
  expect(
    auditRouting(commit(document, swapped.result), resolver).crossings,
  ).toBe(0);
  const progress: Array<{
    evaluations: number;
    best: number;
    current: number;
  }> = [];
  const options = {
    search: {
      seed: 1,
      evaluations: 32,
      onProgress: (p: (typeof progress)[number]) => progress.push(p),
    },
  };
  const result = planAutoLayout(document, resolver, options),
    after = commit(document, result);
  expect(
    planAutoLayout(document, resolver, { search: { seed: 1, evaluations: 32 } })
      .edits,
  ).toEqual(result.edits);
  expect(score(result, after)).toBeLessThanOrEqual(score(quick, before));
  expect(auditRouting(after, resolver).crossings).toBe(0);
  expect(progress.at(-1)!.evaluations).toBeLessThanOrEqual(32);
  expect(progress.at(-1)!.best).toBe(score(result, after));
  for (let i = 1; i < progress.length; i++)
    expect(progress[i]!.best).toBeLessThanOrEqual(progress[i - 1]!.best);
}, 30000);

it.each(["before", "during", "deadline"] as const)(
  "R66 %s cancellation returns a valid best-so-far plan",
  (when) => {
    const document = crossed(),
      controller = new AbortController();
    if (when === "before") controller.abort();
    const progress: number[] = [];
    const result = planAutoLayout(document, resolver, {
      search: {
        seed: 1,
        evaluations: 100,
        signal: controller.signal,
        ...(when === "deadline" ? { deadline: 0 } : {}),
        onProgress: (p) => {
          progress.push(p.evaluations);
          if (when === "during" && p.evaluations === 4) controller.abort();
        },
      },
    });
    const quick = planAutoLayout(document, resolver);
    expect(score(result, commit(document, result))).toBeLessThanOrEqual(
      score(quick, commit(document, quick)),
    );
    expect(progress.at(-1)).toBe(when === "during" ? 4 : 0);
  },
  30000,
);

it.each([false, true])(
  "R66 preserves explicit/locked fixed placements (locked=%s)",
  (locked) => {
    const document = crossed();
    document.instances[0]!.placement = placement(0, 0);
    if (locked)
      document.layoutGroups.push({
        id: "locked",
        kind: "matched-pair",
        objectIds: ["a"],
        locked: true,
      });
    const result = planAutoLayout(document, resolver, {
      ...(locked ? {} : { fixedInstanceIds: new Set(["a"]) }),
      search: { seed: 2, evaluations: 16 },
    });
    expect(commit(document, result).instances[0]!.placement).toEqual(
      document.instances[0]!.placement,
    );
  },
  30000,
);

it("R66 translates recognized pairs and their tail rigidly", () => {
  const document = circuit(
    { a: "nmos", b: "nmos", tail: "nmos", load: "resistor", input: "port" },
    {
      source: ["a.S", "b.S", "tail.D"],
      left: ["a.D", "load.1"],
      right: ["b.D"],
      ga: ["a.G", "input.P"],
      gb: ["b.G"],
      gt: ["tail.G"],
      ground: ["tail.S", "load.2"],
    },
  );
  document.netlist = {
    name: "pair",
    formalParameters: [],
    terminals: [
      {
        id: "input",
        name: "input",
        netId: "ga",
        direction: "input",
        interfaceInstanceIds: ["input"],
      },
    ],
  };
  const quick = planAutoLayout(document, resolver),
    before = commit(document, quick);
  expect(quick.groups.some((g) => g.kind === "differential-pair")).toBe(true);
  const result = planAutoLayout(document, resolver, {
      search: { seed: 3, evaluations: 32 },
    }),
    after = commit(document, result);
  for (const group of quick.groups) {
    const ids = [
      ...group.members,
      ...(group.tailInstanceId ? [group.tailInstanceId] : []),
    ];
    const shifts = ids.map((id) => {
      const old = before.instances.find((i) => i.id === id)!.placement!,
        next = after.instances.find((i) => i.id === id)!.placement!;
      expect({ rotation: next.rotation, mirror: next.mirror }).toEqual({
        rotation: old.rotation,
        mirror: old.mirror,
      });
      return {
        x: next.position.x - old.position.x,
        y: next.position.y - old.position.y,
      };
    });
    expect(
      shifts.every((p) => p.x === shifts[0]!.x && p.y === shifts[0]!.y),
    ).toBe(true);
  }
  expect(score(result, after)).toBeLessThanOrEqual(score(quick, before));
}, 30000);

it("R66 proposals reject overlaps, fixed units and off-grid positions before routing", () => {
  const document = crossed(),
    quick = planAutoLayout(document, resolver),
    after = commit(document, quick);
  const propose = createMoveGenerator(
    document,
    resolver,
    new Set(["a"]),
    randomStream(1),
  );
  const state = {
    placements: new Map(after.instances.map((i) => [i.id, i.placement!])),
    sides: new Map(),
    strategy: "stages" as const,
  };
  let valid = 0;
  for (let i = 0; i < 100; i++) {
    const next = propose(state);
    if (!next) continue;
    valid++;
    expect(next.placements.get("a")).toEqual(state.placements.get("a"));
    for (const p of next.placements.values()) {
      expect(Math.abs(p.position.x % document.presentation.grid)).toBe(0);
      expect(Math.abs(p.position.y % document.presentation.grid)).toBe(0);
    }
    expect(
      geometryProblem(
        {
          ...document,
          instances: document.instances.map((i) => ({
            ...i,
            placement: next.placements.get(i.id)!,
          })),
        },
        resolver,
      ),
    ).toBeUndefined();
  }
  expect(valid).toBeGreaterThan(0);
}, 30000);

it.each([1, 2, 3])(
  "R67 bounds an unrouted marker Net and anchors accepted layouts (seed=%s)",
  (seed) => {
    const document = crossed();
    document.instances.push({
      id: "orphan",
      symbolId: "ground",
      placement: null,
    });
    document.nets.push({
      id: "orphan-net",
      terminals: [{ instanceId: "orphan", pinName: "0" }],
    });
    const quick = planAutoLayout(document, resolver);
    const before = commit(document, quick);
    const box = enclosingBox(before, resolver);
    const result = planAutoLayout(document, resolver, {
      search: { seed, evaluations: 128 },
    });
    const after = commit(document, result);
    const bounds = enclosingBox(after, resolver);
    expect(bounds.width).toBeLessThanOrEqual(1.5 * box.width);
    expect(bounds.height).toBeLessThanOrEqual(1.5 * box.height);
    expect(Math.abs(bounds.x - box.x)).toBeLessThanOrEqual(
      document.presentation.grid / 2,
    );
    expect(Math.abs(bounds.y - box.y)).toBeLessThanOrEqual(
      document.presentation.grid / 2,
    );
    expect(score(result, after)).toBeLessThanOrEqual(score(quick, before));
  },
  30000,
);

it("R67 canonicalizes a translated state before regenerating orphan markers", () => {
  const document = crossed();
  document.instances.push({
    id: "orphan",
    symbolId: "ground",
    placement: null,
  });
  document.nets.push({
    id: "orphan-net",
    terminals: [{ instanceId: "orphan", pinName: "0" }],
  });
  const quick = commit(document, planAutoLayout(document, resolver));
  const bounds = searchBounds(quick, resolver);
  const evaluate = (translation: number) => {
    const given = new Map(
      quick.instances.map((i) => {
        const p = structuredClone(i.placement!);
        p.position.x += translation;
        p.position.y += translation;
        return [i.id, p] as const;
      }),
    );
    return planLayoutOnce(
      document,
      resolver,
      {},
      { sides: new Map(), orientations: given },
      "layered",
      true,
      given,
      bounds,
    );
  };
  const first = evaluate(0),
    translated = evaluate(1600);
  expect(translated.result).toEqual(first.result);
  commit(document, translated.result);
}, 30000);

it("R66 builds search units from the same templates as quick placement", () => {
  const d = circuit(
    { a: "nmos", b: "nmos", c: "nmos", d: "nmos", g: "ground" },
    {
      gate: ["a.G", "b.G", "c.G", "d.G", "a.D"],
      db: ["b.D"],
      dc: ["c.D"],
      dd: ["d.D"],
      gnd: ["a.S", "b.S", "c.S", "d.S", "g.0"],
    },
  );
  d.layoutGroups = [
    {
      id: "kept",
      kind: "current-mirror",
      objectIds: ["a", "c"],
      locked: false,
    },
  ];
  const roles = classifyNets(d, resolver);
  const templates = [
    ...recognizeStructures(d, roles),
    ...persistedTemplates(d, roles),
  ];
  // The persisted mirror keeps its chosen output c in the quick template.
  expect(templates.map((g) => g.members)).toEqual([["a", "c"]]);
  const commit = (edits: AutoLayoutResult["edits"]) => {
    const result = executeTransaction(
      d,
      {
        transactionId: "units",
        documentId: d.id,
        expectedRevision: d.revision,
        actor: { kind: "agent", id: "test" },
        edits,
      },
      { symbolResolver: resolver },
    );
    expect(result.ok).toBe(true);
    return result.ok ? result.document : d;
  };
  const offset = (doc: SchematicDocument, [a, b]: [string, string]) => {
    const p = (id: string) =>
      doc.instances.find((i) => i.id === id)!.placement!;
    return [
      p(b).position.x - p(a).position.x,
      p(b).position.y - p(a).position.y,
      p(a).mirror,
      p(b).mirror,
    ];
  };
  const quick = commit(planAutoLayout(d, resolver).edits);
  const state = {
    placements: new Map(quick.instances.map((i) => [i.id, i.placement!])),
    sides: new Map(),
    strategy: "layered" as const,
  };
  for (const seed of [1, 2, 3]) {
    const propose = createMoveGenerator(
      d,
      resolver,
      new Set(),
      randomStream(seed),
    );
    let moved = 0;
    for (let i = 0; i < 200; i++) {
      const next = propose(state);
      if (!next) continue;
      moved++;
      const view = {
        ...quick,
        instances: quick.instances.map((inst) => ({
          ...inst,
          placement: next.placements.get(inst.id)!,
        })),
      };
      for (const g of templates)
        expect(offset(view, g.members)).toEqual(offset(quick, g.members));
    }
    expect(moved).toBeGreaterThan(0);
  }
}, 30000);
