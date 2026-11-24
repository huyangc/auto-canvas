// The canvas server (apps/server/src/cli.ts) as one Node module, with every
// dependency inlined, for the offline silicon-notebook package
// (scripts/package-notebook-canvas.mjs). Modelled on headless-bundle.mjs.
import { readdirSync, readFileSync } from "node:fs";
import { isBuiltin } from "node:module";
import { basename, dirname, join, resolve } from "node:path";
import { build } from "vite";

const root = resolve(import.meta.dirname, "../..");

/**
 * Optional native add-ons the bundled CommonJS code loads only inside a
 * `try` (`ws`) or behind a getter (`pg.native`). They stay plain `require`
 * calls, so a missing one fails with MODULE_NOT_FOUND exactly as it does in
 * a checkout (vite would otherwise inline a stub that throws another error).
 */
export const OPTIONAL_REQUIRES = Object.freeze([
  "pg-native",
  "bufferutil",
  "utf-8-validate",
]);

/**
 * Builds the server into `outFile` (its directory is not emptied) and
 * returns the module ids the build read and the ones the bundle contains.
 * `new URL("./migrations/", import.meta.url)` is left as it is, so the
 * migrations are looked up beside the bundle; JSON is inlined.
 */
export async function bundleServer(outFile) {
  const read = new Set();
  let included = [];
  let outputs = [];
  await build({
    root,
    configFile: false,
    logLevel: "warn",
    resolve: { conditions: ["development"] },
    ssr: {
      noExternal: true,
      resolve: {
        conditions: ["development"],
        externalConditions: ["development"],
      },
    },
    plugins: [
      {
        name: "auto-canvas-server-bundle-modules",
        enforce: "pre",
        load(id) {
          read.add(id);
          return null;
        },
        moduleParsed(info) {
          read.add(info.id);
        },
        generateBundle(_options, bundle) {
          outputs = Object.keys(bundle).sort();
          included = Object.values(bundle).flatMap((chunk) =>
            chunk.type === "chunk" ? chunk.moduleIds : [],
          );
        },
      },
    ],
    build: {
      ssr: resolve(root, "apps/server/src/cli.ts"),
      outDir: dirname(outFile),
      emptyOutDir: false,
      target: "node24",
      minify: false,
      rollupOptions: {
        external: [...OPTIONAL_REQUIRES],
        output: {
          entryFileNames: basename(outFile),
          codeSplitting: false,
        },
      },
    },
  });
  return {
    outputs,
    readIds: [...read].sort(),
    moduleIds: [...new Set(included)].sort(),
  };
}

