import { copyNetlistText, expectStatus } from "./editor-fixtures.js";
import { expect, test, type Page } from "@playwright/test";

/** Wait for the Auto Layout that follows a SPICE import (T147) to finish. */
const importLaidOut = (page: Page) =>
  expect(page.getByTestId("status")).toContainText(
    /· (Auto Layout (applied|left|cancelled|failed|could)|Already laid out|The (drawing|Project) changed)/u,
    { timeout: 60_000 },
  );

test("imports SCS and local includes, copies SPICE, and retains the circuit after unsupported input", async ({
  page,
}) => {
  await page.goto("/editor");
  await page.getByTestId("spice-files").setInputFiles([
    {
      name: "circuit.scs",
      mimeType: "text/plain",
      buffer: Buffer.from(
        'simulator lang=spectre\ninclude "leaf.inc"\nsubckt top (z a)\nX1 (z a) leaf scale=2\nends top',
      ),
    },
    {
      name: "leaf.inc",
      mimeType: "text/plain",
      buffer: Buffer.from(
        "subckt leaf (out in)\nparameters scale=1\nR1 (out in) resistor r=1k\nends leaf",
      ),
    },
  ]);
  await expectStatus(page, "Imported 2 Documents");
  await importLaidOut(page);
  const text = await copyNetlistText(page);
  expect(text).toMatch(/\.subckt top z a/iu);
  expect(text).toMatch(/X1 z a leaf scale=2/iu);
  expect(text).toMatch(/\.subckt leaf out in params: scale=1/iu);
  expect(text).toMatch(/R1 out in 1k/iu);
  await page.getByTestId("spice-files").setInputFiles({
    name: "broken.scs",
    mimeType: "text/plain",
    buffer: Buffer.from("// bad\nR1 (a 0) resistor r=1k tc1=1"),
  });
  await expectStatus(page, "broken.scs:2: Unsupported parameters: tc1");
  expect(await copyNetlistText(page)).toBe(text);
});

// The conversion core's own cases are packages/spice/src/conversion.test.ts.
