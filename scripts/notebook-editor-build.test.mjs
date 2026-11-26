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

const repository = resolve(".").replaceAll("\\", "/");

/** Each rendered module's code, under its repository-relative id. */
const renderedModuleSources = (output) =>
  output
    .filter((item) => item.type === "chunk")
    .flatMap((chunk) =>
      Object.entries(chunk.modules)
        .filter(([, module]) => module.renderedLength > 0)
        .map(([id, module]) => {
          const path = id.replaceAll("\\", "/");
          // A package keeps its path inside node_modules, without the
          // store's version directory.
          const vendored = path.lastIndexOf("/node_modules/");
          return {
            id:
              vendored >= 0
                ? path.slice(vendored + 1)
                : path.startsWith(`${repository}/`)
                  ? path.slice(repository.length + 1)
                  : path,
            code: module.code ?? "",
          };
        }),
    );

// --- Per-user storage guards (T163) ------------------------------------
// The notebook entry replaces the page's storage globals with per-user
// facades (apps/editor/src/notebook/browser-storage.ts). These guards flag
// the forms they recognise; a new storage consumer is reviewed against the
// boundary in docs/specs/server.md, never silenced by extending a list.

const CONSUMER =
  /\b(?:localStorage|sessionStorage|indexedDB|BroadcastChannel)\b|\.\s*(?:locks|getDirectory)\b|\bcaches\s*\./u;

/**
 * The notebook output's rendered modules that use a storage global, checked
 * against the inventory of plan T163 (rows 1–15, the gate's token read, the
 * installer, and stale-build recovery's `caches`).
 */
const STORAGE_CONSUMERS = [
  "apps/editor/src/agent/agent-runtime-loader.ts", // row 8, not reached (Agent off)
  "apps/editor/src/agent/use-agent-session.ts", // row 8, not reached (Agent off)
  "apps/editor/src/app/App.tsx", // rows 10-15
  "apps/editor/src/app/use-agent-hosts.ts", // row 8
  "apps/editor/src/components/chunk-load-fallback.tsx", // row 4
  "apps/editor/src/components/shelf-wall.tsx", // Cloud Projects grid/list view preference; per-user like rows 10-15
  "apps/editor/src/components/stale-build-recovery.ts", // row 17, Cache Storage
  "apps/editor/src/document/browser-recovery-store.ts", // rows 1, 1a
  "apps/editor/src/document/cloud-auto-save.ts", // T176 auto-save preference; per-user like rows 10-15
  "apps/editor/src/document/cloud-project-session.ts", // rows 5, 6
  "apps/editor/src/document/project-workspace.ts", // rows 3, 3a-3c
  "apps/editor/src/document/recovery-coordinator.ts", // row 2
  "apps/editor/src/document/use-project-file-lifecycle.ts", // rows 4-6
  "apps/editor/src/document/workspace-reopen.ts", // row 2
  "apps/editor/src/entries/notebook.tsx", // row G, the gate's token read
  "apps/editor/src/features/component-insert/use-component-placement.ts", // rows 10-15
  "apps/editor/src/features/editor-shell/editor-mode.ts", // rows 10-15
  "apps/editor/src/features/editor-shell/use-editor-panels.ts", // rows 10-15
  "apps/editor/src/features/netlist-export/netlist-export-preferences.ts", // rows 10-15
  "apps/editor/src/features/user-components/component-publication-journal.ts", // row 7
  "apps/editor/src/notebook/browser-storage.ts", // the installer
  // Not storage: a module-local array named `caches` shadows the global.
  "node_modules/react-dom/cjs/react-dom-client.production.js",
  "packages/derived/dist/document-caches.js",
];

/** Modules using a storage global that are not in `pinned`. */
function storageConsumerProblems(modules, pinned) {
  const allowed = new Set(pinned);
  return modules
    .filter(({ id, code }) => CONSUMER.test(code) && !allowed.has(id))
    .map(({ id, code }) => `${id}: ${code.match(CONSUMER)[0]}`);
}