// A call of import(), require() or the bundler's __require(), not a method.
const CALL = /(?<![\w$.])(import|require|__require)\s*\(\s*/gu;
// A string literal without escapes or substitutions, closing the call.
const LITERAL = /^(?:"([^"\\\n]*)"|'([^'\\\n]*)'|`([^`\\$]*)`)\s*\)/u;
// A top-level static import or re-export with a module specifier.
const STATIC =
  /^(?:import|export)\b[^\n;'"]*?(?:\bfrom\s*)?["']([^"'\n]+)["']\s*;?\s*$/gmu;

function lineOf(text, index) {
  return text.slice(0, index).split("\n").length;
}

/**
 * The bundle guard's scan of the output text: every dynamic import or
 * require must name a literal module, and every module the bundle loads at
 * run time must be a Node builtin or one of OPTIONAL_REQUIRES (require
 * only). Returns one message per problem, empty when the bundle is
 * self-contained.
 */
export function scanBundle(text) {
  const problems = [];
  for (const match of text.matchAll(STATIC)) {
    const specifier = match[1];
    if (!isBuiltin(specifier))
      problems.push(
        `line ${lineOf(text, match.index)}: a static import of "${specifier}", which is not a Node builtin`,
      );
  }
  for (const match of text.matchAll(CALL)) {
    const kind = match[1] === "import" ? "import()" : "require()";
    const line = lineOf(text, match.index);
    const literal = LITERAL.exec(text.slice(match.index + match[0].length));
    if (!literal) {
      problems.push(`line ${line}: ${kind} with a non-literal argument`);
      continue;
    }
    const specifier = literal[1] ?? literal[2] ?? literal[3];
    if (isBuiltin(specifier)) continue;
    if (kind === "require()" && OPTIONAL_REQUIRES.includes(specifier)) continue;
    problems.push(
      `line ${line}: ${kind} of "${specifier}", which is not a Node builtin${kind === "require()" ? " or an optional add-on" : ""}`,
    );
  }
  return problems;
}

/**
 * The guard's check of what the build read: no native add-on (`.node`).
 */
export function nativeModules(readIds) {
  return readIds.filter((id) => /\.node(?:$|\?)/u.test(id));
}

const NODE_MODULES = "/node_modules/";

/**
 * The root directory of each third-party package a module id lies in (the
 * last `node_modules/<name>` or `node_modules/@scope/<name>` segment), once
 * each, sorted. Virtual ids (`\0…`) and first-party files are skipped.
 */
export function packageRoots(moduleIds) {
  const roots = new Set();
  for (const raw of moduleIds) {
    if (raw.startsWith("\0")) continue;
    const id = raw.replaceAll("\\", "/").split("?")[0];
    const at = id.lastIndexOf(NODE_MODULES);
    if (at < 0) continue;
    const parts = id.slice(at + NODE_MODULES.length).split("/");
    const name = parts[0].startsWith("@")
      ? `${parts[0]}/${parts[1]}`
      : parts[0];
    roots.add(id.slice(0, at + NODE_MODULES.length) + name);
  }
  return [...roots].sort();
}

const LICENCE_FILE = /^(?:LICEN[CS]E|COPYING|NOTICE)/iu;

function licenceField(manifest) {
  const { license, licenses } = manifest;
  if (typeof license === "string") return license;
  if (license && typeof license.type === "string") return license.type;
  if (Array.isArray(licenses))
    return licenses
      .map((entry) => (typeof entry === "string" ? entry : entry?.type))
      .filter(Boolean)
      .join(" OR ");
  return "UNKNOWN";
}

/**
 * Name, version, licence field and licence files' text of each package root,
 * sorted by name and version, once per name and version.
 */
export function collectLicences(roots) {
  const packages = new Map();
  for (const packageRoot of roots) {
    const manifest = JSON.parse(
      readFileSync(join(packageRoot, "package.json"), "utf8"),
    );
    const key = `${manifest.name}@${manifest.version}`;
    if (packages.has(key)) continue;
    const files = readdirSync(packageRoot, { withFileTypes: true })
      .filter((entry) => entry.isFile() && LICENCE_FILE.test(entry.name))
      .map((entry) => entry.name)
      .sort();
    packages.set(key, {
      name: manifest.name,
      version: manifest.version,
      license: licenceField(manifest),
      files: files.map((file) => ({
        file,
        text: readFileSync(join(packageRoot, file), "utf8"),
      })),
    });
  }
  return [...packages.values()].sort(
    (a, b) =>
      a.name.localeCompare(b.name, "en") ||
      a.version.localeCompare(b.version, "en"),
  );
}

const RULE = "=".repeat(72);
export const NO_LICENCE_TEXT = "licence text not shipped by the package";

/** THIRD-PARTY-NOTICES.txt for the packages `collectLicences` returned. */
export function noticesText(packages) {
  const sections = packages.map((entry) => {
    const texts = entry.files.length
      ? entry.files
          .map(({ file, text }) => `--- ${file} ---\n${text.trimEnd()}\n`)
          .join("\n")
      : `(${NO_LICENCE_TEXT})\n`;
    return `${RULE}\n${entry.name} ${entry.version}\nLicense: ${entry.license}\n\n${texts}`;
  });
  return `Third-party software bundled in apps/server/dist/cli.js\n\n${sections.join("\n")}`;
}
