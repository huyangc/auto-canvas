// Vite config and the standalone lock verifier load this before workspace packages are built.
import { digestSha256Hex } from "@icm/model/sha256";
import lock from "./rnl-canvas-package.lock.json" with { type: "json" };

/** Every version the editor ships, so a file written with any of them reads. */
export const canvasPackageLock = lock;

/** The version the editor writes: the newest it ships. */
export const canvasPackageVersion = lock.versions.at(-1)!.version;

/** The file each version ships as, beside this module. */
export const canvasPackageFile = (version: string) =>
  `${lock.name}-${version}.rnl`;

/** Verify original bytes before decoding, in the build, Node tests and editor. */
export async function decodeCanvasPackage(
  bytes: Uint8Array,
  version: string,
): Promise<string> {
  const pinned = lock.versions.find((item) => item.version === version);
  if (!pinned) throw new Error(`Canvas package ${version} is not locked`);
  const hash = await digestSha256Hex(bytes);
  if (hash !== pinned.sha256)
    throw new Error(
      `Canvas package SHA-256 mismatch: expected ${pinned.sha256} for ${version}, received ${hash}`,
    );
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}
