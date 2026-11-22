// The notebook build (VITE_AUTO_CANVAS_AUTH=notebook) and the standard build
// from the one real editor config: the standard output holds nothing of the
// notebook gate, and no executable reference of the notebook output leaves
// its deployment under /canvas/.
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { JSDOM } from "jsdom";
import { build, parseAst, resolveConfig } from "vite";
import { expect, it } from "vitest";
import webConfig from "../apps/editor/vite.config.ts";

const root = resolve("apps/editor");
const configUrl = pathToFileURL(resolve(root, "vite.config.ts")).href;
const DEPLOY = "https://deploy.example/canvas/";
const TOKEN_KEY = "silicon_notebook_token";
const DEFINE = "import.meta.env.ICM_NOTEBOOK";
const ENV_NAMES = [
  "VITE_AUTO_CANVAS_AUTH",
  "AUTO_CANVAS_BASE_PATH",
  "NODE_ENV",
];

/** Runs with exactly these variables set (others of ENV_NAMES unset). */
async function withEnvironment(values, action) {
  const previous = Object.fromEntries(
    ENV_NAMES.map((name) => [name, process.env[name]]),
  );
  for (const name of ENV_NAMES)
    if (values[name] === undefined) delete process.env[name];
    else process.env[name] = values[name];
  try {
    return await action();
  } finally {
    for (const name of ENV_NAMES)
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
  }
}

let evaluation = 0;
/**
 * The real config, evaluated afresh under the current environment (it reads
 * AUTO_CANVAS_BASE_PATH as it evaluates). A new query is a new module here.
 */
async function freshConfig() {
  evaluation += 1;
  const module = await import(
    /* @vite-ignore */ `${configUrl}?evaluation=${evaluation}`
  );
  return module.default;
}

async function buildEditor(values) {
  // Vitest sets NODE_ENV=test, which Vite would honour with a development
  // build; `vite build` from a shell runs with it unset.
  return withEnvironment({ ...values, NODE_ENV: undefined }, async () => {
    const config = await freshConfig();
    const result = await build({
      ...config,
      configFile: false,
      root,
      logLevel: "silent",
      build: { ...config.build, write: false },
    });
    return (Array.isArray(result) ? result : [result]).flatMap(
      (item) => item.output,
    );
  });
}

const text = (item) =>
  item.type === "chunk"
    ? item.code
    : typeof item.source === "string"
      ? item.source
      : Buffer.from(item.source).toString("latin1");

/** Worker JavaScript reaches the main build as assets, not chunks. */
const workerAssets = (output) =>
  output.filter(
    (item) => item.type === "asset" && /\.m?js$/u.test(item.fileName),
  );

const renderedModules = (output) =>
  output
    .filter((item) => item.type === "chunk")
    .flatMap((chunk) =>
      Object.entries(chunk.modules)
        .filter(([, module]) => module.renderedLength > 0)
        .map(([id]) => id.replaceAll("\\", "/")),
    );

const isLocal = (url) =>
  url.origin === new URL(DEPLOY).origin && url.pathname.startsWith("/canvas/");

function expectLocal(target, base, where) {
  const url = new URL(target, base);
  expect(isLocal(url), `${where}: ${target} resolves to ${url.href}`).toBe(
    true,
  );
}

// The computed targets the editor output already holds, per occurrence.
// Identifiers are the minifier's and may change; the shapes may not.
const ID = "[\\w$]+";
const COMPUTED = [
  {
    name: "Vite preload helper",
    pattern: new RegExp(
      `import\\.meta\\.resolve\\?import\\.meta\\.resolve\\((${ID})\\):(new URL\\(\\1,import\\.meta\\.url\\))\\.href`,
      "gu",
    ),
  },
  {
    name: "RNL client, browser Worker at a caller-supplied location",
    pattern: new RegExp(
      `:new Worker\\((new URL\\(${ID},import\\.meta\\.url\\)),\\{type:\`module\`\\}\\)`,
      "gu",
    ),
  },
  {
    name: "RNL client, Node worker thread",
    pattern: new RegExp(
      `=new ${ID}\\((new URL\\(${ID}\\?\\?\`\\.\\/worker\\.js\`,import\\.meta\\.url\\))\\)`,
      "gu",
    ),
  },
];

