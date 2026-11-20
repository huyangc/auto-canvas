import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { AutoLayoutReport } from "./auto-layout-report";
import { multiCellNotice } from "./netlist-layout";

describe("Auto Layout report", () => {
  it("lists every diagnostic with its severity, code and own message", () => {
    const markup = renderToStaticMarkup(
      <AutoLayoutReport
        onClose={vi.fn()}
        report={{
          run: "manual",
          cells: [
            {
              documentId: "top",
              cellName: "top",
              outcome: "refused",
              diagnostics: [
                {
                  severity: "error",
                  code: "AUTO_LAYOUT_DRAFTING_INTERFACE_UNSUPPORTED",
                  rule: "drafting-interface",
                  message: "R161: frame block keeps its drawn interface",
                },
                {
                  severity: "warning",
                  code: "AUTO_LAYOUT_NET_UNROUTED",
                  rule: "R10",
                  message: "R10: net-a left unrouted",
                },
              ],
            },
          ],
        }}
      />,
    );
    expect(markup).toContain("Auto Layout left the drawing unchanged.");
    expect(markup).toContain("AUTO_LAYOUT_DRAFTING_INTERFACE_UNSUPPORTED");
    expect(markup).toContain("R161: frame block keeps its drawn interface");
    expect(markup).toContain("Warning");
    expect(markup).toContain("R10: net-a left unrouted");
    expect(markup).toContain('data-testid="auto-layout-report-close"');
    // A manual run has one Cell: no section heading.
    expect(markup).not.toContain("<h3>");
  });

  it("groups an import run's diagnostics by Cell, after the notice", () => {
    const warning = {
      severity: "warning" as const,
      code: "AUTO_LAYOUT_NET_UNROUTED",
      rule: "R10",
      message: "R10: net-a left unrouted",
    };
    const markup = renderToStaticMarkup(
      <AutoLayoutReport
        onClose={vi.fn()}
        report={{
          run: "import",
          cells: [
            {
              documentId: "a",
              cellName: "top",
              outcome: "applied",
              diagnostics: [],
            },
            {
              documentId: "b",
              cellName: "stage",
              outcome: "applied",
              diagnostics: [warning],
            },
            {
              documentId: "c",
              cellName: "chain",
              outcome: "refused",
              reason: "more than 120 parts",
              diagnostics: [
                {
                  severity: "error",
                  code: "AUTO_LAYOUT_TOO_LARGE",
                  rule: "R3",
                  message: "Auto layout supports at most 120 instances",
                },
              ],
            },
            {
              documentId: "d",
              cellName: "buf",
              outcome: "edited",
              diagnostics: [],
            },
            {
              documentId: "e",
              cellName: "inv",
              outcome: "unchanged",
              diagnostics: [],
            },
          ],
        }}
      />,
    );
    expect(markup).toContain(multiCellNotice(5));
    expect(markup.indexOf(multiCellNotice(5))).toBeLessThan(
      markup.indexOf("<h3>"),
    );
    for (const heading of [
      "top — applied</h3>",
      "stage — applied with 1 warning</h3>",
      "chain — left as imported: more than 120 parts</h3>",
      "buf — edited since import; not laid out</h3>",
      "inv — already laid out</h3>",
    ])
      expect(markup).toContain(heading);
    // The chain's refusal sits in the chain's section.
    const chain = markup.slice(markup.indexOf("chain — "));
    expect(chain.indexOf("AUTO_LAYOUT_TOO_LARGE")).toBeLessThan(
      chain.indexOf("buf — "),
    );
  });
});
