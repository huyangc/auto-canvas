import fs from "node:fs";
import path from "node:path";
import { parseProject } from "../../packages/project-protocol/dist/index.js";
import {
  builtInSymbols,
  createProjectSymbolResolver,
} from "../../packages/symbols/dist/index.js";
import { createLabelClearanceContext } from "../../packages/derived/dist/index.js";
export function measure(d, r) {
  const ctx = createLabelClearanceContext(d, r),
    seen = new Set(),
    pairs = [];
  const label = new Map(ctx.visible.map((a) => [a.id, a]));
  for (const a of ctx.visible) {
    const hits = ctx.overlapsAt(ctx.measure(a).inkBounds, a.id);
    for (const b of hits) {
      const key = JSON.stringify([a.id, b].sort());
      if (seen.has(key)) continue;
      seen.add(key);
      const peer = label.get(b);
      pairs.push({
        a: a.id,
        b,
        kind: [a.kind, peer?.kind ?? "drafting"],
        owner: [a.anchor.objectId, peer?.anchor?.objectId],
      });
    }
  }
  return pairs;
}
if (import.meta.main)
  for (const dir of process.argv.slice(2)) {
    const result = [];
    for (const f of fs
      .readdirSync(dir)
      .filter((s) => s.endsWith(".icproj.json"))) {
      const p = parseProject(fs.readFileSync(path.join(dir, f), "utf8")),
        d = p.documents.find((d) => d.id === p.topDocumentId),
        r = createProjectSymbolResolver(p, builtInSymbols),
        pairs = measure(d, r);
      if (pairs.length) result.push([f, pairs]);
    }
    console.log(dir, JSON.stringify(result));
  }
