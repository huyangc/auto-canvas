import { visibleInstanceBounds } from "@icm/derived";
import type { SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import { pinPoints } from "./geometry.js";
import { classifyNets } from "./net-roles.js";
import { floatingPins } from "./routing-audit.js";
import { symbolBlocksJoin } from "./straight-joins.js";
import type { AutoLayoutResult } from "./types.js";

/** A disconnected logical rail alone is not evidence of pitch crowding.
 * Retry only a refused placement or a failed connection with a foreign
 * pin/symbol on its straight segment. */
export function pitchBlocked(
  result: AutoLayoutResult,
  document: SchematicDocument,
  resolver: SymbolResolver,
): boolean {
  if (
    result.diagnostics.some((d) => d.severity === "error" && d.rule === "R10")
  )
    return true;
  const floating = floatingPins(document, resolver);
  const failedNets = new Set(floating.map((p) => p.netId));
  for (const net of document.nets)
    if (
      result.diagnostics.some(
        (d) =>
          d.code === "AUTO_LAYOUT_NET_UNROUTED" &&
          d.message.startsWith(`Net ${net.id}:`),
      )
    )
      failedNets.add(net.id);
  if (!failedNets.size) return false;
  const roles = classifyNets(document, resolver);
  const pins = pinPoints(document, resolver).map((p) => ({
    ...p,
    net: roles.pinNet(p.instanceId, p.pinName),
  }));
  const boxes = visibleInstanceBounds(document, resolver);
  // A router refusal may name an obstructed leg of an L-shaped path rather
  // than the segment between the two terminals. Use that diagnosed evidence
  // too, resolving references exactly as R72 does (ambiguous names excluded).
  const escape = (value: string) =>
    value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const d of result.diagnostics) {
    if (d.code !== "AUTO_LAYOUT_NET_UNROUTED") continue;
    const net = [...failedNets].find((id) =>
      d.message.startsWith(`Net ${id}:`),
    );
    if (!net) continue;
    for (const instance of document.instances) {
      const label = instance.reference ?? instance.id;
      if (
        document.instances.filter((i) => (i.reference ?? i.id) === label)
          .length !== 1
      )
        continue;
      const own = pins.filter((p) => p.instanceId === instance.id);
      if (
        own.some(
          (p) =>
            p.net !== net &&
            new RegExp(
              `passes over pin ${escape(label)}\\.${escape(p.pinName)}(?=[ ,])`,
            ).test(d.message),
        )
      )
        return true;
      if (
        !own.some((p) => p.net === net) &&
        new RegExp(
          `(?:passes through ${escape(label)} between \\(|touches ${escape(label)}'s drawing)`,
        ).test(d.message)
      )
        return true;
    }
  }
  for (const a of pins) {
    if (!a.net || !failedNets.has(a.net)) continue;
    for (const b of pins) {
      if (b.net !== a.net || b.instanceId === a.instanceId) continue;
      if (a.point.x !== b.point.x && a.point.y !== b.point.y) continue;
      const axis = a.point.x === b.point.x ? "y" : "x";
      const across = axis === "x" ? "y" : "x";
      const join = {
        net: a.net,
        axis,
        across,
        line: a.point[across],
        low: Math.min(a.point[axis], b.point[axis]),
        high: Math.max(a.point[axis], b.point[axis]),
      } as const;
      if (
        pins.some(
          (p) =>
            p.net !== a.net &&
            p.point[across] === join.line &&
            p.point[axis] > join.low &&
            p.point[axis] < join.high,
        )
      )
        return true;
      if (
        boxes.some(
          ({ id, bounds }) =>
            id !== a.instanceId &&
            id !== b.instanceId &&
            !pins.some((p) => p.instanceId === id && p.net === a.net) &&
            symbolBlocksJoin(bounds, join),
        )
      )
        return true;
    }
  }
  return false;
}
