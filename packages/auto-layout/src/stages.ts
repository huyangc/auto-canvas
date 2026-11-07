import { deviceDescriptor, drawnMagneticNetwork } from "@icm/devices";
import { visibleInstanceBounds } from "@icm/derived";
import {
  reflectOrientation,
  type DerivedRect,
  type Point,
  type Instance,
  type SchematicDocument,
} from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import { createPlacementEstimator } from "./estimate.js";
import { boxesIntersect, transformPoint, withPlacements } from "./geometry.js";
import { assignColumns, deviceRows, netLevels, orderRows } from "./layered.js";
import { isMosBulk, type NetRoles } from "./net-roles.js";
import { devicePins, signalDistances } from "./placement-connectivity.js";
import { compareIds } from "./recognize.js";
import type { Placement, RecognizedGroup } from "./types.js";

const isCapacitor = (i: Instance) =>
  deviceDescriptor(i.symbolId)?.deviceClass === "capacitor";

/** R60: descriptor order defines main terminals and paired inductor windings. */
function conductingPairs(i: Instance): readonly (readonly string[])[] {
  const descriptor = deviceDescriptor(i.symbolId);
  if (!descriptor) return [];
  switch (descriptor.deviceClass) {
    case "mos":
      return [["D", "S"]];
    case "bjt":
      return [["C", "E"]];
    case "resistor":
    case "diode":
      return [descriptor.pinOrder.slice(0, 2)];
    case "inductor": {
      const network = drawnMagneticNetwork(descriptor);
      if (!network)
        return descriptor.pinOrder.length === 2 ? [descriptor.pinOrder] : [];
      const pins = new Map(network.ports.map((p) => [p.port, p.pinName]));
      return network.windings.map((w) => [
        pins.get(w.dotted)!,
        pins.get(w.undotted)!,
      ]);
    }
    // Switches do not conduct yet: a merged switch network gets no channel
    // levels in R30 and packs into one row (T017 review, round 2).
    case "switch":
    case "capacitor":
    case "cccs":
    case "ccvs":
    case "current-source":
    case "net-marker":
    case "vccs":
    case "vcvs":
    case "voltage-source":
      return [];
  }
}
const conductingPins = (i: Instance, resolver: SymbolResolver) => {
  const names = conductingPairs(i).flat();
  return devicePins(i, resolver).filter((p) => names.includes(p.name));
};
interface Stage {
  id: string;
  devices: Instance[];
}
interface Bridge {
  device: Instance;
  /** Stage owners in symbol-pin order. */
  owners: [string, string];
  nets: [string, string];
}

