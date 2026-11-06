// @vitest-environment node
import { expect, it, vi } from "vitest";
import {
  publicationAccount,
  publishSharedComponent,
  loadSharedComponentSummaries,
  checkSharedComponentRevision,
  readSharedComponentPreview,
  readSharedComponent,
  changeComponentLifecycle,
} from "../../editor/src/features/user-components/component-library-client.js";
import {
  componentLibraryHarness,
  nativePackage,
} from "./component-library.test-support.js";
import { createApp } from "./app.js";

it("drives publication, catalog revalidation, views, update, deletion and restoration through the editor client", async () => {
  const route = await componentLibraryHarness();
  let app = route.app;
  const fetchLike: typeof fetch = async (input, init) =>
    app.request(new URL(String(input), "https://components.test"), init);
  vi.stubGlobal("fetch", fetchLike);
  try {
    expect(await publicationAccount(fetchLike)).toEqual({
      id: "local",
      isAdmin: true,
    });
    const payload = nativePackage();
    const saved = await publishSharedComponent(
      "client-component",
      0,
      payload.definition,
      payload.circuit,
      { idempotencyKey: "client-create", fetch: fetchLike },
    );
    expect(saved.outcome).toBe("created");
    app = createApp({ db: route.db });
    expect(await readSharedComponent(saved.entry.id, fetchLike)).toEqual(
      saved.entry,
    );
    const catalog = {
      version: 1,
      type: "all",
      order: "circuit-first",
    } as const;
    const page = await loadSharedComponentSummaries(
      "",
      null,
      false,
      undefined,
      fetchLike,
      catalog,
    );
    expect(page.entries).toHaveLength(1);
    const summary = page.entries[0]!;
    expect(
      await loadSharedComponentSummaries(
        "",
        null,
        false,
        undefined,
        fetchLike,
        catalog,
        page.catalogRevision,
      ),
    ).toMatchObject({ entries: [], notModified: true });
    await checkSharedComponentRevision(summary);
    expect(await readSharedComponentPreview(summary)).toEqual(
      saved.entry.definition.symbol,
    );
    payload.definition.symbol.name = "Client revised";
    const updated = await publishSharedComponent(
      saved.entry.id,
      1,
      payload.definition,
      payload.circuit,
      { fetch: fetchLike },
    );
    expect(updated).toMatchObject({
      outcome: "updated",
      entry: { revision: 2, authorId: "local" },
    });
    await expect(checkSharedComponentRevision(summary)).rejects.toMatchObject({
      status: 409,
    });
    const deleted = await changeComponentLifecycle(
      updated.entry,
      "delete",
      fetchLike,
    );
    expect(deleted.entry).toMatchObject({ status: "deleted", revision: 3 });
    expect(
      (
        await loadSharedComponentSummaries(
          "",
          null,
          false,
          undefined,
          fetchLike,
          catalog,
        )
      ).entries,
    ).toEqual([]);
    expect(
      (
        await loadSharedComponentSummaries(
          "",
          null,
          true,
          undefined,
          fetchLike,
          catalog,
        )
      ).entries,
    ).toHaveLength(1);
    const restored = await changeComponentLifecycle(
      deleted.entry,
      "restore",
      fetchLike,
    );
    expect(restored.entry).toMatchObject({ status: "shared", revision: 4 });
    expect(
      (await readSharedComponent(saved.entry.id, fetchLike)).definition.symbol
        .id,
    ).toBe("user-client-component-r2");
  } finally {
    vi.unstubAllGlobals();
  }
});