const STORAGE_EVENT = /addEventListener\(\s*["'`]storage["'`]|\bonstorage\b/u;
const STORAGE_EVENT_OWNER = "apps/editor/src/notebook/gate.ts";

/** Registrations for `storage` events outside the gate. */
function storageEventProblems(modules) {
  return modules
    .filter(
      ({ id, code }) => id !== STORAGE_EVENT_OWNER && STORAGE_EVENT.test(code),
    )
    .map(({ id }) => `${id}: registers for storage events`);
}

const FORBIDDEN = [
  "Storage.prototype",
  "IDBFactory",
  "IDBDatabase.prototype",
  "LockManager",
  "storageArea",
  "SharedWorker",
  "document.cookie",
];

/** Names that would reach storage around the facades, in any emitted file. */
function forbiddenNameProblems(items) {
  return items.flatMap(({ id, code }) =>
    FORBIDDEN.filter((name) => code.includes(name)).map(
      (name) => `${id}: ${name}`,
    ),
  );
}

const WORKER_STORAGE =
  /\b(?:localStorage|sessionStorage|indexedDB|BroadcastChannel|caches)\b|\.\s*locks\b/u;
const SERVICE_WORKER_STORAGE =
  /\b(?:localStorage|sessionStorage|indexedDB|BroadcastChannel)\b|\.\s*locks\b/u;

/** Worker assets reach no storage; the service worker only its shell cache. */
function workerStorageProblems(workers, serviceWorker) {
  const problems = workers
    .filter(({ code }) => WORKER_STORAGE.test(code))
    .map(({ id, code }) => `${id}: ${code.match(WORKER_STORAGE)[0]}`);
  if (serviceWorker && SERVICE_WORKER_STORAGE.test(serviceWorker.code))
    problems.push(
      `${serviceWorker.id}: ${serviceWorker.code.match(SERVICE_WORKER_STORAGE)[0]}`,
    );
  return problems;
}

it("recognises storage use around the per-user facades, and not lookalikes", () => {
  // The installer's descriptor lookup of "storage" is no registration.
  expect(
    storageEventProblems([
      {
        id: "apps/editor/src/notebook/browser-storage.ts",
        code: 'Object.getOwnPropertyDescriptor(Navigator.prototype, "storage")',
      },
      {
        id: STORAGE_EVENT_OWNER,
        code: 'addEventListener("storage", listener)',
      },
    ]),
  ).toEqual([]);
  expect(
    storageEventProblems([
      {
        id: "apps/editor/src/app/App.tsx",
        code: "window.addEventListener(`storage`, refresh)",
      },
      { id: "apps/editor/src/app/other.ts", code: "window.onstorage = f" },
    ]),
  ).toHaveLength(2);
  // The auto-layout worker's blocks are not locks.
  expect(
    workerStorageProblems(
      [
        {
          id: "assets/auto-layout.worker.js",
          code: "const n=t.blocks;blocks()",
        },
      ],
      { id: "sw.js", code: "caches.open(name)" },
    ),
  ).toEqual([]);
  expect(
    workerStorageProblems(
      [{ id: "assets/worker.js", code: "indexedDB.open(`x`)" }],
      { id: "sw.js", code: "navigator.locks.request(n,f)" },
    ),
  ).toEqual(["assets/worker.js: indexedDB", "sw.js: .locks"]);
  expect(
    storageConsumerProblems(
      [
        {
          id: "apps/editor/src/app/unpinned.ts",
          code: "sessionStorage.getItem(k)",
        },
        { id: "apps/editor/src/app/plain.ts", code: "const sessionStore = 1" },
        { id: "apps/editor/src/app/App.tsx", code: "localStorage.getItem(k)" },
      ],
      ["apps/editor/src/app/App.tsx"],
    ),
  ).toEqual(["apps/editor/src/app/unpinned.ts: sessionStorage"]);
  expect(
    forbiddenNameProblems([
      { id: "assets/a.js", code: "Storage.prototype.getItem;document.cookie" },
    ]),
  ).toEqual(["assets/a.js: Storage.prototype", "assets/a.js: document.cookie"]);
});

async function checkStorageGuards(output) {
  const modules = renderedModuleSources(output);
  expect(storageConsumerProblems(modules, STORAGE_CONSUMERS)).toEqual([]);
  // The list stays exact: a pinned module that no longer uses storage goes.
  const consumers = modules
    .filter(({ code }) => CONSUMER.test(code))
    .map(({ id }) => id);
  expect([...new Set(consumers)].sort()).toEqual(STORAGE_CONSUMERS);
  expect(storageEventProblems(modules)).toEqual([]);
  const assets = workerAssets(output).map((item) => ({
    id: item.fileName,
    code: text(item),
  }));
  const emittedServiceWorker = assets.find(({ id }) =>
    /(?:^|\/)sw\.js$/u.test(id),
  );
  // A build that does not write returns no copied public file: the service
  // worker that ships is then the source file itself.
  const serviceWorker = emittedServiceWorker ?? {
    id: "apps/editor/public/sw.js",
    code: await readFile(resolve(root, "public/sw.js"), "utf8"),
  };
  expect(
    forbiddenNameProblems([
      ...output.map((item) => ({ id: item.fileName, code: text(item) })),
      ...(emittedServiceWorker ? [] : [serviceWorker]),
    ]),
  ).toEqual([]);
  expect(
    workerStorageProblems(
      assets.filter((asset) => asset !== emittedServiceWorker),
      serviceWorker,
    ),
  ).toEqual([]);
}

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

// Without escapes: the text between the quotes is then the string itself.
const LITERAL = /^(?:`[^`$\\]*`|"[^"\\]*"|'[^'\\]*')$/u;

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
    // Also a qualified constructor: new globalThis.Worker(…).
    for (const match of code.matchAll(
      /new (?:[\w$]+\.)*(?:Shared)?Worker\(/gu,
    )) {
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
        'new globalThis.SharedWorker(new URL("//evil.example/w.js",import.meta.url));',
        // "../../x.js" in escapes: outside /canvas/ once the browser decodes it.
        "new URL(`\\u002e\\u002e/\\u002e\\u002e/x.js`,import.meta.url);",
      ].join(""),
    },
  ]);
  // The two bad URLs themselves, then the three Workers, in source order.
  expect(problems).toHaveLength(5);
  expect(problems[0]).toMatch(/resolves to https:\/\/evil\.example\/w\.js/u);
  expect(problems[1]).toMatch(/computed new URL\(`\\u002e/u);
  expect(problems[2]).toMatch(/Worker argument.*document\.baseURI/u);
  expect(problems[3]).toMatch(
    /Worker argument.*: "https:\/\/evil\.example\/w\.js"\)/u,
  );
  expect(problems[4]).toMatch(/Worker argument.*"\/\/evil\.example/u);
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

/** Static and dynamic imports in emitted JavaScript, from its AST. */
function moduleImports(code, fileName) {
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
    // What the code itself imports, which the lists above may not hold: a
    // computed import() fails here.
    for (const specifier of moduleImports(chunk.code, chunk.fileName))
      expectLocal(
        specifier,
        new URL(chunk.fileName, DEPLOY),
        `${chunk.fileName} import`,
      );
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
    for (const specifier of moduleImports(text(worker), worker.fileName)) {
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
  await checkStorageGuards(output);

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
  // Only a build reads the variable: the dev server and preview start
  // whatever the shell exports.
  for (const value of ["notebook", "oidc", ""])
    expect(await define("serve", { VITE_AUTO_CANVAS_AUTH: value })).toBe(
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
