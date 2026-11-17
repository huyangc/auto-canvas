import { deviceDescriptor } from "@icm/devices";
import type { SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import { conductingPairs } from "./dc-connectivity.js";
import {
  geometryProblem,
  pinExit,
  transformPoint,
  withPlacements,
} from "./geometry.js";
import { localLoopAmplifiers } from "./local-loop-amplifier.js";
import type { NetRoles } from "./net-roles.js";
import { outputFacesLeft } from "./directed-blocks.js";
import { devicePins } from "./placement-connectivity.js";
import type { Placement } from "./types.js";

/** Direct gate/base banks with two distinct, directly sensed conducting branches. */
export function amplifierGateRows(
  document: SchematicDocument,
  resolver: SymbolResolver,
  roles: NetRoles,
) {
  return localLoopAmplifiers(document, resolver, roles).flatMap((loop) => {
    if (loop.chain) return [];
    const receivers = loop.receivers.filter(
      ({ host, pin }) =>
        ["mos", "bjt"].includes(
          deviceDescriptor(host.symbolId)?.deviceClass ?? "",
        ) &&
        (pin.role.includes("gate") || pin.role.includes("base")),
    );
    if (receivers.length < 2) return [];
    const sensed = receivers.flatMap(({ host, pin }) =>
      devicePins(host, resolver).flatMap((terminal) => {
        if (!conductingPairs(host).flat().includes(terminal.name)) return [];
        const net = roles.pinNet(host.id, terminal.name);
        const input =
          net && !roles.rails.has(net)
            ? loop.inputs.find(
                (p) => roles.pinNet(loop.device.id, p.name) === net,
              )
            : undefined;
        return input ? [{ host, pin, terminal, input }] : [];
      }),
    );
    if (sensed.length !== 2) return [];
    const [a, b] = sensed as [(typeof sensed)[number], (typeof sensed)[number]];
    if (a.host.id === b.host.id || a.input === b.input) return [];
    return [{ ...loop, sensed: [a, b] as const }];
  });
}

/** Face a rigid gate/base row from between two directly sensed branches.
 * Recognition uses electrical roles; geometry only chooses the amplifier seat.
 * Receivers and every other member retain their placements.
 */
export function placeAmplifierBetweenBranches(
  document: SchematicDocument,
  resolver: SymbolResolver,
  roles: NetRoles,
  targets: Map<string, Placement>,
  protectedIds: ReadonlySet<string>,
  collisionDocument: SchematicDocument,
): void {
  const snap = (n: number) =>
    Math.round(n / document.presentation.grid) * document.presentation.grid;
  for (const loop of amplifierGateRows(document, resolver, roles)) {
    if (protectedIds.has(loop.device.id) || !targets.has(loop.device.id))
      continue;
    const points = loop.sensed.map(({ host, pin, terminal, input }) => {
      const at = targets.get(host.id);
      return at
        ? {
            gate: transformPoint(pin.at, at.position, at),
            sense: transformPoint(terminal.at, at.position, at),
            input,
          }
        : undefined;
    });
    const [a, b] = points;
    if (!a || !b) continue;
    const horizontal = a.gate.y === b.gate.y && a.gate.x !== b.gate.x;
    const vertical = a.gate.x === b.gate.x && a.gate.y !== b.gate.y;
    if (!horizontal && !vertical) continue;
    const direction = horizontal
      ? { x: 0, y: Math.sign(a.sense.y + b.sense.y - a.gate.y - b.gate.y) }
      : { x: Math.sign(a.sense.x + b.sense.x - a.gate.x - b.gate.x), y: 0 };
    if (!direction.x && !direction.y) continue;
    const output = {
      x: snap((a.gate.x + b.gate.x) / 2 + direction.x * 40),
      y: snap((a.gate.y + b.gate.y) / 2 + direction.y * 40),
    };
    const candidates: { placement: Placement; cost: number }[] = [];
    for (const rotation of [0, 90, 180, 270] as const)
      for (const mirror of [
        "none",
        "horizontal",
        "vertical",
        "both",
      ] as const) {
        const placement: Placement = {
          position: { x: 0, y: 0 },
          rotation,
          mirror,
        };
        const exit = pinExit(loop.output, placement);
        if (exit.x !== -direction.x || exit.y !== -direction.y) continue;
        // R164: a free directed block keeps its output right.
        if (
          roles.rightFacing?.has(loop.device.id) &&
          outputFacesLeft(loop.device, placement, resolver)
        )
          continue;
        const pin = transformPoint(
          loop.output.at,
          placement.position,
          placement,
        );
        placement.position = {
          x: snap(output.x - pin.x),
          y: snap(output.y - pin.y),
        };
        const trial = new Map(targets).set(loop.device.id, placement);
        if (geometryProblem(withPlacements(collisionDocument, trial), resolver))
          continue;
        const cost = [a, b].reduce((sum, s) => {
          const p = transformPoint(s.input.at, placement.position, placement);
          return sum + Math.abs(p.x - s.sense.x) + Math.abs(p.y - s.sense.y);
        }, 0);
        candidates.push({ placement, cost });
      }
    candidates.sort((a, b) => a.cost - b.cost);
    if (candidates[0]) targets.set(loop.device.id, candidates[0].placement);
  }
}
