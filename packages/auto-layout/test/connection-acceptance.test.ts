import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { executeTransaction } from "@icm/edit-engine";
import type { SchematicDocument } from "@icm/model";
import {
  builtInSymbols,
  createProjectSymbolResolver,
  InMemorySymbolResolver,
} from "@icm/symbols";
import { parseProject } from "@icm/project-protocol";
import {
  connectionsIntact,
  keepIntactReroute,
  planAutoLayout,
  preferIntact,
} from "../src/auto-layout.js";
import { placement } from "../src/geometry.js";
import { missingConnections } from "../src/routing-audit.js";
import type { AutoLayoutResult } from "../src/types.js";
import cases from "./corpus-cases.json";
import { circuit } from "./document-fixture.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);

function hash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

/** The Document a caller would receive for this result. */
function delivered(document: SchematicDocument, result: AutoLayoutResult) {
  const applied = executeTransaction(
    document,
    {
      transactionId: "t141-test",
      documentId: document.id,
      expectedRevision: document.revision,
      actor: { kind: "agent", id: "t141" },
      edits: result.edits,
    },
    { symbolResolver: resolver },
  );
  expect(applied.ok).toBe(true);
  return applied.ok ? applied.document : document;
}

/** Three resistors on one Net: the plan draws two Routes for it. */
function cleanTee() {
  const document = circuit(
    { a: "resistor", b: "resistor", c: "resistor" },
    { n: ["a.1", "b.1", "c.1"] },
  );
  document.instances[0]!.placement = placement(0, 0);
  document.instances[1]!.placement = placement(400, 0);
  document.instances[2]!.placement = placement(200, 200);
  const result = planAutoLayout(document, resolver);
  return { document, result };
}

/** The same trial with its drawn Routes removed: cheaper, and defective. */
function withoutRoutes(result: AutoLayoutResult): AutoLayoutResult {
  return {
    edits: result.edits.filter((edit) => edit.kind !== "set_route_path"),
    groups: [],
    diagnostics: [],
  };
}

/** A triangle whose third pin is boxed in: no finished candidate can route it. */
function boxed() {
  const document = circuit(
    {
      a: "resistor",
      b: "resistor",
      c: "resistor",
      wall: "resistor",
      left: "resistor",
      right: "resistor",
    },
    { n: ["a.1", "b.1", "c.1"] },
  );
  [
    placement(0, 0),
    placement(400, 0),
    placement(200, 200),
    placement(200, 170, "none", 90),
    placement(180, 200),
    placement(220, 200),
  ].forEach((pose, index) => {
    document.instances[index]!.placement = pose;
  });
  return document;
}

describe("T141 connection acceptance", () => {
  it("plans a document with no connection problem exactly as before", () => {
    const fixture = cases.find((entry) => entry.id === "rc-lowpass")!;
    const project = parseProject(readFileSync(fixture.file, "utf8"));
    const document = project.documents.find(
      (d) => d.id === (fixture.documentId ?? project.topDocumentId),
    )!;
    const projectResolver = createProjectSymbolResolver(
      project,
      builtInSymbols,
    );
    const plan = planAutoLayout(document, projectResolver);
    // Recorded at fcd8fc4, before this gate existed: an intact plan is not
    // touched by it, down to the edit list.
    expect(hash(plan)).toBe(
      "42b678bc7dbbb90532c5e6ac6f8b95161bb3e881f5b0a32ba95aacb9e629e043",
    );
    expect(plan.diagnostics).toEqual([]);
    expect(connectionsIntact(delivered(document, plan), projectResolver)).toBe(
      true,
    );
  }, 60_000);

  it("prefers the intact finished candidate over one that leaves a pin floating", () => {
    const { document, result } = cleanTee();
    const dirty = withoutRoutes(result);
    expect(connectionsIntact(delivered(document, result), resolver)).toBe(true);
    expect(connectionsIntact(delivered(document, dirty), resolver)).toBe(false);
    // Argument order must not matter: a clean plan always wins.
    expect(preferIntact(document, resolver, dirty, result)).toBe(result);
    expect(preferIntact(document, resolver, result, dirty)).toBe(result);
    // Two clean plans stay with the caller's own ranking.
    expect(preferIntact(document, resolver, result, result)).toBe(result);
    expect(preferIntact(document, resolver, result, undefined)).toBe(result);
  }, 60_000);

  it("keeps the pre-reroute plan when the reroute drops a connection", () => {
    const { document, result } = cleanTee();
    const dirty = withoutRoutes(result);
    // An intact incumbent is protected.
    expect(keepIntactReroute(document, resolver, result, dirty)).toBe(result);
    // A defective incumbent protects nothing; the final gate decides.
    expect(keepIntactReroute(document, resolver, dirty, result)).toBe(result);
  }, 60_000);

  it("refuses a finished plan whose only candidate leaves a pin unconnected", () => {
    const document = boxed();
    const plan = planAutoLayout(document, resolver, {
      fixedInstanceIds: new Set(document.instances.map((i) => i.id)),
    });
    expect(plan.diagnostics.filter((d) => d.severity === "error")).toEqual([
      {
        severity: "error",
        code: "AUTO_LAYOUT_CONNECTION_REFUSED",
        rule: "R10",
        message: expect.stringMatching(
          /^R10: the finished layout leaves connections undrawn \(1 undrawn connection: n; floating pins: c\.1\)/u,
        ),
      },
    ]);
    // Nothing is delivered, and the underlying cause stays readable.
    expect(plan.edits).toEqual([]);
    expect(plan.diagnostics.map((d) => d.code)).toContain(
      "AUTO_LAYOUT_NET_UNROUTED",
    );
    // The refusal describes the drawing the planner had finished.
    expect(missingConnections(document, resolver)).toBe(2);
  }, 60_000);

  it("refuses a plan that splits a Net without leaving any pin floating", () => {
    // Two ground markers on one un-named Net: each marker's lead is drawn, so
    // nothing is floating, but the Net is two physical components. This is the
    // half of `connectionsIntact` a floating-pin test cannot reach — the class
    // where `equivalent` is true and a wire is still missing.
    const document = circuit(
      {
        v: "voltage-source",
        r: "resistor",
        d: "diode",
        g1: "ground",
        g2: "ground",
      },
      {
        a: ["v.+", "r.1"],
        k: ["r.2", "d.A"],
        z: ["v.-", "d.K", "g1.0", "g2.0"],
      },
    );
    const plan = planAutoLayout(document, resolver);
    const errors = plan.diagnostics.filter((d) => d.severity === "error");
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      severity: "error",
      code: "AUTO_LAYOUT_CONNECTION_REFUSED",
      rule: "R10",
    });
    // The message names the split Net even though no pin floats.
    expect(errors[0]!.message).toMatch(/1 undrawn connection: z/u);
    expect(errors[0]!.message).not.toMatch(/floating pins/u);
    expect(plan.edits).toEqual([]);
  }, 60_000);
});
