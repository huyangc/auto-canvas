import { visibleInstanceBounds } from "../../packages/derived/dist/index.js";
import {
  pinExit,
  pinPoints,
} from "../../packages/auto-layout/dist/geometry.js";
import { isMarker } from "../../packages/auto-layout/dist/placement-connectivity.js";
import { classifyNets } from "../../packages/auto-layout/dist/net-roles.js";
import {
  againstFlowCounter,
  rightFacingBlocks,
} from "../../packages/auto-layout/dist/directed-blocks.js";

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
    againstFlow: againstFlow(document, resolver),
  };
}

/**
 * R164's planner counter (`againstFlowCounter`) on the drawing's own
 * placements: free directed blocks (on no block cycle) whose outputs all
 * leave to the right while more than half of the other device pins on their
 * non-rail input Nets lie right of the mean x of the block's pins. Parts that
 * also touch one of the block's output Nets are feedback; markers, ports and
 * MOS bulk pins do not count. Nets come from `classifyNets`.
 */
function againstFlow(document, resolver) {
  const roles = classifyNets(document, resolver);
  const devices = document.instances.filter((i) => !isMarker(i));
  return againstFlowCounter(
    devices,
    resolver,
    roles,
    rightFacingBlocks(document.instances, resolver, roles),
  )(
    new Map(devices.flatMap((i) => (i.placement ? [[i.id, i.placement]] : []))),
  );
}
