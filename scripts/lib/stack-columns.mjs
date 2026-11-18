// Report-only R166 measure. A stack is R166's relation: two devices carrying
// the only two conduction terminals on a non-rail Net, at least one a
// transistor. A drawing keeps it when the two pins lie on one line along their
// exits (2-unit tolerance) and face each other with no device body on the
// segment between them.
import { visibleInstanceBounds } from "../../packages/derived/dist/index.js";
import {
  pinExit,
  pinPoints,
} from "../../packages/auto-layout/dist/geometry.js";
import { classifyNets } from "../../packages/auto-layout/dist/net-roles.js";
import { isMarker } from "../../packages/auto-layout/dist/placement-connectivity.js";
import { stackPairs } from "../../packages/auto-layout/dist/stack-snap.js";

const TOLERANCE = 2;

/** `{ stacks, broken, brokenKeys }`; a key names the two devices, sorted. */
export function stackColumns(document, resolver) {
  const devices = document.instances.filter((i) => !isMarker(i));
  const drawing = { ...document, instances: devices };
  const byId = new Map(devices.map((i) => [i.id, i]));
  const points = new Map(
    pinPoints(drawing, resolver).map((p) => [
      `${p.instanceId}\u0000${p.pinName}`,
      p.point,
    ]),
  );
  const bounds = visibleInstanceBounds(drawing, resolver);
  const end = ({ id, pin }) => {
    const point = points.get(`${id}\u0000${pin.name}`);
    const placement = byId.get(id)?.placement;
    return point && placement && { ...point, exit: pinExit(pin, placement) };
  };
  // A device body strictly crossing the segment between the two pins.
  const clear = (a, b, skip) => {
    const x0 = Math.min(a.x, b.x),
      x1 = Math.max(a.x, b.x),
      y0 = Math.min(a.y, b.y),
      y1 = Math.max(a.y, b.y);
    return !bounds.some(
      ({ id, bounds: r }) =>
        !skip.includes(id) &&
        (x1 - x0 < 1
          ? r.x < x0 - 0.5 &&
            r.x + r.width > x0 + 0.5 &&
            r.y < y1 - 0.5 &&
            r.y + r.height > y0 + 0.5
          : r.y < y0 - 0.5 &&
            r.y + r.height > y0 + 0.5 &&
            r.x < x1 - 0.5 &&
            r.x + r.width > x0 + 0.5),
    );
  };
  const facing = (a, b, axis) =>
    Math.abs(a[axis] - b[axis]) <= TOLERANCE ||
    ((b[axis] - a[axis]) * a.exit[axis] > 0 &&
      (a[axis] - b[axis]) * b.exit[axis] > 0);
  const stacks = stackPairs(
    devices,
    resolver,
    classifyNets(document, resolver),
  );
  const brokenKeys = [];
  let present = 0;
  for (const stack of stacks) {
    const a = end(stack.a);
    const b = end(stack.b);
    if (!a || !b) continue;
    present++;
    const vertical =
      Math.abs(a.x - b.x) <= TOLERANCE &&
      !a.exit.x &&
      !b.exit.x &&
      facing(a, b, "y");
    const horizontal =
      Math.abs(a.y - b.y) <= TOLERANCE &&
      !a.exit.y &&
      !b.exit.y &&
      facing(a, b, "x");
    if (!((vertical || horizontal) && clear(a, b, [stack.a.id, stack.b.id])))
      brokenKeys.push([stack.a.id, stack.b.id].sort().join("|"));
  }
  return { stacks: present, broken: brokenKeys.length, brokenKeys };
}
