import { visibleInstanceBounds } from "@icm/derived";
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
import type { NetRoles } from "./net-roles.js";
import { devicePins, isMarker } from "./placement-connectivity.js";
import { compareIds } from "./recognize.js";
import type { Placement } from "./types.js";

/** Rail-cut DC connectivity; windings stay separate and control pins never join. */
export function localLoopAmplifiers(
  document: SchematicDocument,
  resolver: SymbolResolver,
  roles: NetRoles,
) {
  const devices = [...document.instances]
    .filter((i) => !isMarker(i))
    .sort((a, b) => compareIds(a.id, b.id));
  const branch = new Map<string, Set<string>>();
  for (const device of devices)
    for (const pair of conductingPairs(device)) {
      const nets = pair.flatMap((name) => {
        const net = roles.pinNet(device.id, name);
        return net && !roles.rails.has(net) ? [net] : [];
      });
      for (const net of nets) {
        if (!branch.has(net)) branch.set(net, new Set());
        for (const other of nets) branch.get(net)!.add(other);
      }
    }
  return devices.flatMap((device) => {
    const pins = devicePins(device, resolver);
    const outputs = pins.filter((p) => p.role.includes("output"));
    const inputs = pins.filter((p) => p.role.includes("input"));
    if (pins.length <= 2 || outputs.length !== 1 || !inputs.length) return [];
    const output = outputs[0]!;
    const net = roles.pinNet(device.id, output.name);
    if (!net || roles.rails.has(net)) return [];
    const receiversOn = (controlNet: string) =>
      devices
        .filter((i) => i !== device)
        .flatMap((host) =>
          devicePins(host, resolver)
            .filter(
              (p) =>
                roles.pinNet(host.id, p.name) === controlNet &&
                (p.role.includes("gate") ||
                  p.role.includes("base") ||
                  p.role.includes("control")),
            )
            .map((pin) => ({ host, pin })),
        );
    let receivers = receiversOn(net);
    // A direct gate bank takes precedence over passive output loads. Otherwise
    // follow exactly one passive, never a second link or an ambiguous fanout.
    const chains = receivers.length
      ? []
      : devices.flatMap((passive) => {
          const kind = deviceDescriptor(passive.symbolId)?.deviceClass;
          if (
            !kind ||
            !["resistor", "capacitor", "inductor", "diode"].includes(kind)
          )
            return [];
          const pins = devicePins(passive, resolver);
          if (pins.length !== 2) return [];
          const input = pins.find(
            (p) => roles.pinNet(passive.id, p.name) === net,
          );
          const output = pins.find((p) => p !== input);
          const control = output && roles.pinNet(passive.id, output.name);
          if (
            !input ||
            !output ||
            !control ||
            control === net ||
            roles.rails.has(control)
          )
            return [];
          const receivers = receiversOn(control);
          return receivers.length
            ? [{ passive, input, output, receivers }]
            : [];
        });
    if (chains.length > 1) return [];
    const chain = chains[0];
    if (chain) receivers = chain.receivers;
    if (!receivers.length) return [];
    const sensed = new Set(
      receivers.flatMap(({ host }) =>
        conductingPairs(host)
          .flat()
          .flatMap((name) => {
            const n = roles.pinNet(host.id, name);
            return n && !roles.rails.has(n) ? [n] : [];
          }),
      ),
    );
    for (const n of sensed)
      for (const next of branch.get(n) ?? []) sensed.add(next);
    const feedback = inputs.filter((p) =>
      sensed.has(roles.pinNet(device.id, p.name) ?? ""),
    );
    return feedback.length
      ? [{ device, output, inputs: feedback, receivers, chain }]
      : [];
  });
}

