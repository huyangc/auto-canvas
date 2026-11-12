import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { parseProject } from "../../packages/project-protocol/dist/index.js";
const gallery = "../../../../auto-canvas-cases/library/gallery",
  out = "../../../output/apr-t049";
const hash = (t) => crypto.createHash("sha256").update(t).digest("hex");
function fingerprint(d) {
  const devices = d.instances.map((i) => i.id),
    parts = devices.length;
  const labels = [
    ...d.instances.map((i) => i.symbolId),
    ...d.nets.map(() => "net"),
  ];
  const edges = labels.map(() => []);
  d.nets.forEach((n, j) =>
    n.terminals.forEach((t) => {
      const i = devices.indexOf(t.instanceId);
      edges[i].push([t.pinName, parts + j]);
      edges[parts + j].push([t.pinName, i]);
    }),
  );
  let colors = labels.map(hash);
  for (let i = 0; i < labels.length; i++)
    colors = labels.map((_, j) =>
      hash(
        JSON.stringify([
          colors[j],
          edges[j].map(([pin, k]) => [pin, colors[k]]).sort(),
        ]),
      ),
    );
  return hash(JSON.stringify(colors.sort()));
}
const seen = new Set(),
  used = new Set(
    JSON.parse(fs.readFileSync(gallery + "/catalog.json")).map((r) => r.id),
  ),
  rows = [],
  skipped = [];
const top = (p) => p.documents.find((d) => d.id === p.topDocumentId);
for (const dir of [
  gallery + "/projects",
  "fixtures",
  "apps/editor/src/examples",
]) {
  for (const f of fs
    .readdirSync(dir, { recursive: true })
    .filter((n) => n.endsWith(".json"))) {
    try {
      const p = parseProject(fs.readFileSync(path.join(dir, f), "utf8"));
      for (const d of p.documents) seen.add(fingerprint(d));
    } catch {}
  }
}
for (const f of fs
  .readdirSync(gallery + "/responses")
  .filter((f) => f.endsWith(".json"))
  .sort()) {
  const v = JSON.parse(fs.readFileSync(gallery + "/responses/" + f)),
    e = v.entry;
  if (
    e.aiGenerated === true ||
    used.has(e.id) ||
    v.status !== "public" ||
    !e.ownerUserId ||
    !e.author ||
    /bot|analoggenie|artificial intelligence|AI.generated/i.test(
      e.author + " " + e.name + " " + e.description,
    ) ||
    e.tags?.some((t) => /^(ai($|[- ])|spice-import|virtuoso-export)/i.test(t))
  )
    continue;
  let d;
  try {
    d = top(parseProject(v.projectText));
  } catch (err) {
    skipped.push([e.id, "unreadable native input"]);
    continue;
  }
  const parts = d.instances.filter(
      (i) =>
        i.placement &&
        !/^(port($|-)|ground|vdd-port$|vss-port$|gnd-port$|power$|no-connect$)|-port$/.test(
          i.symbolId,
        ),
    ).length,
    b = parts < 5 ? "0-4" : "5-10";
  if (!parts || parts > 10 || rows.filter((r) => r.bucket === b).length >= 6)
    continue;
  const topo = fingerprint(d);
  if (seen.has(topo)) {
    skipped.push([e.id, "existing topology"]);
    continue;
  }
  seen.add(topo);
  const folder = out + "/originals/" + b;
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(folder + "/" + f, v.projectText);
  rows.push({
    id: e.id,
    bucket: b,
    parts,
    title: e.name,
    author: e.author,
    source: "https://analog-canvas.tokenzhang.com/g/" + e.id,
    tags: e.tags,
    sha256: hash(v.projectText),
    topology: topo,
    authorship:
      "Community publication, no AI or import flag (Gallery Human made convention)",
  });
  if (rows.length === 12) break;
}
fs.writeFileSync(
  out + "/samples.json",
  JSON.stringify({ rows, skipped }, null, 2),
);
console.log(rows.map((r) => [r.bucket, r.id, r.title]));