/** R50. Rail cuts and gate/base cuts are topology rules, independent of geometry. */
export function findStages(
  devices: Instance[],
  resolver: SymbolResolver,
  roles: NetRoles,
  groups: RecognizedGroup[],
): { stages: Stage[]; bridges: Bridge[] } {
  const ordered = [...devices].sort((a, b) => compareIds(a.id, b.id));
  // Primary nodes precede extra windings, so every populated component has a
  // real device owner. A transformer is drawn once, in its primary's stage;
  // its secondary still joins secondary-side devices without shorting stages.
  const nodes = ordered.map((i) => i.id);
  const primary = new Map(nodes.map((id, index) => [id, index]));
  const pairs = new Map(ordered.map((i) => [i.id, conductingPairs(i)]));
  const channels = new Map<string, number[]>();
  const parent = nodes.map((_, index) => index);
  const find = (id: number): number => {
    if (parent[id] !== id) parent[id] = find(parent[id]!);
    return parent[id]!;
  };
  const union = (a: number, b: number) => {
    const x = find(a),
      y = find(b);
    parent[Math.max(x, y)] = Math.min(x, y);
  };
  const root = (id: string) => nodes[find(primary.get(id)!)]!;
  const join = (a: string, b: string) =>
    union(primary.get(a)!, primary.get(b)!);
  for (const i of ordered) {
    const windingPins = new Map<string, number>();
    for (const [index, pins] of pairs.get(i.id)!.entries()) {
      const node = index === 0 ? primary.get(i.id)! : nodes.length;
      if (index > 0) {
        nodes.push(i.id);
        parent.push(node);
      }
      for (const name of pins) {
        // A shared tap connects windings even without an external Net on it.
        const shared = windingPins.get(name);
        if (shared !== undefined) union(shared, node);
        else windingPins.set(name, node);
        const net = roles.pinNet(i.id, name);
        if (!net || roles.rails.has(net)) continue;
        if (!channels.has(net)) channels.set(net, []);
        const members = channels.get(net)!;
        if (members.length) union(members[0]!, node);
        members.push(node);
      }
    }
  }
  for (const g of groups)
    for (const id of [
      ...g.members.slice(1),
      ...(g.tailInstanceId ? [g.tailInstanceId] : []),
    ])
      join(g.members[0], id);
  const allPins = new Map<string, string[]>();
  for (const i of ordered.filter((i) => !isCapacitor(i)))
    for (const p of devicePins(i, resolver)) {
      const net = roles.pinNet(i.id, p.name);
      if (!net || roles.rails.has(net) || isMosBulk(i.symbolId, p.name))
        continue;
      if (!allPins.has(net)) allPins.set(net, []);
      allPins.get(net)!.push(i.id);
    }
  const bridges: Bridge[] = [];
  for (const i of ordered.filter(isCapacitor)) {
    // Prefer a conducting owner over a receiver gate on a shared signal Net.
    const contacts = devicePins(i, resolver).flatMap((p) => {
      const net = roles.pinNet(i.id, p.name);
      if (!net || roles.rails.has(net)) return [];
      const channel = channels.get(net)?.[0];
      // The owner must draw a pin on this Net. A transformer's secondary
      // component can be rooted in a stage that does not hold its artwork.
      const head = channel === undefined ? undefined : nodes[find(channel)];
      const component = head === undefined ? undefined : root(head);
      const pinned = allPins.get(net) ?? [];
      const owner = pinned.find((id) => root(id) === component) ?? pinned[0];
      return owner ? [{ net, owner: root(owner) }] : [];
    });
    if (contacts.length === 2 && contacts[0]!.owner !== contacts[1]!.owner) {
      bridges.push({
        device: i,
        owners: [contacts[0]!.owner, contacts[1]!.owner],
        nets: [contacts[0]!.net, contacts[1]!.net],
      });
    } else if (contacts.length) join(i.id, contacts[0]!.owner);
  }
  const bridgeIds = new Set(bridges.map((b) => b.device.id));
  const stages = new Map<string, Stage>();
  for (const i of ordered.filter((i) => !bridgeIds.has(i.id))) {
    const id = root(i.id);
    if (!stages.has(id)) stages.set(id, { id, devices: [] });
    stages.get(id)!.devices.push(i);
  }
  for (const b of bridges) b.owners = b.owners.map(root) as [string, string];
  return { stages: [...stages.values()], bridges };
}

