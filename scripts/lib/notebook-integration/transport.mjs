// Reporting, the raw HTTP client, the stub upstream, the rewrite-manifest reader
// and the transport table shared by stages T and A.
import fs from "node:fs";
import { createServer, request } from "node:http";
import path from "node:path";

export function createReporter() {
  const state = { passed: 0, failed: 0 };
  return {
    ok(name) {
      state.passed += 1;
      console.log(`ok   ${name}`);
    },
    fail(name, detail) {
      state.failed += 1;
      console.log(`FAIL ${name}: ${detail}`);
    },
    check(name, condition, detail) {
      if (condition) this.ok(name);
      else this.fail(name, typeof detail === "function" ? detail() : detail);
      return Boolean(condition);
    },
    note: (line) => console.log(`note ${line}`),
    info: (line) => console.log(`     ${line}`),
    summary(stage) {
      console.log(
        `stage ${stage}: ${state.passed} passed, ${state.failed} failed`,
      );
      return state.failed;
    },
  };
}

/** GET with the path sent byte for byte; never follows redirects. */
export function rawRequest(port, rawPath, method = "GET") {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: "127.0.0.1",
        port,
        path: rawPath,
        method,
        agent: false,
        timeout: 30_000,
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () =>
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      },
    );
    req.on("timeout", () => req.destroy(new Error("request timeout")));
    req.on("error", reject);
    req.end();
  });
}

const MOUNT = "/@notebook/canvas";

function insideMount(url) {
  const { pathname } = new URL(url, "http://x");
  return pathname === MOUNT || pathname.startsWith(`${MOUNT}/`);
}

/** A stub upstream that records every request before answering. */
export async function startStub(port) {
  const records = [];
  const server = createServer((req, res) => {
    const [pathname, ...rest] = req.url.split("?");
    const query = rest.join("?");
    const record = { method: req.method, url: req.url };
    records.push(record);
    if (pathname === MOUNT) {
      res.writeHead(308, { Location: "/canvas/" });
      res.end();
    } else if (pathname === `${MOUNT}/` || pathname.startsWith(`${MOUNT}/`)) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ path: pathname, query }));
    } else {
      record.outsideMount = true;
      res.writeHead(404);
      res.end("outside");
    }
  });
  const sockets = new Set();
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  return {
    port,
    records,
    close: () =>
      new Promise((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}

/** The rewrites of a built app as ordered raw rule lists per phase. */
export function readManifest(appDir) {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(appDir, ".next", "routes-manifest.json"), "utf8"),
  );
  const raw = manifest.rewrites;
  if (Array.isArray(raw))
    return { beforeFiles: [], afterFiles: raw, fallback: [] };
  return {
    beforeFiles: raw?.beforeFiles ?? [],
    afterFiles: raw?.afterFiles ?? [],
    fallback: raw?.fallback ?? [],
  };
}

/**
 * Assert the manifest holds exactly `expected` in afterFiles. An expected
 * entry is `{ source | sourceMatches, destination }`.
 */
export function expectRewrites(report, name, manifest, expected) {
  const problems = [];
  if (manifest.beforeFiles.length) problems.push("beforeFiles is not empty");
  if (manifest.fallback.length) problems.push("fallback is not empty");
  const rules = manifest.afterFiles;
  if (rules.length !== expected.length)
    problems.push(
      `afterFiles has ${rules.length} entries, expected ${expected.length}`,
    );
  expected.forEach((want, index) => {
    const have = rules[index];
    if (!have) return;
    const sourceOk = want.sourceMatches
      ? want.sourceMatches(have.source)
      : have.source === want.source;
    if (!sourceOk)
      problems.push(`entry ${index} source ${JSON.stringify(have.source)}`);
    if (have.destination !== want.destination)
      problems.push(
        `entry ${index} destination ${JSON.stringify(have.destination)}`,
      );
  });
  for (const rule of rules)
    if (rule.has || rule.missing)
      problems.push(`${rule.source} has a condition`);
  return report.check(name, problems.length === 0, () => problems.join("; "));
}

/** The two rules the notebook ships today, for a backend target. */
export const todaysRules = (backend) => [
  { source: "/api/:path*", destination: `${backend}/api/:path*` },
  { source: "/mcp", destination: `${backend}/mcp/` },
];

// Paths Next must answer 404 without touching the upstream.
const NOT_FORWARDED = [
  "/canvas/..",
  "/canvas/../api/projects",
  "/canvas/x/../y",
  "/canvas/x/..",
  "/canvas/x/.",
  "/canvas/.",
  "/canvas/./x",
  "/canvas/%2e/api",
  "/canvas/%09../api",
  "/canvas/%1f/x",
  "/canvas/%2e%2e/api/projects",
  "/canvas/%2E%2e/api",
  "/canvas/.%2e/x",
  "/canvas/..%2fapi",
  "/canvas/a%2Fb",
  "/canvas/a%5cb",
  "/canvas/a%5Cb",
  "/canvas/.%09./api",
  "/canvas/.%0a./api",
  "/canvas/.%0D./api",
  "/canvas/..%20",
  "/canvas/..%00",
  "/canvas/a%20b",
  "/canvas/a%7fb",
  "/canvas/%1F",
  // Rows added from the notebook candidate's own table (next-proxy.test.mjs)
  // that can be sent on the wire and are not listed above; the raw DEL row too.
  "/canvas/%2e%2e/api",
  "/canvas/%2E%2E/api",
  "/canvas/.%2e/api",
  "/canvas/..%2Fapi",
  "/canvas/a%7Fb",
];

