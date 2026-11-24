import { readFileSync } from "node:fs";
import { expect } from "vitest";
import { deriveElectricalTopologyProjection, endpointKey } from "@icm/derived";
import { executeTransaction } from "@icm/edit-engine";
import { parseProject } from "@icm/project-protocol";
import { builtInSymbols, createProjectSymbolResolver } from "@icm/symbols";
import { planAutoLayout } from "../src/index.js";
import { refinementMetrics } from "../src/refine.js";
import { auditRouting, floatingPins } from "../src/routing-audit.js";
import { freezePinGroups } from "../src/route.js";
import { terminalPartition, lostNameClaim } from "../src/transaction.js";
import cases from "./held-out-cases.json";

// The quick-planning held-out check shared by held-out.test.ts and the files
// split from it by case, so the slowest fixtures plan on workers of their own.
// The full-search checks are in held-out.slow.test.ts.

type HeldOutCase = (typeof cases)[number];

/** Fixtures given a file of their own; held-out.test.ts keeps every other one. */
const splitCases = ["ltc3452", "deadtime"] as const;

/** The held-out fixtures one test file runs: one split id, or "rest". */
export function heldOutCases(part: (typeof splitCases)[number] | "rest") {
  return part === "rest"
    ? cases.filter(
        (fixture) => !(splitCases as readonly string[]).includes(fixture.id),
      )
    : cases.filter((fixture) => fixture.id === part);
}

/** Quick-plans a held-out fixture and checks that it commits safely. */
export function checkQuickHeldOut(fixture: HeldOutCase) {
  const project = parseProject(readFileSync(fixture.file, "utf8"));
  const document = project.documents.find(
    (d) => d.id === (fixture.documentId ?? project.topDocumentId),
  )!;
  const resolver = createProjectSymbolResolver(project, builtInSymbols);
  // Calling directly also asserts that no held-out input throws.
  const plan = planAutoLayout(document, resolver, {
    search: { seed: 1, evaluations: 0 },
  });
  expect(refinementMetrics(plan)?.candidates ?? 0).toBeLessThanOrEqual(24);
  const errors = plan.diagnostics.filter((d) => d.severity === "error");
  // R161: `skew` has a functional frame whose drawn interfaces layout would
  // detach, so it is refused with that single error and no edits. Every
  // other fixture must still plan and commit.
  if (
    fixture.id === "skew" &&
    errors.length === 1 &&
    errors[0]!.code === "AUTO_LAYOUT_DRAFTING_INTERFACE_UNSUPPORTED"
  ) {
    expect(plan.edits).toEqual([]);
    expect(plan.diagnostics).toEqual(errors);
    return;
  }
  expect(errors).toEqual([]);
  const result = executeTransaction(
    document,
    {
      transactionId: `held-${fixture.id}`,
      documentId: document.id,
      expectedRevision: document.revision,
      actor: { kind: "agent", id: "test" },
      edits: plan.edits,
    },
    { symbolResolver: resolver },
  );
  expect(result.applied, JSON.stringify(result.diagnostics)).toBe(true);
  if (!result.ok) return;
  expect(terminalPartition(result.document, resolver)).toBe(
    terminalPartition(document, resolver),
  );
  expect(lostNameClaim(document, result.document)).toBeUndefined();
  const physical = deriveElectricalTopologyProjection(
    result.document,
    resolver,
  ).endpointToPhysicalComponent;
  for (const group of freezePinGroups(document, resolver))
    for (const [a, b] of group.contacts) {
      const component = physical.get(endpointKey({ kind: "terminal", ...a }));
      expect(component, `${a.instanceId}.${a.pinName}`).toBeDefined();
      expect(physical.get(endpointKey({ kind: "terminal", ...b }))).toBe(
        component,
      );
    }
  const audit = auditRouting(result.document, resolver);
  expect(audit.unsafeProblems).toEqual([]);
  for (const pin of floatingPins(result.document, resolver))
    expect(
      plan.diagnostics.some(
        (d) =>
          d.rule === "R14" &&
          d.severity === "warning" &&
          d.message.includes(`${pin.instanceId}.${pin.pinName}`),
      ),
    ).toBe(true);
}
