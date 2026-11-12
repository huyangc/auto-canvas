// Fit shared costs from fully routed training alternatives. Input is the train
// run written by bench.mjs. Fail closed if an input was omitted or substituted.
import fs from "node:fs";
import assert from "node:assert/strict";
import { pinLayoutCost } from "../../packages/auto-layout/dist/pin-portfolio.js";
const [file, dest] = process.argv.slice(2);
const rows = JSON.parse(fs.readFileSync(file));
const split = JSON.parse(
  fs.readFileSync(new URL("./split.json", import.meta.url)),
);
assert.deepEqual(
  rows.map((r) => r.id).sort(),
  split
    .filter((r) => r.set === "train")
    .map((r) => r.id)
    .sort(),
);
assert.ok(rows.every((r) => r.valid && r.portfolio?.length));
const trials = [];
for (const bend of [4, 2, 8])
  for (const crossing of [48, 16, 96]) {
    const totals = [0, 0, 0],
      refs = [0, 0, 0];
    for (const row of rows) {
      const cost = (m) => pinLayoutCost(m, crossing) + (bend - 4) * m.bends;
      const best = row.portfolio.reduce((a, b) => (cost(b) < cost(a) ? b : a));
      [best.lengthInGrid * row.grid, best.bends, best.crossings].forEach(
        (v, i) => (totals[i] += v),
      );
      [
        row.reference.wireLength,
        row.reference.bends,
        row.reference.crossings,
      ].forEach((v, i) => (refs[i] += v));
    }
    const ratios = totals.map((v, i) =>
      refs[i] ? v / refs[i] : v ? Infinity : 0,
    );
    trials.push({
      bend,
      crossing,
      totals,
      refs,
      worst: Math.max(...ratios),
      sum: ratios.reduce((a, b) => a + b),
    });
  }
trials.sort((a, b) => a.worst - b.worst || a.sum - b.sum);
fs.writeFileSync(
  dest,
  JSON.stringify({ selected: trials[0], trials }, null, 2) + "\n",
);
console.log(trials[0]);
