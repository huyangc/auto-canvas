import { visibleInstanceBounds } from "../../packages/derived/dist/index.js";
import {
  pinExit,
  pinPoints,
} from "../../packages/auto-layout/dist/geometry.js";
import { isMarker } from "../../packages/auto-layout/dist/placement-connectivity.js";
import {
  classifyNets,
  isMosBulk,
} from "../../packages/auto-layout/dist/net-roles.js";
import { rightFacingBlocks } from "../../packages/auto-layout/dist/directed-blocks.js";

const PORTS = new Set(["port", "port-filled"]);

/**
 * Report-only R164 counts on a finished drawing (human or planned). A directed
 * block has an input-role and an output-role pin. `outputFacesLeft` counts its
 * output pins that leave to the left; `outputPortLeft` counts its output pins
 * whose Net carries ports that all lie left of the block centre. Pins and
 * ports join through the drawing's own Net terminals.
 */
export function blockDirection(document, resolver) {
  const definition = (i) =>
    resolver.resolve(i.symbolId, i.symbolVariantId)?.definition;
  const netOf = new Map();
  for (const net of document.nets)
    for (const t of net.terminals ?? [])
      netOf.set(`${t.instanceId}\u0000${t.pinName}`, net.id);
  const points = new Map(
    pinPoints(document, resolver).map((p) => [
      `${p.instanceId}\u0000${p.pinName}`,
      p.point,
    ]),
  );
  const bounds = new Map(
    visibleInstanceBounds(document, resolver).map((b) => [b.id, b.bounds]),
  );
  const ports = document.instances
    .filter((i) => PORTS.has(i.symbolId))
    .flatMap((i) =>
      (definition(i)?.pins ?? []).flatMap((pin) => {
        const key = `${i.id}\u0000${pin.name}`;
        const point = points.get(key);
        const net = netOf.get(key);
        return point && net ? [{ net, x: point.x }] : [];
      }),
    );
  let outputFacesLeft = 0,
    outputPortLeft = 0;
  for (const i of document.instances) {
    if (isMarker(i) || !i.placement) continue;
    const pins = (definition(i)?.pins ?? []).filter(
      (p) => !p.role.includes("hierarchical"),
    );
    const outputs = pins.filter((p) => p.role.includes("output"));
    if (!outputs.length || !pins.some((p) => p.role.includes("input")))
      continue;
    const box = bounds.get(i.id);
    for (const pin of outputs) {
      if (pinExit(pin, i.placement).x < -0.5) outputFacesLeft++;
      const net = netOf.get(`${i.id}\u0000${pin.name}`);
      const own = ports.filter((p) => net && p.net === net);
      if (
        box &&
        own.length &&
        own.every((p) => p.x < box.x + box.width / 2 - 1)
      )
        outputPortLeft++;
    }
  }
  return {
    outputFacesLeft,
    outputPortLeft,
    againstFlow: againstFlow(document, resolver, points, bounds, definition),
  };
}

/**
 * Free directed blocks (on no block cycle) whose outputs all leave to the
 * right while more than half of the other pins on their non-rail input Nets
 * lie right of the block's visible centre. Pins of parts that also touch one
 * of the block's output Nets are feedback and are ignored, as are MOS bulks.
 * Nets come from `classifyNets` (label-connected).
 */
function againstFlow(document, resolver, points, bounds, definition) {
  const roles = classifyNets(document, resolver);
  const free = rightFacingBlocks(document.instances, resolver, roles);
  const net = (id, pin) => roles.pinNet(id, pin);
  let count = 0;
  for (const i of document.instances) {
    if (!free.has(i.id) || !i.placement) continue;
    const pins = (definition(i)?.pins ?? []).filter(
      (p) => !p.role.includes("hierarchical"),
    );
    const outputs = pins.filter((p) => p.role.includes("output"));
    if (outputs.some((p) => pinExit(p, i.placement).x <= 0)) continue;
    const box = bounds.get(i.id);
    if (!box) continue;
    const nets = (list) =>
      new Set(
        list.flatMap((p) => {
          const n = net(i.id, p.name);
          return n && !roles.rails.has(n) ? [n] : [];
        }),
      );
    const inNets = nets(pins.filter((p) => p.role.includes("input")));
    const outNets = nets(outputs);
    const xs = [];
    for (const j of document.instances) {
      if (j.id === i.id) continue;
      const own = (definition(j)?.pins ?? []).filter(
        (p) => !isMosBulk(j.symbolId, p.name),
      );
      if (own.some((p) => outNets.has(net(j.id, p.name)))) continue;
      for (const p of own)
        if (inNets.has(net(j.id, p.name))) {
          const point = points.get(`${j.id}\u0000${p.name}`);
          if (point) xs.push(point.x);
        }
    }
    const centre = box.x + box.width / 2;
    if (xs.length && xs.filter((x) => x > centre).length > xs.length / 2)
      count++;
  }
  return count;
}
