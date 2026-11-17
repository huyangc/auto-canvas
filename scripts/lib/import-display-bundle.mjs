// The editor's SPICE import step as one Node module for the netlist-input
// evaluation (T128): prepareImportSources (what the editor hands the
// importer) and withImportedInstanceDisplays (what it applies to the imported
// Project), both from apps/editor/src. Every @icm/* import stays external and
// resolves to packages/<name>/dist/index.js, so the evaluation runs the same
// built packages as scripts/auto-layout-eval.mjs.
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { build } from "vite";

const root = resolve(import.meta.dirname, "../..");
const ENTRY = "\0netlist-input-import-display";
const sources = [
  "apps/editor/src/features/netlist-export/convert-import-sources.ts",
  "apps/editor/src/features/instance-display/imported-instance-displays.ts",
].map((path) => resolve(root, path));

/** `@icm/<name>` to the built package; a subpath import is not expected here. */
function builtPackage(id) {
  const name = id.slice("@icm/".length);
  if (name.includes("/"))
    throw new Error(
      `Unsupported @icm subpath import in the import step: ${id}`,
    );
  return resolve(root, "packages", name, "dist/index.js");
}

/** True when the bundle is missing or any file it was built from is newer. */
function stale(bundle, manifest) {
  if (!existsSync(bundle) || !existsSync(manifest)) return true;
  const built = statSync(bundle).mtimeMs;
  const files = JSON.parse(readFileSync(manifest, "utf8"));
  return [...files, import.meta.filename].some(
    (file) => !existsSync(file) || statSync(file).mtimeMs > built,
  );
}

/**
 * Builds the import step into `<outDir>/import-display.mjs` unless it is up to
 * date, and returns that path. `<outDir>/sources.json` lists the app source
 * files the bundle contains. Each build writes into a directory of its own
 * and renames its files into place, so two processes rebuilding at once never
 * leave a half-written bundle.
 */
export async function bundleImportDisplay(
  outDir = resolve(root, "tmp/netlist-input/.bundle"),
) {
  const bundle = resolve(outDir, "import-display.mjs");
  const manifest = resolve(outDir, "sources.json");
  if (!stale(bundle, manifest)) return bundle;
  mkdirSync(outDir, { recursive: true });
  const scratch = mkdtempSync(resolve(outDir, "build-"));
  try {
    await buildInto(scratch);
    // The bundle first, the manifest last: a reader that sees the new bundle
    // beside the old manifest at worst rebuilds once more.
    renameSync(resolve(scratch, "import-display.mjs"), bundle);
    renameSync(resolve(scratch, "sources.json"), manifest);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  return bundle;
}

async function buildInto(outDir) {
  const output = await build({
    root,
    configFile: false,
    logLevel: "warn",
    plugins: [
      {
        name: "netlist-input-import-display",
        enforce: "pre",
        resolveId(id) {
          if (id === ENTRY) return ENTRY;
          if (id.startsWith("@icm/"))
            return { id: builtPackage(id), external: true };
          return null;
        },
        load(id) {
          if (id !== ENTRY) return null;
          return [
            `export { prepareImportSources } from ${JSON.stringify(sources[0])};`,
            `export { withImportedInstanceDisplays } from ${JSON.stringify(sources[1])};`,
          ].join("\n");
        },
      },
    ],
    build: {
      ssr: true,
      outDir,
      emptyOutDir: false,
      target: "node24",
      minify: false,
      rollupOptions: {
        input: { "import-display": ENTRY },
        output: {
          entryFileNames: "import-display.mjs",
          codeSplitting: false,
        },
      },
    },
  });
  const chunks = (Array.isArray(output) ? output : [output]).flatMap(
    (item) => item.output ?? [],
  );
  const files = [
    ...new Set(
      chunks
        .flatMap((chunk) => chunk.moduleIds ?? Object.keys(chunk.modules ?? {}))
        .filter((id) => id.startsWith(`${root}/apps/`)),
    ),
  ].sort();
  if (!files.length)
    throw new Error("The import step bundle lists no editor source files");
  writeFileSync(
    resolve(outDir, "sources.json"),
    `${JSON.stringify(files, null, 2)}\n`,
  );
}
