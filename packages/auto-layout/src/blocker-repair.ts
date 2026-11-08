import { deviceDescriptor } from "@icm/devices";
import type { SymbolResolver } from "@icm/symbols";
import { devicePins } from "./placement-connectivity.js";
import { nextMarkerPlacements } from "./place-markers.js";
import { routedScore, type LayoutRun } from "./refine.js";
import { floatingPins } from "./routing-audit.js";
import type { Placement } from "./types.js";

/** R72: at most two complete replans; rejected repairs never replace a plan. */
export function repairBlockers(
  initial: LayoutRun,
  resolver: SymbolResolver,
  fixed: ReadonlySet<string>,
  replan: (placements: ReadonlyMap<string, Placement>) => LayoutRun,
): LayoutRun {
  let current = initial;
  for (let pass = 0; pass < 2; pass++) {
    if (
      !current.final ||
      current.result.diagnostics.some((d) => d.severity === "error")
    )
      break;
    const instances = current.final.instances;
    const blockers = new Set<string>();
    // planRouteNet throws plain Errors. Its obstruction label is reference ?? id.
    // Match only the obstruction clause, never the failed Net's member list or
    // suggested detour. Ambiguous references cannot safely identify a blocker.
    for (const d of current.result.diagnostics) {
      if (d.rule !== "R14") continue;
      for (const i of instances) {
        if (
          fixed.has(i.id) ||
          !(
            ["port", "port-filled"].includes(i.symbolId) ||
            deviceDescriptor(i.symbolId)?.deviceClass === "net-marker"
          )
        )
          continue;
        const label = i.reference ?? i.id;
        if (
          instances.filter((other) => (other.reference ?? other.id) === label)
            .length !== 1
        )
          continue;
        const escape = (value: string) =>
          value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const escaped = escape(label);
        const pins = devicePins(i, resolver)
          .map((p) => escape(p.name))
          .join("|");
        if (
          new RegExp(
            `(?:passes over pin ${escaped}\\.(?:${pins})(?=[ ,])|passes through ${escaped} between \\(|touches ${escaped}'s drawing)`,
          ).test(d.message)
        )
          blockers.add(i.id);
      }
    }
    if (!blockers.size) break;
    const placements = nextMarkerPlacements(
      current.final,
      resolver,
      blockers,
      fixed,
    );
    if (!placements) break;
    const candidate = replan(placements);
    if (
      !candidate.final ||
      candidate.result.diagnostics.some((d) => d.severity === "error")
    )
      break;
    // Judge a repair by the same routed score as refinement and search: an
    // unrouted Net outweighs the few crossings its new route may add.
    if (
      floatingPins(candidate.final, resolver).length >=
        floatingPins(current.final, resolver).length ||
      routedScore(candidate, resolver) >= routedScore(current, resolver)
    )
      break;
    current = candidate;
  }
  return current;
}
