import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "..");
const manifestPath = resolve(repositoryRoot, "references/manifest.json");
const gitignorePath = resolve(repositoryRoot, ".gitignore");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const gitignore = await readFile(gitignorePath, "utf8");
const failures = [];

if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.repositories)) {
  failures.push(
    "Reference manifest must use schemaVersion 1 and a repositories array",
  );
}

const names = new Set();
for (const [index, entry] of (manifest.repositories ?? []).entries()) {
  const label = `repositories[${index}]`;
  if (typeof entry.name !== "string" || entry.name.length === 0) {
    failures.push(`${label}.name must be a non-empty string`);
  } else if (names.has(entry.name)) {
    failures.push(`Duplicate reference name: ${entry.name}`);
  } else {
    names.add(entry.name);
  }
  if (
    typeof entry.repository !== "string" ||
    !entry.repository.startsWith("https://")
  ) {
    failures.push(`${label}.repository must be an HTTPS URL`);
  }
  if (
    typeof entry.revision !== "string" ||
    !/^[0-9a-f]{40}$/.test(entry.revision)
  ) {
    failures.push(
      `${label}.revision must be an immutable lowercase 40-character commit`,
    );
  }
  for (const field of ["declaredLicense", "usage"]) {
    if (typeof entry[field] !== "string" || entry[field].length === 0) {
      failures.push(`${label}.${field} must be a non-empty string`);
    }
  }
  for (const field of ["allowedScope", "excludedScope"]) {
    if (!Array.isArray(entry[field]) || entry[field].length === 0) {
      failures.push(`${label}.${field} must be a non-empty array`);
    }
  }
}

if (!gitignore.split(/\r?\n/u).includes(".reference-src/")) {
  failures.push(".reference-src/ must remain ignored");
}

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(failure);
  }
  process.exitCode = 1;
} else {
  console.log(
    `Validated ${manifest.repositories.length} pinned reference entries`,
  );
}
