import { afterEach, expect, it, vi } from "vitest";
import {
  componentLibraryHarness,
  nativePackage,
} from "../../../../server/src/component-library.test-support";
import {
  captureLibraryComponent,
  saveLibraryComponent,
} from "./component-publication-host";

afterEach(() => {
  vi.unstubAllGlobals();
});

it("retains hosted unchanged/duplicate outcomes and source provenance through the shared host entry", async () => {
  const route = await componentLibraryHarness();
  vi.stubGlobal("fetch", async (input: string, init?: RequestInit) => {
    if (input === "/api/auth/me")
      return Response.json({ user: { id: "local" } });
    if (!input.startsWith("/api/components/")) throw Error("Unexpected route");
    return route(
      init!.method!,
      input.slice("/api/components".length),
      JSON.parse(String(init!.body)),
    );
  });
  const request = {
    componentId: "hosted-component",
    revision: 0,
    payload: nativePackage(),
  };
  const created = await saveLibraryComponent(request);
  expect(created.outcome).toBe("created");
  expect(
    (await saveLibraryComponent({ ...request, revision: 1 })).outcome,
  ).toBe("unchanged");
  await expect(
    saveLibraryComponent({ ...request, componentId: "duplicate-component" }),
  ).rejects.toMatchObject({
    code: "COMPONENT_ALREADY_PUBLISHED",
    existing: { id: "hosted-component", revision: 1 },
  });
  expect(
    (await captureLibraryComponent(created.entry)).definition.libraryOrigin,
  ).toMatchObject({
    componentId: "hosted-component",
    revision: 1,
    authorId: "local",
  });
});
