// Pure helpers behind scripts/promote-example.mjs: identifier rules and the
// registration codemod over apps/editor/src/examples/library-examples.ts.
// Kept side-effect free so the codemod is testable without touching files.

const SLUG_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;

export function validateExampleId(id) {
  if (!SLUG_PATTERN.test(id)) {
    return `Example id must be a kebab-case slug (got ${JSON.stringify(id)})`;
  }
  return null;
}

export function exampleAssetFileName(id) {
  return `${id}.icproj.json`;
}

/** camelCase import binding for one kebab-case example id. */
export function exampleImportName(id) {
  return id.replace(/-([a-z0-9])/gu, (_, char) => char.toUpperCase());
}

function escapeStringLiteral(value) {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

/**
 * Insert the import and registry entry for one new bundled example into the
 * `library-examples.ts` source. Returns the rewritten source, or throws with
 * a precise reason (duplicate id, unrecognized anchors) so the caller never
 * writes a half-registered file.
 */
export function registerExampleSource(source, { id, name, description }) {
  const idError = validateExampleId(id);
  if (idError) throw new Error(idError);
  if (source.includes(`id: "${id}"`)) {
    throw new Error(`Example id ${JSON.stringify(id)} is already registered`);
  }
  const importName = exampleImportName(id);
  if (new RegExp(`\\bimport ${importName}\\b`, "u").test(source)) {
    throw new Error(
      `Import name ${JSON.stringify(importName)} is already taken`,
    );
  }

  const importAnchor =
    /(import [A-Za-z0-9]+ from "\.\/[a-z0-9-]+\.icproj\.json";\n)(?![\s\S]*import [A-Za-z0-9]+ from "\.\/[a-z0-9-]+\.icproj\.json";\n)/u;
  if (!importAnchor.test(source)) {
    throw new Error("Could not find the bundled-example import block");
  }
  let next = source.replace(
    importAnchor,
    `$1import ${importName} from "./${exampleAssetFileName(id)}";\n`,
  );

  const registryAnchor = "];";
  const registryClose = next.lastIndexOf(
    registryAnchor,
    next.indexOf("export function createLibraryExampleProject"),
  );
  if (registryClose < 0) {
    throw new Error("Could not find the bundled-example registry close");
  }
  const entry = `  {
    id: "${id}",
    name: "${escapeStringLiteral(name)}",
    description: "${escapeStringLiteral(description)}",
    project: bundledProject(${importName}),
  },
`;
  next = next.slice(0, registryClose) + entry + next.slice(registryClose);
  return next;
}
