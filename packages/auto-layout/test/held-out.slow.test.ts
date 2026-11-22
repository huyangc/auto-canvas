import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { deriveElectricalTopologyProjection, endpointKey } from "@icm/derived";
import { executeTransaction } from "@icm/edit-engine";
import { parseProject } from "@icm/project-protocol";
import { builtInSymbols, createProjectSymbolResolver } from "@icm/symbols";
import { planAutoLayout } from "../src/index.js";
import { netlistSymmetry } from "../src/readability-netlist-symmetry.js";
import { refinementMetrics } from "../src/refine.js";
import { auditRouting, floatingPins } from "../src/routing-audit.js";
import { freezePinGroups } from "../src/route.js";
import { terminalPartition, lostNameClaim } from "../src/transaction.js";
import cases from "./held-out-cases.json";

const crossingLimits: Record<string, number> = {
  "fd-two-stage": 9,
  "common-source-ac": 2,
  skew: 4,
  deadtime: 17,
  "ota-sky130": 3,
  widlar: 5,
  ltc3452: 22,
};
it.each(cases)(
  "$id: commits without exceeding T013 crossings and preserves Nets",
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
    // reports measured time instead. The timeout below only guards against a
    // hang: with T023 drawing every routable Net, the slowest fixture takes
    // about 8 s here and reached 30 s on a slow CI runner.
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
    if (fixture.id === "fd-two-stage") {
      expect(netlistSymmetry(result.document, resolver)).toEqual({
        opportunities: 5,
        violations: 0,
      });
      expect(audit.bends).toBeLessThanOrEqual(13);
    }
    for (const pin of floatingPins(result.document, resolver))
      expect(
        plan.diagnostics.some(
          (d) =>
            d.rule === "R14" &&
            d.severity === "warning" &&
            d.message.includes(`${pin.instanceId}.${pin.pinName}`),
        ),
      ).toBe(true);
    expect(audit.crossings).toBeLessThanOrEqual(crossingLimits[fixture.id]!);
  },
  60000,
);