const LITERAL = /^(?:`[^`$]*`|"[^"\\]*"|'[^'\\]*')$/u;

const URL_PATTERN =
  /new URL\(((?:[^()]|\([^()]*\))*?),(?:``\+)?import\.meta\.url\)/gu;

/**
 * Every `new URL(<target>, import.meta.url)` and `new Worker(...)` in the
 * code of `sources` ({ fileName, code }): literal targets must be local;
 * computed ones must be one of COMPUTED, matched occurrence by occurrence;
 * a Worker's first argument must itself be one of those accepted URLs, and
 * nothing more. Returns the problems and how often each COMPUTED shape
 * occurred.
 */
function codeTargetProblems(sources) {
  const problems = [];
  const found = new Map(COMPUTED.map(({ name }) => [name, 0]));
  for (const { fileName, code } of sources) {
    const base = new URL(fileName, DEPLOY);
    const recognised = new Set();
    for (const { name, pattern } of COMPUTED)
      for (const match of code.matchAll(pattern)) {
        const start = match.index + match[0].indexOf(match.at(-1));
        recognised.add(start);
        found.set(name, found.get(name) + 1);
      }
    // Start of each accepted `new URL(…, import.meta.url)` -> its end.
    const accepted = new Map();
    const urls = [...code.matchAll(URL_PATTERN)];
    for (const match of urls) {
      const target = match[1].trim();
      const end = match.index + match[0].length;
      if (LITERAL.test(target)) {
        const url = new URL(target.slice(1, -1), base);
        if (isLocal(url)) accepted.set(match.index, end);
        else problems.push(`${fileName}: ${target} resolves to ${url.href}`);
      } else if (recognised.has(match.index)) accepted.set(match.index, end);
      else
        problems.push(
          `${fileName}: computed new URL(${target}, import.meta.url)`,
        );
    }
    for (const match of code.matchAll(/new (?:Shared)?Worker\(/gu)) {
      const argument = match.index + match[0].length;
      const end = accepted.get(argument);
      if (end === undefined || !/^[,)]/u.test(code.slice(end)))
        problems.push(
          `${fileName}: Worker argument is not an accepted new URL(…, import.meta.url): ${code.slice(argument, argument + 60)}`,
        );
    }
    // Anything else resolved against the module's own address.
    if (code.split("import.meta.url").length - 1 !== urls.length)
      problems.push(`${fileName}: import.meta.url outside new URL`);
  }
  return { problems, found };
}

function checkCodeTargets(output) {
  const sources = [
    ...output.filter((item) => item.type === "chunk"),
    ...workerAssets(output),
  ].map((item) => ({ fileName: item.fileName, code: text(item) }));
  const { problems, found } = codeTargetProblems(sources);
  expect(problems).toEqual([]);
  for (const [name, count] of found)
    expect(count, `${name} occurrences`).toBe(1);
}

it("reports a Worker whose first argument is not an accepted local URL", () => {
  const { problems } = codeTargetProblems([
    {
      fileName: "assets/synthetic.js",
      code: [
        'new Worker(new URL("./ok.js",import.meta.url),{type:"module"});',
        'new Worker(new URL("https://evil.example/w.js", document.baseURI));',
        'new Worker("https://evil.example/w.js");',
      ].join(""),
    },
  ]);
  expect(problems).toHaveLength(2);
  expect(problems[0]).toMatch(/Worker argument.*document\.baseURI/u);
  expect(problems[1]).toMatch(
    /Worker argument.*: "https:\/\/evil\.example\/w\.js"\)/u,
  );
});

/**
 * The script and style references of a page as an HTML parser reads them
 * (any quoting, any case): every script source and every link that loads a
 * stylesheet or a module.
 */
function htmlReferences(page) {
  const { document } = new JSDOM(page).window;
  const loads = (link) =>
    (link.getAttribute("rel") ?? "")
      .toLowerCase()
      .split(/\s+/u)
      .some((token) =>
        ["modulepreload", "preload", "stylesheet"].includes(token),
      );
  return {
    base: document.querySelector("base") !== null,
    references: [
      ...[...document.querySelectorAll("script[src]")].map((script) =>
        script.getAttribute("src"),
      ),
      ...[...document.querySelectorAll("link[href]")]
        .filter(loads)
        .map((link) => link.getAttribute("href")),
    ],
  };
}

it("reads script and style references in any quoting and case", () => {
  expect(
    htmlReferences(
      [
        "<!doctype html><head>",
        "<script src='https://evil.example/a.js'></script>",
        "<SCRIPT type=module SRC=https://evil.example/b.js></SCRIPT>",
        "<link rel=stylesheet href=https://evil.example/c.css>",
        "<link REL='alternate StyleSheet' HREF='https://evil.example/d.css'>",
        '<link rel="modulepreload" href="/canvas/assets/e.js">',
        '<link rel="icon" href="https://elsewhere.example/icon.svg">',
        "<script>inline()</script>",
        "</head>",
      ].join(""),
    ),
  ).toEqual({
    base: false,
    references: [
      "https://evil.example/a.js",
      "https://evil.example/b.js",
      "https://evil.example/c.css",
      "https://evil.example/d.css",
      "/canvas/assets/e.js",
    ],
  });
  expect(htmlReferences("<base href='https://evil.example/'>").base).toBe(true);
});

/** Static and dynamic imports in emitted worker JavaScript, from its AST. */
function workerImports(code, fileName) {
  const specifiers = [];
  const visit = (node) => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!node || typeof node !== "object") return;
    if (
      (node.type === "ImportDeclaration" ||
        node.type === "ExportAllDeclaration" ||
        node.type === "ExportNamedDeclaration") &&
      node.source
    )
      specifiers.push(node.source.value);
    if (node.type === "ImportExpression") {
      const source = node.source;
      const literal =
        source.type === "Literal" && typeof source.value === "string"
          ? source.value
          : source.type === "TemplateLiteral" && source.expressions.length === 0
            ? source.quasis[0].value.cooked
            : null;
      expect(literal, `${fileName}: computed import()`).not.toBeNull();
      specifiers.push(literal);
    }
    for (const value of Object.values(node))
      if (value && typeof value === "object") visit(value);
  };
  visit(parseAst(code));
  return specifiers;
}

function expectStandard(output) {
  expect(output.length).toBeGreaterThan(0);
  for (const item of output) {
    expect(text(item), item.fileName).not.toContain(TOKEN_KEY);
    expect(item.fileName).not.toContain("@notebook");
  }
  const modules = renderedModules(output);
  expect(modules.length).toBeGreaterThan(0);
  for (const id of modules) {
    expect(id).not.toMatch(/\/apps\/editor\/src\/notebook\//u);
    expect(id).not.toMatch(/\/apps\/editor\/src\/entries\/notebook\.tsx$/u);
  }
}

it("keeps the notebook gate out of the standard build with VITE_AUTO_CANVAS_AUTH unset", async () => {
  expectStandard(await buildEditor({}));
}, 120_000);

it("keeps the notebook gate out of the standard build with VITE_AUTO_CANVAS_AUTH=local", async () => {
  expectStandard(await buildEditor({ VITE_AUTO_CANVAS_AUTH: "local" }));
}, 120_000);

it("builds the notebook editor with every executable reference inside /canvas/", async () => {
  // Exactly the environment of `pnpm build:notebook-editor`.
  const output = await buildEditor({
    AUTO_CANVAS_BASE_PATH: "/canvas",
    VITE_AUTO_CANVAS_AUTH: "notebook",
  });
  expect(
    output.some(
      (item) => item.type === "chunk" && item.code.includes(TOKEN_KEY),
    ),
  ).toBe(true);
  for (const item of output) expect(item.fileName).not.toContain("@notebook");

  const html = output.find((item) => item.fileName === "index.html");
  const { references, base } = htmlReferences(text(html));
  // A <base> would move every relative reference.
  expect(base).toBe(false);
  expect(references.length).toBeGreaterThan(0);
  for (const reference of references)
    expectLocal(reference, DEPLOY, "index.html");

  const fileNames = new Set(output.map((item) => item.fileName));
  for (const chunk of output.filter((item) => item.type === "chunk")) {
    // (A pure-CSS chunk Vite removed stays listed here, so only locality.)
    for (const target of [...chunk.imports, ...chunk.dynamicImports])
      expectLocal(target, DEPLOY, chunk.fileName);
    // The preload helper's operands: the dependency lists Vite emits.
    for (const list of chunk.code.matchAll(
      /__vite__mapDeps=\(i,m=__vite__mapDeps,d=\(m\.f\|\|\(m\.f=(\[[^\]]*\])/gu,
    ))
      for (const dependency of JSON.parse(list[1])) {
        expectLocal(dependency, DEPLOY, `${chunk.fileName} preload`);
        expect(fileNames.has(dependency), dependency).toBe(true);
      }
    const metadata = chunk.viteMetadata;
    for (const dependency of [
      ...(metadata?.importedCss ?? []),
      ...(metadata?.importedAssets ?? []),
    ])
      expectLocal(dependency, DEPLOY, `${chunk.fileName} metadata`);
  }
  // The helper prefixes each dependency with the deployment's base.
  const helper = output.find(
    (item) => item.type === "chunk" && item.code.includes("vite:preloadError"),
  );
  expect(helper.code).toMatch(
    new RegExp(`=function\\(${ID}\\)\\{return\`/canvas/\`\\+${ID}\\}`, "u"),
  );

  const workers = workerAssets(output);
  expect(workers.length).toBeGreaterThan(0);
  for (const worker of workers) {
    const base = new URL(worker.fileName, DEPLOY);
    for (const specifier of workerImports(text(worker), worker.fileName)) {
      expectLocal(specifier, base, worker.fileName);
      expect(
        fileNames.has(
          new URL(specifier, base).pathname.slice("/canvas/".length),
        ),
        `${worker.fileName} -> ${specifier}`,
      ).toBe(true);
    }
  }

  checkCodeTargets(output);

  // The bundled RNL Worker is the one used: the editor passes no location,
  // and the client's own Worker URL is local and emitted.
  const runtimeSource = await readFile(
    resolve(root, "src/features/netlist-export/rnl-runtime.ts"),
    "utf8",
  );
  expect(
    [...runtimeSource.matchAll(/\bstartCore\(([^)]*)\)/gu)].map((m) => m[1]),
  ).toEqual([""]);
  const client = output.find(
    (item) =>
      item.type === "chunk" && item.code.includes("The core's Worker failed"),
  );
  const bundledWorker = client.code.match(
    /new Worker\(new URL\(`([^`$]*)`,``\+import\.meta\.url\)/u,
  );
  expect(bundledWorker).not.toBeNull();
  expectLocal(
    bundledWorker[1],
    new URL(client.fileName, DEPLOY),
    client.fileName,
  );
  expect(fileNames.has(bundledWorker[1].slice("/canvas/".length))).toBe(true);
}, 120_000);

it("validates VITE_AUTO_CANVAS_AUTH in the config hook and defines the switch", async () => {
  const define = (command, values) =>
    withEnvironment(values, async () => {
      const config = await freshConfig();
      const resolved = await resolveConfig(
        { ...config, configFile: false, root, logLevel: "silent" },
        command,
      );
      return resolved.define?.[DEFINE];
    });
  await expect(define("build", { VITE_AUTO_CANVAS_AUTH: "" })).rejects.toThrow(
    /VITE_AUTO_CANVAS_AUTH/u,
  );
  await expect(
    define("build", { VITE_AUTO_CANVAS_AUTH: "oidc" }),
  ).rejects.toThrow(/VITE_AUTO_CANVAS_AUTH/u);
  expect(await define("serve", { VITE_AUTO_CANVAS_AUTH: "notebook" })).toBe(
    "false",
  );
  expect(await define("build", {})).toBe("false");
  expect(await define("build", { VITE_AUTO_CANVAS_AUTH: "notebook" })).toBe(
    "true",
  );
  // Importers spread the config object (apps/editor/build/rnl-canvas-package.test.ts).
  expect(typeof webConfig).toBe("object");
  expect(Array.isArray(webConfig.plugins)).toBe(true);
  expect(webConfig.plugins.map((plugin) => plugin.name)).toContain(
    "notebook-build-switch",
  );
}, 120_000);
