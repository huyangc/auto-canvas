// Apply the frozen algorithm/metrics to a new, flat directory of original projects.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { check } from "./bench.mjs";
const [dir, dest] = process.argv.slice(2);
if (!dir || !dest)
  throw Error(
    "Usage: node evaluate-folder.mjs <original-json-folder> <output-folder>",
  );
const files = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith(".json"))
  .sort();
if (!files.length) throw Error("No JSON projects in the input directory");
fs.mkdirSync(dest, { recursive: true });
const rows = [];
for (const name of files) {
  const id = name.slice(0, -5);
  const sha256 = createHash("sha256")
    .update(fs.readFileSync(path.join(dir, name)))
    .digest("hex");
  try {
    rows.push(
      check(
        { id, bucket: ".", set: "new", sha256 },
        dir,
        { quality: "optimized" },
        path.join(dest, "projects"),
      ),
    );
  } catch (error) {
    rows.push({ id, valid: false, error: String(error) });
  }
}
fs.writeFileSync(
  path.join(dest, "results.json"),
  JSON.stringify(rows, null, 2) + "\n",
);
const metrics = ["wireLength", "bends", "crossings"];
if (!rows.every((r) => r.valid)) {
  console.error(
    "Invalid or incomplete",
    rows.filter((r) => !r.valid).map((r) => r.id),
  );
  process.exitCode = 1;
} else
  for (const metric of metrics) {
    const total = (k) => rows.reduce((sum, r) => sum + r[k][metric], 0),
      reference = total("reference"),
      auto = total("auto");
    const pass = auto <= 1.1 * reference + 1e-8;
    console.log(metric, { reference, auto, pass });
    if (!pass) process.exitCode = 1;
  }
