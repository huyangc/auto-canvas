import { expect, it, vi } from "vitest";
import { APP_ORIGIN } from "./app-protocol";
import { createExternalLinkHandler } from "./external-links";

it("opens fixed product links in the system browser and refuses arbitrary destinations", async () => {
  const open = vi.fn(async (_url: string) => {});
  const handle = createExternalLinkHandler(open, "a".repeat(40));
  const request = (body: unknown, origin = APP_ORIGIN) =>
    new Request(`${APP_ORIGIN}/desktop/external`, {
      method: "POST",
      headers: { origin },
      body: JSON.stringify(body),
    });
  expect((await handle(request({ target: "source" }))).ok).toBe(true);
  expect(open).toHaveBeenLastCalledWith(
    `https://github.com/huyangc/auto-canvas/commit/${"a".repeat(40)}`,
  );
  expect((await handle(request({ target: "rnl" }))).ok).toBe(true);
  expect(open).toHaveBeenLastCalledWith(
    "https://rich-netlist.github.io/rnl/en/",
  );
  expect(
    (await handle(request({ target: "https://example.com" }))).status,
  ).toBe(400);
  // The header's owner and repository links were removed (T149).
  for (const retired of ["owner", "repository"])
    expect((await handle(request({ target: retired }))).status).toBe(400);
  expect(
    (await handle(request({ target: "rnl", url: "file:///C:/Windows" })))
      .status,
  ).toBe(400);
  expect(
    (await handle(request({ target: "rnl" }, "https://example.com"))).status,
  ).toBe(403);
  expect(open).toHaveBeenCalledTimes(2);
});
