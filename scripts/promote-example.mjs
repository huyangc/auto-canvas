// Promote one exported `.icproj.json` into the bundled Library examples.
//
// The Examples panel's "My examples" are origin-local browser snapshots; the
// bundled library is repository source shipped to every visitor. This script
// is the channel between them: it validates the exported Project through the
// ordinary protocol boundary (rolling-window upgrades apply), writes the
// canonical prettier-formatted asset, and registers it in
// `library-examples.ts`. Committing the result through the normal delivery
// gate publishes the example for everyone.
//
// Usage:
//   node scripts/promote-example.mjs <exported.icproj.json> \
//     --id <kebab-slug> --name "Display Name" --description "One line"
//
// Follow-up printed on success: focused example tests plus the ordinary
// mainline delivery gate.

import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { format } from "prettier";

import {
  exampleAssetFileName,
  registerExampleSource,
  validateExampleId,
} from "./lib/example-promotion.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const examplesRoot = resolve(root, "apps/editor/src/examples");
const registryPath = resolve(examplesRoot, "library-examples.ts");

function fail(message) {
  console.error(`promote-example: ${message}`);
  process.exit(1);
}

function parseArguments(argv) {
  const positional = [];
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (
      argument === "--id" ||
      argument === "--name" ||
      argument === "--description"
    ) {
      const value = argv[index + 1];
      if (value === undefined) fail(`${argument} requires a value`);
      options[argument.slice(2)] = value;
      index += 1;
    } else if (argument.startsWith("--")) {
      fail(`Unknown option ${argument}`);
    } else {
      positional.push(argument);
    }
  }
  return { positional, options };
}

const { positional, options } = parseArguments(process.argv.slice(2));
if (positional.length !== 1 || !options.id || !options.name) {
  fail(
    'usage: node scripts/promote-example.mjs <exported.icproj.json> --id <slug> --name "Display Name" [--description "One line"]',
  );
}
const idError = validateExampleId(options.id);
if (idError) fail(idError);
const description = options.description ?? "";

const { parseProject, serializeProject } =
  await import("../packages/project-protocol/dist/index.js").catch(() =>
    fail(
      "packages/project-protocol/dist is missing — build it first (pnpm build, or tsc -p packages/project-protocol)",
    ),
  );

const sourceText = await readFile(resolve(positional[0]), "utf8").catch(
  (error) => fail(`Cannot read ${positional[0]}: ${error.message}`),
);
let project;
try {
  project = parseProject(sourceText);
} catch (error) {
  fail(`Exported Project is not loadable: ${error.message}`);
}
// The bundled display name comes from the registry entry; keep the persisted
// Project name in sync so opening the example shows the same identity.
project.name = options.name;

const registrySource = await readFile(registryPath, "utf8");
let nextRegistry;
try {
  nextRegistry = registerExampleSource(registrySource, {
    id: options.id,
    name: options.name,
    description,
  });
} catch (error) {
  fail(error.message);
}

const assetPath = resolve(examplesRoot, exampleAssetFileName(options.id));
const assetText = await format(serializeProject(project), { parser: "json" });
await writeFile(assetPath, assetText, "utf8");
await writeFile(registryPath, nextRegistry, "utf8");

console.log(`Promoted ${options.id} (schema ${project.schemaVersion}):`);
console.log(
  `  wrote apps/editor/src/examples/${exampleAssetFileName(options.id)}`,
);
console.log("  registered in apps/editor/src/examples/library-examples.ts");
console.log("Verify with:");
console.log(
  "  pnpm test:local apps/editor/src/examples apps/editor/src/features/editor-shell",
);
console.log("then deliver through the ordinary mainline gate.");
