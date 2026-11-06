import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function fail(message) {
  throw new Error(`Razavi reference authority: ${message}`);
}

function resolveInside(referenceRoot, relativePath) {
  if (typeof relativePath !== "string" || relativePath.length === 0) {
    fail("missing pinned path");
  }
  const path = resolve(referenceRoot, relativePath);
  if (!path.startsWith(`${referenceRoot}${sep}`)) {
    fail(`path escapes authority root: ${relativePath}`);
  }
  return path;
}

/**
 * Load and hash-check every file pinned directly by the Razavi authority
 * manifest. Returns the parsed manifest plus the validated bytes keyed by
 * authority-relative path so consumers share one integrity boundary.
 *
 * @param {string} referenceRoot
 */
export async function loadRazaviReferenceAuthority(referenceRoot) {
  const manifest = JSON.parse(
    await readFile(resolve(referenceRoot, "manifest.json"), "utf8"),
  );
  if (
    manifest.schemaVersion !== 1 ||
    manifest.id !== "razavi-reference-v1" ||
    manifest.visualAuthority !== "sole"
  ) {
    fail("unexpected manifest identity");
  }

  const pins = [
    { path: manifest.assetPath, expected: manifest.sha256 },
    ...(manifest.supplementalAssets ?? []).map((asset) => ({
      path: asset.path,
      expected: asset.sha256,
    })),
  ];
  const vectorEvidence = manifest.vectorEvidence ?? [];
  if (!Array.isArray(vectorEvidence)) {
    fail("vectorEvidence must be an array when present");
  }
  const evidenceIds = new Set();
  for (const evidence of vectorEvidence) {
    if (
      typeof evidence?.id !== "string" ||
      evidenceIds.has(evidence.id) ||
      evidence.kind !== "pdf-vector-extract" ||
      typeof evidence.source?.sha256 !== "string" ||
      evidence.source.sha256.length !== 64 ||
      typeof evidence.source.title !== "string" ||
      !Number.isInteger(evidence.source.pdfPage) ||
      evidence.source.pdfPage <= 0 ||
      !Number.isInteger(evidence.source.printedPage) ||
      evidence.source.printedPage <= 0 ||
      typeof evidence.source.figure !== "string" ||
      !Array.isArray(evidence.scope) ||
      evidence.scope.length === 0
    ) {
      fail(`invalid vector evidence ${evidence?.id ?? "<unknown>"}`);
    }
    evidenceIds.add(evidence.id);
    pins.push(
      { path: evidence.extractPath, expected: evidence.extractSha256 },
      { path: evidence.rasterPath, expected: evidence.rasterSha256 },
    );
  }
  for (const [key, path] of Object.entries(manifest)) {
    if (!key.endsWith("Path") || key === "assetPath") continue;
    const hashKey = `${key.slice(0, -4)}Sha256`;
    pins.push({ path, expected: manifest[hashKey] });
  }

  const files = new Map();
  for (const pin of pins) {
    if (typeof pin.expected !== "string" || pin.expected.length !== 64) {
      fail(`missing SHA-256 for ${pin.path ?? "<unknown>"}`);
    }
    if (files.has(pin.path)) continue;
    const bytes = await readFile(resolveInside(referenceRoot, pin.path));
    const actual = sha256(bytes);
    if (actual !== pin.expected) {
      fail(`SHA-256 mismatch for ${pin.path}`);
    }
    files.set(pin.path, bytes);
  }

  for (const evidence of vectorEvidence) {
    let extract;
    try {
      extract = JSON.parse(files.get(evidence.extractPath).toString("utf8"));
    } catch {
      fail(`invalid vector extract JSON for ${evidence.id}`);
    }
    if (
      extract.schemaVersion !== 1 ||
      extract.id !== evidence.id ||
      extract.kind !== evidence.kind ||
      extract.source?.sha256 !== evidence.source.sha256 ||
      extract.source?.pdfPage !== evidence.source.pdfPage ||
      extract.source?.printedPage !== evidence.source.printedPage ||
      extract.source?.figure !== evidence.source.figure ||
      extract.rasterWitness?.assetPath !== evidence.rasterPath ||
      extract.rasterWitness?.kind !== "source-pdf-crop" ||
      extract.rasterWitness?.sourcePdfPage !== evidence.source.pdfPage
    ) {
      fail(`vector extract contract mismatch for ${evidence.id}`);
    }
  }

  return { manifest, files };
}
