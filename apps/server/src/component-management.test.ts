import { expect, it } from "vitest";
import { componentLibraryHarness } from "./component-library.test-support.js";

it("manages malformed official records without parsing, preserves history and retries, and restores as local admin", async () => {
  const route = await componentLibraryHarness();
  await route.seed({
    id: "broken-own",
    authorId: "local",
    definition: { broken: true },
    status: "official",
  });
  const removed = await route("PATCH", "/broken-own", {
    revision: 1,
    action: "delete",
  });
  expect(removed.status).toBe(200);
  const body = await removed.json();
  expect(body.entry).toMatchObject({
    revision: 2,
    status: "deleted",
    deletion: { by: "admin", previousStatus: "official" },
  });
  expect((await route("GET", "/broken-own")).status).toBe(200);
  const retry = await route("PATCH", "/broken-own", {
    revision: 1,
    action: "delete",
  });
  expect(await retry.json()).toEqual({
    entry: body.entry,
    outcome: "unchanged",
  });
  expect(
    (await route("PATCH", "/broken-own", { revision: 1, action: "restore" }))
      .status,
  ).toBe(409);
  const restored = await route("PATCH", "/broken-own", {
    revision: 2,
    action: "restore",
  });
  expect((await restored.json()).entry).toMatchObject({
    revision: 3,
    status: "official",
    definition: { broken: true },
  });
  expect(
    (await route("PATCH", "/broken-own", { revision: 3, action: "restore" }))
      .status,
  ).toBe(200);
  expect(
    (await route("GET", "/broken-own?view=preview&revision=3")).status,
  ).toBe(422);
  expect(
    (await route("GET", "/broken-own?view=identity&revision=3")).status,
  ).toBe(200);
});

it("discovers and restores legacy tombstones using only metadata", async () => {
  const route = await componentLibraryHarness();
  for (const authorId of ["local", "historical-author"])
    await route.seed({
      id: `${authorId}-legacy`,
      authorId,
      definition: {},
      status: "deleted",
    });
  for (const suffix of [
    "?status=deleted",
    "?status=deleted&view=summary&catalog=1",
  ]) {
    const page = await (await route("GET", suffix)).json();
    expect(page.entries).toHaveLength(2);
    if (page.authors) expect(page.authors).toHaveLength(2);
  }
  expect(
    (await route("PATCH", "/local-legacy", { revision: 1, action: "restore" }))
      .status,
  ).toBe(200);
  expect(
    (
      await route("PATCH", "/historical-author-legacy", {
        revision: 1,
        status: "official",
      })
    ).status,
  ).toBe(200);
  expect(
    (await route("PATCH", "/missing-record", { revision: 1, action: "delete" }))
      .status,
  ).toBe(404);
});
