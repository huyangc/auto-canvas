export const VERIFY_DECLARED_RELEASE_SHA_FLAG = "--verify-declared-release-sha";

/**
 * Check a declared release digest only for an explicit publishing operation.
 * Development builds still emit their SHA-256, but are not releases yet.
 */
export function assertDeclaredReleaseSha({
  verify,
  platform,
  buildPlatform,
  expectedSha,
  actualSha,
}) {
  if (!verify) return false;
  if (platform !== buildPlatform) {
    throw new Error(
      `Declared MCP release SHA-256 must be verified on ${buildPlatform}; received ${platform}`,
    );
  }
  if (!expectedSha) {
    throw new Error("Declared MCP release SHA-256 is required for publishing");
  }
  if (actualSha !== expectedSha) {
    throw new Error(
      `MCP tarball SHA-256 mismatch: expected ${expectedSha}, received ${actualSha}`,
    );
  }
  return true;
}
