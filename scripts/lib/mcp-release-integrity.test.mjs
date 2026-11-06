import { describe, expect, it } from "vitest";

import {
  assertDeclaredReleaseSha,
  VERIFY_DECLARED_RELEASE_SHA_FLAG,
} from "./mcp-release-integrity.mjs";

const expectedSha = "a".repeat(64);

describe("MCP release integrity", () => {
  it("does not bind ordinary development packages to a published release", () => {
    expect(
      assertDeclaredReleaseSha({
        verify: false,
        platform: "linux",
        buildPlatform: "linux",
        expectedSha,
        actualSha: "b".repeat(64),
      }),
    ).toBe(false);
  });

  it("accepts a declared SHA only for a matching Linux release artifact", () => {
    expect(
      assertDeclaredReleaseSha({
        verify: true,
        platform: "linux",
        buildPlatform: "linux",
        expectedSha,
        actualSha: expectedSha,
      }),
    ).toBe(true);
  });

  it("rejects a mismatched declared release SHA", () => {
    expect(() =>
      assertDeclaredReleaseSha({
        verify: true,
        platform: "linux",
        buildPlatform: "linux",
        expectedSha,
        actualSha: "b".repeat(64),
      }),
    ).toThrow("MCP tarball SHA-256 mismatch");
  });

  it("requires the declared release check to run on its release platform", () => {
    expect(() =>
      assertDeclaredReleaseSha({
        verify: true,
        platform: "win32",
        buildPlatform: "linux",
        expectedSha,
        actualSha: expectedSha,
      }),
    ).toThrow("must be verified on linux");
  });

  it("keeps the publishing switch explicit", () => {
    expect(VERIFY_DECLARED_RELEASE_SHA_FLAG).toBe(
      "--verify-declared-release-sha",
    );
  });
});
