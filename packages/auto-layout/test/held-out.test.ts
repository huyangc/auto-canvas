import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { deriveElectricalTopologyProjection, endpointKey } from "@icm/derived";
import { executeTransaction } from "@icm/edit-engine";
import { parseProject } from "@icm/project-protocol";
import { builtInSymbols, createProjectSymbolResolver } from "@icm/symbols";
import { planAutoLayout } from "../src/index.js";
import { refinementMetrics } from "../src/refine.js";
import { auditRouting } from "../src/routing-audit.js";
import { freezePinGroups } from "../src/route.js";
import { terminalPartition, lostNameClaim } from "../src/transaction.js";
import cases from "./held-out-cases.json";

it.each(cases)(
  "$id: refuses safely or commits with preserved Nets and clear Routes",
  (fixture) => {
    const project = parseProject(readFileSync(fixture.file, "utf8"));
    const document = project.documents.find(
      (d) => d.id === (fixture.documentId ?? project.topDocumentId),
    )!;
    const resolver = createProjectSymbolResolver(project, builtInSymbols);
    // Calling directly also asserts that no held-out input throws.
    const plan = planAutoLayout(document, resolver);
    // Work is bounded by R22's candidate limit, which holds on any machine; a
    // wall-clock limit here failed on the slower CI runner. The review script
    // reports measured time instead.
    expect(refinementMetrics(plan)?.candidates ?? 0).toBeLessThanOrEqual(24);
    const errors = plan.diagnostics.filter((d) => d.severity === "error");
    if (["fd-two-stage", "common-source-ac", "skew"].includes(fixture.id))
      expect(errors).toEqual([]);
    if (errors.length) {
      expect(plan.edits).toEqual([]);
      return;
    }
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
    expect(auditRouting(result.document, resolver).unsafeProblems).toEqual([]);
  },
  30000,
);
