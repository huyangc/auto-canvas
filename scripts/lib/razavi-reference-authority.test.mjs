import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadRazaviReferenceAuthority } from "./razavi-reference-authority.mjs";

const roots = [];
const hash = (value) => createHash("sha256").update(value).digest("hex");

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function fixture({ vector = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), "razavi-authority-"));
  roots.push(root);
  const raster = Buffer.from("raster");
  await writeFile(join(root, "authority.png"), raster);
  const manifest = {
    schemaVersion: 1,
    id: "razavi-reference-v1",
    visualAuthority: "sole",
    assetPath: "authority.png",
    sha256: hash(raster),
  };
  if (vector) {
    const source = {
      title: "Textbook",
      sha256: "a".repeat(64),
      pdfPage: 639,
      printedPage: 620,
      figure: "15.21",
    };
    const extract = Buffer.from(
      `${JSON.stringify({
        schemaVersion: 1,
        id: "inductor",
        kind: "pdf-vector-extract",
        source,
        rasterWitness: {
          kind: "source-pdf-crop",
          sourcePdfPage: source.pdfPage,
          assetPath: "inductor.png",
        },
      })}\n`,
    );
    const witness = Buffer.from("witness");
    await writeFile(join(root, "inductor.json"), extract);
    await writeFile(join(root, "inductor.png"), witness);
    manifest.vectorEvidence = [
      {
        id: "inductor",
        kind: "pdf-vector-extract",
        source,
        extractPath: "inductor.json",
        extractSha256: hash(extract),
        rasterPath: "inductor.png",
        rasterSha256: hash(witness),
        scope: ["inductor geometry"],
      },
    ];
  }
  await writeFile(
    join(root, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  return root;
}

describe("Razavi reference authority", () => {
  it("keeps schema-v1 manifests without vector evidence compatible", async () => {
    const authority = await loadRazaviReferenceAuthority(await fixture());
    expect([...authority.files.keys()]).toEqual(["authority.png"]);
  });

  it("hash-checks optional PDF vector evidence and its raster witness", async () => {
    const authority = await loadRazaviReferenceAuthority(
      await fixture({ vector: true }),
    );
    expect([...authority.files.keys()]).toEqual([
      "authority.png",
      "inductor.json",
      "inductor.png",
    ]);
  });

  it("rejects a modified vector extract", async () => {
    const root = await fixture({ vector: true });
    await writeFile(join(root, "inductor.json"), "modified");
    await expect(loadRazaviReferenceAuthority(root)).rejects.toThrow(
      "SHA-256 mismatch for inductor.json",
    );
  });
});