const REDIRECTED = [
  ["/canvas/a\\b", "/canvas/a/b"],
  ["/canvas/..\\api", "/canvas/../api"],
  ["/canvas\\api", "/canvas/api"],
  ["/canvas\\..\\api", "/canvas/../api"],
  ["/canvas//editor", "/canvas/editor"],
];

// Malformed and ending in a slash: what Next answers (status, raw Location),
// pinned from observation. The hard requirement is no upstream request.
const MALFORMED_SLASH = [
  ["/canvas/./", 308, "/canvas/."],
  ["/canvas/../", 308, "/canvas/.."],
  ["/canvas/%2e%2e/", 308, "/canvas/%2e%2e"],
  ["/canvas/x/../", 308, "/canvas/x/.."],
  ["/canvas/a%20b/", 308, "/canvas/a%20b"],
  // Raw DEL is sendable, but Next's HTTP parser rejects the request itself.
  [`/canvas/a${String.fromCharCode(0x7f)}b`, 400, undefined],
];

const FORWARDED = [
  ["/canvas", "/@notebook/canvas/"],
  ["/canvas?new=1", "/@notebook/canvas/?new=1"],
  ["/canvas/editor", "/@notebook/canvas/editor"],
  [
    "/canvas/api/projects/x/versions/x%3A3/preview.svg",
    "/@notebook/canvas/api/projects/x/versions/x%3A3/preview.svg",
  ],
  ["/canvas/a.b/c.svg", "/@notebook/canvas/a.b/c.svg"],
  ["/canvas/...", "/@notebook/canvas/..."],
];

/** The transport table: what a Next server with the two canvas rules must do. */
export async function transportAssertions({
  nextPort,
  stub,
  report,
  prefix = "",
}) {
  const probe = async (rawPath) => {
    const mark = stub.records.length;
    let res;
    try {
      res = await rawRequest(nextPort, rawPath);
    } catch (error) {
      res = { status: `error ${error.message}`, headers: {}, body: "" };
    }
    return { res, fresh: stub.records.slice(mark) };
  };
  const visible = (text) =>
    text.replace(
      /[\x00-\x1f\x7f]/g,
      (c) => `\\x${c.charCodeAt(0).toString(16).padStart(2, "0")}`,
    );
  const label = (rawPath) => `${prefix}GET ${visible(JSON.stringify(rawPath))}`;
  const describe = ({ res, fresh }) =>
    `status ${res.status}, location ${JSON.stringify(res.headers.location)}, upstream ${JSON.stringify(fresh.map((r) => r.url))}`;

  for (const [rawPath, upstream] of FORWARDED) {
    const result = await probe(rawPath);
    let bodyOk = false;
    try {
      bodyOk = JSON.parse(result.res.body).path === upstream.split("?")[0];
    } catch {
      bodyOk = false;
    }
    report.check(
      `${label(rawPath)} -> 200, upstream ${upstream}`,
      result.res.status === 200 &&
        result.fresh.length === 1 &&
        result.fresh[0].url === upstream &&
        bodyOk,
      () => describe(result),
    );
  }
  {
    const result = await probe("/canvas/");
    report.check(
      `${label("/canvas/")} -> 308 /canvas, not forwarded`,
      result.res.status === 308 &&
        result.res.headers.location === "/canvas" &&
        !result.fresh.length,
      () => describe(result),
    );
  }
  {
    const result = await probe("/canvasx");
    report.check(
      `${label("/canvasx")} -> 404, not forwarded`,
      result.res.status === 404 && !result.fresh.length,
      () => describe(result),
    );
  }
  for (const rawPath of NOT_FORWARDED) {
    const result = await probe(rawPath);
    report.check(
      `${label(rawPath)} -> 404, not forwarded`,
      result.res.status === 404 && !result.fresh.length,
      () => describe(result),
    );
  }
  for (const [rawPath, location] of REDIRECTED) {
    const result = await probe(rawPath);
    report.check(
      `${label(rawPath)} -> 308 ${location}, not forwarded`,
      result.res.status === 308 &&
        result.res.headers.location === location &&
        !result.fresh.length,
      () => describe(result),
    );
  }
  for (const [rawPath, status, location] of MALFORMED_SLASH) {
    const result = await probe(rawPath);
    report.check(
      `${label(rawPath)} -> ${status}${location === undefined ? "" : ` ${location}`}, not forwarded`,
      result.res.status === status &&
        result.res.headers.location === location &&
        !result.fresh.length,
      () => describe(result),
    );
  }
  const outside = stub.records.filter(
    (r) => r.outsideMount || !insideMount(r.url),
  );
  report.check(
    `${prefix}every upstream request stays inside the mount (${stub.records.length} recorded)`,
    outside.length === 0,
    () => JSON.stringify(outside),
  );
}