/** Seat the amplifier and optional passive atomically; blocked units stay put. */
export function placeLocalLoopAmplifiers(
  document: SchematicDocument,
  resolver: SymbolResolver,
  roles: NetRoles,
  targets: Map<string, Placement>,
  protectedIds: ReadonlySet<string>,
  collisionDocument: SchematicDocument = document,
): void {
  const grid = document.presentation.grid;
  const snap = (n: number) => Math.round(n / grid) * grid;
  for (const loop of localLoopAmplifiers(document, resolver, roles)) {
    const moved = [loop.device, ...(loop.chain ? [loop.chain.passive] : [])];
    if (moved.some((i) => protectedIds.has(i.id) || !targets.has(i.id)))
      continue;
    const old = targets.get(loop.device.id)!;
    const oldOutput = transformPoint(loop.output.at, old.position, old);
    const receivers = loop.receivers
      .flatMap(({ host, pin }) => {
        const hp = targets.get(host.id);
        if (!hp) return [];
        const gate = transformPoint(pin.at, hp.position, hp);
        return [
          {
            gate,
            exit: pinExit(pin, hp),
            distance:
              Math.abs(gate.x - oldOutput.x) + Math.abs(gate.y - oldOutput.y),
          },
        ];
      })
      .sort((a, b) => a.distance - b.distance);
    const receiver = receivers[0];
    if (!receiver) continue;
    let { gate } = receiver;
    const { exit } = receiver;
    if (loop.receivers.length > 1) {
      // Keep the nearest gate's transverse alignment, but clear the whole
      // receiver bank rather than seating inside a neighbouring receiver.
      const ids = new Set(loop.receivers.map((r) => r.host.id));
      const bounds = visibleInstanceBounds(
        withPlacements(
          {
            ...document,
            instances: document.instances.filter((i) => ids.has(i.id)),
          },
          targets,
        ),
        resolver,
      ).map((b) => b.bounds);
      gate = {
        x:
          exit.x < 0
            ? Math.min(gate.x, ...bounds.map((b) => b.x))
            : exit.x > 0
              ? Math.max(gate.x, ...bounds.map((b) => b.x + b.width))
              : gate.x,
        y:
          exit.y < 0
            ? Math.min(gate.y, ...bounds.map((b) => b.y))
            : exit.y > 0
              ? Math.max(gate.y, ...bounds.map((b) => b.y + b.height))
              : gate.y,
      };
    }
    let passivePlacement: Placement | undefined;
    if (loop.chain) {
      passivePlacement = seats(
        loop.chain.passive,
        loop.chain.output,
        gate,
        exit,
      )[0];
      if (!passivePlacement) continue;
      gate = transformPoint(
        loop.chain.input.at,
        passivePlacement.position,
        passivePlacement,
      );
    }
    // The gate's outward side is opposite the conducting terminals. Reflect
    // across the output axis to put the feedback input toward its sensed node.
    const variants: { placement: Placement; cost: number }[] = [];
    for (const p of seats(loop.device, loop.output, gate, exit)) {
      let cost = 0;
      for (const input of loop.inputs) {
        const point = transformPoint(input.at, p.position, p);
        const net = roles.pinNet(loop.device.id, input.name);
        const distances = document.instances
          .filter((i) => i.id !== loop.device.id && targets.has(i.id))
          .flatMap((i) =>
            devicePins(i, resolver)
              .filter(
                (pin) =>
                  conductingPairs(i).flat().includes(pin.name) &&
                  roles.pinNet(i.id, pin.name) === net,
              )
              .map((pin) => {
                const at = targets.get(i.id)!;
                const q = transformPoint(pin.at, at.position, at);
                return Math.abs(point.x - q.x) + Math.abs(point.y - q.y);
              }),
          );
        cost += Math.min(...distances);
      }
      variants.push({ placement: p, cost });
    }
    variants.sort((a, b) => a.cost - b.cost);
    const next = variants[0]?.placement;
    if (!next) continue;
    const trial = new Map(targets);
    trial.set(loop.device.id, next);
    if (loop.chain && passivePlacement)
      trial.set(loop.chain.passive.id, passivePlacement);
    if (!geometryProblem(withPlacements(collisionDocument, trial), resolver))
      for (const i of moved) targets.set(i.id, trial.get(i.id)!);
  }

  function seats(
    device: SchematicDocument["instances"][number],
    pin: ReturnType<typeof devicePins>[number],
    gate: { x: number; y: number },
    exit: { x: number; y: number },
  ): Placement[] {
    const placements: Placement[] = [];
    for (const rotation of [0, 90, 180, 270] as const)
      for (const mirror of [
        "none",
        "horizontal",
        "vertical",
        "both",
      ] as const) {
        const p: Placement = { position: { x: 0, y: 0 }, rotation, mirror };
        const facing = pinExit(pin, p);
        if (facing.x !== -exit.x || facing.y !== -exit.y) continue;
        const output = transformPoint(pin.at, p.position, p);
        const bounds = visibleInstanceBounds(
          { ...document, instances: [{ ...device, placement: p }] },
          resolver,
        )[0]!.bounds;
        p.position = {
          x: snap(
            exit.x
              ? gate.x +
                  exit.x * 60 -
                  (exit.x < 0 ? bounds.x + bounds.width : bounds.x)
              : gate.x - output.x,
          ),
          y: snap(
            exit.y
              ? gate.y +
                  exit.y * 60 -
                  (exit.y < 0 ? bounds.y + bounds.height : bounds.y)
              : gate.y - output.y,
          ),
        };
        placements.push(p);
      }
    return placements;
  }
}
