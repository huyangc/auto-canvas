import { expect, it } from "vitest";
import { InMemorySymbolResolver, builtInSymbols } from "@icm/symbols";
import { planAutoLayout } from "../src/index.js";
import { refinementMetrics } from "../src/refine.js";
import { circuit } from "./document-fixture.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);
it("is deterministic for a synthetic 120-device document through the public portfolio", () => {
  const count = 120;
  const d = circuit(
    Object.fromEntries(
      Array.from({ length: count }, (_, i) => [`m${i}`, "nmos"]),
    ),
    Object.fromEntries(
      Array.from({ length: count + 1 }, (_, i) => [
        `n${i}`,
        [...(i ? [`m${i - 1}.S`] : []), ...(i < count ? [`m${i}.D`] : [])],
      ]),
    ),
  );
  const before = JSON.stringify(d);
  const plan = planAutoLayout(d, resolver);
  expect(plan.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  expect(planAutoLayout(d, resolver)).toEqual(plan);
  expect(refinementMetrics(plan)?.candidates).toBe(0);
  expect(JSON.stringify(d)).toBe(before);
  // Two full plans of a 121-Net chain: about 7 s here, and R96's finalist
  // rip-up pushed a slow CI runner past 30 s. The timeout only guards a hang.
}, 60000);
