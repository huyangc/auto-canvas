import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { parseProject } from "../../packages/project-protocol/dist/index.js";
import {
  builtInSymbols,
  createProjectSymbolResolver,
} from "../../packages/symbols/dist/index.js";
import { measure } from "./labels.mjs";
const base = "../../../output",
  out = base + "/apr-t049";
const groups = [
  ...["0-4", "5-10"].map((b) => [
    b,
    out + "/frozen/" + b + "/projects",
    out + "/fixed/" + b + "/projects",
  ]),
  ...["train", "validation"].map((b) => [
    b,
    base + "/apr-t048/" + b + "-optimized",
    out + "/" + b + "-optimized",
  ]),
];
const details = [];
for (const [bucket, before, after] of groups)
  for (const file of fs
    .readdirSync(before)
    .filter((f) => f.endsWith(".icproj.json"))) {
    const load = (dir) => {
      const p = parseProject(fs.readFileSync(path.join(dir, file), "utf8"));
      return [
        p.documents.find((d) => d.id === p.topDocumentId),
        createProjectSymbolResolver(p, builtInSymbols),
      ];
    };
    const [[d, r], [next, s]] = [load(before), load(after)];
    const { annotations: a, ...rest } = d,
      { annotations: b, ...other } = next;
    assert.deepEqual(rest, other, file + " non-annotation document fields");
    const content = (z) =>
      z
        .map(({ anchor, ...x }) => ({
          ...x,
          anchorKind: anchor.kind,
          anchorOwner: anchor.objectId ?? anchor.routeId,
        }))
        .sort((x, y) => x.id.localeCompare(y.id));
    assert.deepEqual(content(a), content(b));
    const pairs = measure(d, r),
      fixed = measure(next, s);
    assert.equal(fixed.length, 0, file);
    details.push({
      id: file.split(".")[0],
      bucket,
      before: pairs.length,
      after: fixed.length,
      pairs,
    });
  }
fs.writeFileSync(out + "/label-audit.json", JSON.stringify(details, null, 2));
for (const [b] of groups) {
  const a = details.filter((x) => x.bucket === b);
  console.log(
    b,
    a.length,
    a.filter((x) => x.before).length,
    a.reduce((n, x) => n + x.before, 0),
  );
}
