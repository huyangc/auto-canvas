import { pinJogs } from "../../packages/auto-layout/dist/pin-jogs.js";

/**
 * Report-only R167 counts on a finished drawing (human or planned). `pins`
 * lists each jog's pin as `instance.pin`, so a report can tell the jogs a
 * result has and the human drawing of the same circuit does not.
 */
export function pinJogCounts(document, resolver) {
  const jogs = pinJogs(document, resolver);
  const count = (test) => jogs.filter(test).length;
  return {
    count: jogs.length,
    gate: count((jog) => jog.subject === "gate"),
    twoPin: count((jog) => jog.subject === "two-pin"),
    z: count((jog) => jog.pattern === "Z"),
    l: count((jog) => jog.pattern === "L"),
    tipDeparture: count((jog) => jog.tipDeparture),
    pins: jogs.map((jog) => `${jog.instanceId}.${jog.pinName}`).sort(),
  };
}

/** The jogs of `result` on pins where `human` has none. */
export function plannerOnlyPinJogs(result, human) {
  const drawn = new Set(human.pins);
  return result.pins.filter((pin) => !drawn.has(pin)).length;
}