/** R51–R53 and R56: local stacks, shared rail rows, compact stage permutations. */
export function placeStages(
  document: SchematicDocument,
  devices: Instance[],
  resolver: SymbolResolver,
  roles: NetRoles,
  groups: RecognizedGroup[],
): Map<string, Placement> {
  const found = findStages(devices, resolver, roles, groups);
  const grid = document.presentation.grid;
  const snap = (n: number) => Math.round(n / grid) * grid;
  const ceil = (n: number) => Math.ceil(n / grid) * grid;
  // R59: only rail shunts and otherwise independent one-device stages attach.
  // Group members retain their template, even when they look like a leaf.
  const candidates = found.stages.flatMap((stage) =>
    stage.devices.flatMap((device) => {
      if (
        !(isCapacitor(device) || stage.devices.length === 1) ||
        groups.some((g) => g.members.includes(device.id))
      )
        return [];
      const pins = devicePins(device, resolver);
      if (pins.length !== 2) return [];
      const signal = pins.filter((p) => {
        const net = roles.pinNet(device.id, p.name);
        return net && !roles.rails.has(net);
      });
      const rail = pins.flatMap(
        (p) => roles.rails.get(roles.pinNet(device.id, p.name) ?? "") ?? [],
      );
      return signal.length === 1 && rail.length === 1
        ? [
            {
              device,
              pin: signal[0]!,
              net: roles.pinNet(device.id, signal[0]!.name)!,
              rail: rail[0]!,
            },
          ]
        : [];
    }),
  );
  const candidateIds = new Set(candidates.map((c) => c.device.id));
  const attached = candidates.flatMap((part) => {
    const hosts = found.stages
      .flatMap((s) => s.devices)
      .filter((i) => !candidateIds.has(i.id))
      .flatMap((i) =>
        devicePins(i, resolver)
          .filter(
            (p) =>
              !isMosBulk(i.symbolId, p.name) &&
              roles.pinNet(i.id, p.name) === part.net,
          )
          .map((pin) => ({ device: i, pin })),
      );
    // Conducting host pins precede receiver gates; ids only break topology ties.
    hosts.sort(
      (a, b) =>
        Number(
          conductingPins(b.device, resolver).some((p) => p.name === b.pin.name),
        ) -
          Number(
            conductingPins(a.device, resolver).some(
              (p) => p.name === a.pin.name,
            ),
          ) || compareIds(a.device.id, b.device.id),
    );
    return hosts[0] ? [{ ...part, host: hosts[0] }] : [];
  });
  const attachedIds = new Set(attached.map((a) => a.device.id));
  const stages = found.stages
    .map((stage) => ({
      ...stage,
      devices: stage.devices.filter((i) => !attachedIds.has(i.id)),
    }))
    .filter((s) => s.devices.length);
  const bridges = found.bridges.map((bridge) => ({
    ...bridge,
    owners: bridge.owners.map((id) => {
      if (stages.some((s) => s.id === id)) return id;
      const removed = found.stages.find((s) => s.id === id)!;
      const part = attached.find((a) =>
        removed.devices.some((i) => i.id === a.device.id),
      )!;
      return stages.find((s) =>
        s.devices.some((i) => i.id === part.host.device.id),
      )!.id;
    }) as [string, string],
  }));
  if (!stages.length) return new Map();
  const distances = signalDistances(document, devices, resolver, roles).devices;
  const blocks = stages.map((stage) => {
    const ownGroups = groups.filter((g) =>
      stage.devices.some((i) => i.id === g.members[0]),
    );
    const localDocument = { ...document, instances: stage.devices };
    const rows = deviceRows(
      localDocument,
      stage.devices,
      resolver,
      roles,
      ownGroups,
      netLevels(stage.devices, resolver, roles),
    );
    const placements = assignColumns(
      localDocument,
      stage.devices,
      resolver,
      roles,
      ownGroups,
      orderRows(rows, stage.devices, resolver, roles, ownGroups),
      rows,
    );
    const bounds = visibleInstanceBounds(
      withPlacements(localDocument, placements),
      resolver,
    ).map((b) => b.bounds);
    const left = Math.min(...bounds.map((b) => b.x));
    const right = Math.max(...bounds.map((b) => b.x + b.width));
    // Snap origins, not widths: fractional ink extents must not move pins off grid.
    const shift = ceil(-left);
    for (const p of placements.values()) p.position.x += shift;
    const top = Math.min(...[...placements.values()].map((p) => p.position.y));
    const bottom = Math.max(
      ...[...placements.values()].map((p) => p.position.y),
    );
    const rails = new Set(
      stage.devices.flatMap((i) =>
        devicePins(i, resolver).flatMap(
          (p) => roles.rails.get(roles.pinNet(i.id, p.name) ?? "") ?? [],
        ),
      ),
    );
    return {
      ...stage,
      placements,
      width: ceil(right + shift),
      top,
      bottom,
      rails,
      canMirror: !ownGroups.length,
      distance: Math.min(
        ...stage.devices.map((i) => distances.get(i.id) ?? Infinity),
      ),
    };
  });
  const height = Math.max(...blocks.map((b) => b.bottom - b.top));
  for (const b of blocks) {
    const dy = b.rails.has("supply")
      ? -b.top
      : b.rails.has("ground")
        ? height - b.bottom
        : snap((height - b.top - b.bottom) / 2);
    for (const p of b.placements.values()) p.position.y += dy;
  }
  for (const part of attached) {
    const block = blocks.find((b) =>
      b.devices.some((i) => i.id === part.host.device.id),
    )!;
    const hostPlacement = block.placements.get(part.host.device.id)!;
    const host = transformPoint(
      part.host.pin.at,
      hostPlacement.position,
      hostPlacement,
    );
    const pins = devicePins(part.device, resolver);
    const railPin = pins.find((p) => p.name !== part.pin.name)!;
    const direction = part.rail === "ground" ? 1 : -1;
    const rotation =
      ([0, 90, 180, 270] as const).find((rotation) => {
        const orientation = { rotation, mirror: "none" as const };
        const a = transformPoint(part.pin.at, { x: 0, y: 0 }, orientation);
        const b = transformPoint(railPin.at, { x: 0, y: 0 }, orientation);
        return a.x === b.x && (b.y - a.y) * direction > 0;
      }) ?? 0;
    const p: Placement = { position: { x: 0, y: 0 }, rotation, mirror: "none" };
    const local = transformPoint(part.pin.at, p.position, p);
    const box = visibleInstanceBounds(
      withPlacements(
        { ...document, instances: [part.device] },
        new Map([[part.device.id, p]]),
      ),
      resolver,
    )[0]!.bounds;
    const occupied = visibleInstanceBounds(
      withPlacements(
        { ...document, instances: block.devices },
        block.placements,
      ),
      resolver,
    ).map((b) => b.bounds);
    // R59: leave every rail pin an unobstructed vertical escape, including
    // earlier attachments. A nearest-body-only search can stack shunts on the
    // same x, blocking the first part's rail branch with the second part.
    const blocksEscape = (bounds: DerivedRect, pin: Point, direction: number) =>
      pin.x >= bounds.x - 20 &&
      pin.x <= bounds.x + bounds.width + 20 &&
      (direction > 0
        ? bounds.y + bounds.height + 20 > pin.y
        : bounds.y - 20 < pin.y);
    const escapes = block.devices.flatMap((i) =>
      devicePins(i, resolver).flatMap((pin) => {
        const rail = roles.rails.get(roles.pinNet(i.id, pin.name) ?? "");
        if (!rail || isMosBulk(i.symbolId, pin.name)) return [];
        const target = block.placements.get(i.id)!;
        return [
          {
            pin: transformPoint(pin.at, target.position, target),
            direction: rail === "ground" ? 1 : -1,
          },
        ];
      }),
    );
    const localRail = transformPoint(railPin.at, { x: 0, y: 0 }, p);
    const minX = ceil(-box.x);
    const maxX = ceil(block.width + 40 - box.x);
    const xs = Array.from(
      { length: (maxX - minX) / grid + 1 },
      (_, index) => minX + index * grid,
    ).sort(
      (a, b) =>
        Math.max(0, box.x + a + box.width - block.width) -
          Math.max(0, box.x + b + box.width - block.width) ||
        Math.abs(a + local.x - host.x) - Math.abs(b + local.x - host.x) ||
        a - b,
    );
    for (const x of xs) {
      p.position.x = x;
      p.position.y = snap(host.y + direction * 60 - local.y);
      const bounds = () => ({
        x: box.x + x,
        y: box.y + p.position.y,
        width: box.width,
        height: box.height,
      });
      while (
        occupied.some(
          (b) =>
            boxesIntersect(
              {
                x: bounds().x - 20,
                y: bounds().y - 20,
                width: box.width + 40,
                height: box.height + 40,
              },
              b,
            ) ||
            blocksEscape(
              b,
              {
                x: x + localRail.x,
                y: p.position.y + localRail.y,
              },
              direction,
            ),
        )
      )
        p.position.y += direction * grid;
      if (
        !escapes.some((escape) =>
          blocksEscape(bounds(), escape.pin, escape.direction),
        )
      )
        break;
    }
    block.placements.set(part.device.id, p);
    block.devices.push(part.device);
    block.width = Math.max(block.width, ceil(box.x + p.position.x + box.width));
  }
  const bridgeInfo = bridges.map((b) => {
    const pins = devicePins(b.device, resolver);
    const rotation =
      ([0, 90, 180, 270] as const).find((r) => {
        const a = transformPoint(
          pins[0]!.at,
          { x: 0, y: 0 },
          { rotation: r, mirror: "none" },
        );
        const c = transformPoint(
          pins[1]!.at,
          { x: 0, y: 0 },
          { rotation: r, mirror: "none" },
        );
        return a.y === c.y && a.x < c.x;
      }) ?? 0;
    const p: Placement = { position: { x: 0, y: 0 }, rotation, mirror: "none" };
    const box = visibleInstanceBounds(
      withPlacements(
        { ...document, instances: [b.device] },
        new Map([[b.device.id, p]]),
      ),
      resolver,
    )[0]!.bounds;
    return { ...b, placement: p, left: box.x, width: ceil(box.width) };
  });
  const estimate = createPlacementEstimator(devices, resolver, roles);
  let order = [...blocks].sort(
    (a, b) => a.distance - b.distance || compareIds(a.id, b.id),
  );
  const mirrored = new Set<string>();
  const compose = () => {
    const targets = new Map<string, Placement>();
    const index = new Map(order.map((b, i) => [b.id, i]));
    const after = (b: Bridge) =>
      Math.min(index.get(b.owners[0])!, index.get(b.owners[1])!);
    let x = 0;
    order.forEach((b, at) => {
      for (const [id, p] of b.placements) {
        const flip = mirrored.has(b.id);
        targets.set(id, {
          ...p,
          ...(flip ? reflectOrientation(p, "left-right") : {}),
          position: {
            x: x + (flip ? b.width - p.position.x : p.position.x),
            y: p.position.y,
          },
        });
      }
      x += b.width;
      // A bridge occupies the first gap between its owners even when another
      // stage lies between them. Multiple bridges reserve separate compact slots.
      const gapCaps = bridgeInfo.filter((c) => after(c) === at);
      for (const cap of gapCaps) {
        x += ceil(40);
        const p = structuredClone(cap.placement);
        p.position.x = x + ceil(-cap.left);
        const firstOnLeft =
          index.get(cap.owners[0])! < index.get(cap.owners[1])!;
        if (!firstOnLeft) p.mirror = "horizontal";
        targets.set(cap.device.id, p);
        x += cap.width + ceil(40);
      }
      if (!gapCaps.length) x += ceil(80);
    });
    for (const cap of bridgeInfo) {
      const ys = cap.nets.map((net, end) => {
        const owner = blocks.find((b) => b.id === cap.owners[end])!;
        const points = owner.devices.flatMap((i) =>
          devicePins(i, resolver)
            .filter((p) => roles.pinNet(i.id, p.name) === net)
            .map((p) =>
              transformPoint(
                p.at,
                targets.get(i.id)!.position,
                targets.get(i.id)!,
              ),
            ),
        );
        return points.reduce((sum, p) => sum + p.y, 0) / points.length;
      });
      const p = targets.get(cap.device.id)!;
      const pin = devicePins(cap.device, resolver)[0]!;
      const local = transformPoint(pin.at, { x: 0, y: 0 }, p);
      p.position.y = snap((ys[0]! + ys[1]!) / 2 - local.y);
    }
    return targets;
  };
  let best = compose(),
    score = estimate(best).score;
  const tryOrder = (candidate: typeof order) => {
    const previous = order;
    order = candidate;
    const targets = compose(),
      next = estimate(targets).score;
    if (next < score) {
      best = targets;
      score = next;
      return true;
    }
    order = previous;
    return false;
  };
  for (let pass = 0; pass < 5; pass++) {
    let changed = false;
    for (let i = 1; i < order.length; i++) {
      const candidate = [...order];
      [candidate[i - 1], candidate[i]] = [candidate[i]!, candidate[i - 1]!];
      changed = tryOrder(candidate) || changed;
    }
    for (const block of blocks)
      for (let to = 0; to < order.length; to++) {
        const from = order.indexOf(block);
        if (from === to) continue;
        const candidate = order.filter((b) => b !== block);
        candidate.splice(to, 0, block);
        changed = tryOrder(candidate) || changed;
      }
    for (const b of blocks.filter((b) => b.canMirror)) {
      if (mirrored.has(b.id)) mirrored.delete(b.id);
      else mirrored.add(b.id);
      const targets = compose(),
        next = estimate(targets).score;
      if (next < score) {
        best = targets;
        score = next;
        changed = true;
      } else if (mirrored.has(b.id)) mirrored.delete(b.id);
      else mirrored.add(b.id);
    }
    if (!changed) break;
  }
  // R57: Cell Pin roles identify interface Nets; compare their device hosts,
  // before marker placement. No interface on either side leaves R53 unchanged.
  const hostMean = (side: "input" | "output") => {
    const nets = new Set(
      document.instances
        .filter((i) => ["port", "port-filled"].includes(i.symbolId))
        .flatMap((i) => {
          const net = roles.pinNet(i.id, "P");
          const role = roles.byNet.get(net ?? "");
          // R4's `input` needs a gate on the Net. An input reached through a
          // series resistor is `internal`, but is still the input side.
          const onSide =
            side === "output"
              ? role === "output"
              : role === "input" || role === "internal";
          return net && onSide ? [net] : [];
        }),
    );
    const xs = devices.flatMap((i) =>
      devicePins(i, resolver)
        .filter(
          (p) =>
            !isMosBulk(i.symbolId, p.name) &&
            nets.has(roles.pinNet(i.id, p.name) ?? ""),
        )
        .map(
          (p) =>
            transformPoint(p.at, best.get(i.id)!.position, best.get(i.id)!).x,
        ),
    );
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined;
  };
  const inputX = hostMean("input"),
    outputX = hostMean("output");
  if (inputX !== undefined && outputX !== undefined && inputX > outputX) {
    order.reverse();
    for (const b of blocks.filter((b) => b.canMirror)) {
      if (mirrored.has(b.id)) mirrored.delete(b.id);
      else mirrored.add(b.id);
    }
    best = compose();
  }
  return best;
}
